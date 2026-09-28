import type { SupabaseClient } from '@supabase/supabase-js';
export const SOCIAL_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export function validateSocialImage(image: Blob): void {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.type)) throw new Error('Choose a PNG, JPG or WebP image.');
  if (!image.size || image.size > SOCIAL_IMAGE_MAX_BYTES) throw new Error('Social images must be no larger than 2 MB.');
}
/** Rasterize to an exact social-card size. Centre-crops non-1.91:1 uploads. */
export async function prepareSocialShareImage(file: Blob): Promise<Blob> {
  validateSocialImage(file);
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 630;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image processing is unavailable in this browser.');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1200, 630);
    const scale = Math.max(1200 / bitmap.width, 630 / bitmap.height);
    const width = bitmap.width * scale, height = bitmap.height * scale;
    ctx.drawImage(bitmap, (1200 - width) / 2, (630 - height) / 2, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not prepare image.')), 'image/jpeg', 0.88));
    validateSocialImage(blob);
    return blob;
  } finally { bitmap.close(); }
}
export async function uploadSocialShareImage(client: SupabaseClient, image: Blob, expectedOwnerId?: string): Promise<string> {
  validateSocialImage(image);
  const { data, error } = await client.auth.getUser();
  const ownerId = data.user?.id;
  if (error || !ownerId) throw new Error('Sign in before uploading a social image.');
  if (expectedOwnerId && expectedOwnerId !== ownerId) throw new Error('Account changed. Reload before uploading.');
  const extension = image.type === 'image/png' ? 'png' : image.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${ownerId}/social/${crypto.randomUUID()}.${extension}`;
  const bucket = client.storage.from('brand-assets');
  const result = await bucket.upload(path, image, { contentType: image.type, upsert: false, cacheControl: '31536000' });
  if (result.error) throw new Error(`Social image upload failed: ${result.error.message}`);
  const latest = await client.auth.getUser();
  if (latest.error || latest.data.user?.id !== ownerId) throw new Error('Account changed during upload. Reload and retry.');
  return bucket.getPublicUrl(path).data.publicUrl;
}
