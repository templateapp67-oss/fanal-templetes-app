export function normalizeWhatsApp(value: string): string {
  const digits = value.replace(/[\s()+-]/g, '');
  const normalized = /^[6-9]\d{9}$/.test(digits) ? `91${digits}` : digits;
  if (!/^[1-9]\d{7,14}$/.test(normalized)) throw new Error('Enter a valid WhatsApp number with country code.');
  return `+${normalized}`;
}

export async function compressPartnerAvatar(file: File): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Image must be 5 MB or smaller.');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 500 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Cannot process image.')), 'image/webp', 0.85));
  } finally { bitmap.close(); }
}
