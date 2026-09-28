import type { SupabaseClient } from '@supabase/supabase-js';

export const FAVICON_BUCKET = 'website-favicons';

/** Upload only rasterized favicon bytes; no user-controlled SVG is served. */
export async function uploadWebsiteFavicon(client: SupabaseClient, image: Blob, expectedOwnerId?: string): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.type) || image.size > 2 * 1024 * 1024) {
    throw new Error('Use a PNG, JPG or WebP favicon no larger than 2 MB.');
  }
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('Sign in before uploading your favicon.');
  const ownerId = data.user.id;
  if (expectedOwnerId && ownerId !== expectedOwnerId) throw new Error('Your account changed. Reload before uploading.');
  const ext = image.type === 'image/png' ? 'png' : image.type === 'image/jpeg' ? 'jpg' : 'webp';
  const path = `${ownerId}/${crypto.randomUUID()}.${ext}`;
  const storage = client.storage.from(FAVICON_BUCKET);
  const uploaded = await storage.upload(path, image, { contentType: image.type, upsert: false });
  if (uploaded.error) throw new Error(`Favicon upload failed: ${uploaded.error.message}`);
  const latest = await client.auth.getUser();
  if (latest.error || latest.data.user?.id !== ownerId) {
    // Never apply one account's upload to another account's editor.
    throw new Error('Your account changed during upload. Reload and retry.');
  }
  return storage.getPublicUrl(path).data.publicUrl;
}
