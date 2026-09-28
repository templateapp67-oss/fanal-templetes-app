import type { SalonProfile } from '../types.js';
import { extractYouTubeId } from '../utils/youtube.js';

export function isValidContactPhone(value: unknown): boolean {
  return typeof value === 'string' && /^[+\d\s().-]+$/.test(value.trim()) && /^\d{7,15}$/.test(value.replace(/\D/g, ''));
}

/** Shared by the editor and its HTTP save path; owner bio/email are optional. */
export function hasRequiredWebsiteProfile(profile: Partial<SalonProfile> | null | undefined): boolean {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return false;
  const text = (key: keyof SalonProfile) => typeof profile[key] === 'string' && String(profile[key]).trim().length > 0;
  return text('businessName') && text('businessType') && text('address') && text('city') &&
    isValidContactPhone(profile.phone || (profile as any).phone_number);
}

/** An empty string is an intentional image removal. SVG/data HTML are not images. */
export function isSafeImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value === '') return true;
  if (/^\/(?!\/)/.test(value)) return !/[\r\n\\]/.test(value);
  if (/^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)) return true;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

/** Reject invalid content before a save claims success. Never mutate the draft. */
export function websiteContentError(state: any): string | null {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return 'Website data must be an object.';
  const profile = state.profile;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return 'A profile object is required.';
  for (const key of ['services', 'stylists', 'appointments', 'clients']) {
    if (state[key] !== undefined && !Array.isArray(state[key])) return `${key} must be an array.`;
  }
  if (Array.isArray(state.services)) {
    if (state.services.length > 500) return 'A website can have up to 500 services.';
    const ids = new Set<string>();
    for (const s of state.services) {
      if (!s || typeof s.id !== 'string' || !s.id.trim() || typeof s.name !== 'string' || !s.name.trim()) return 'Every service needs an ID and a name.';
      if (ids.has(s.id)) return 'Service IDs must be unique.';
      ids.add(s.id);
      if (typeof s.price !== 'number' || !Number.isFinite(s.price) || s.price < 0) return 'Service prices must be finite numbers of zero or more.';
      if (s.originalPrice !== undefined && (typeof s.originalPrice !== 'number' || !Number.isFinite(s.originalPrice) || s.originalPrice < s.price)) return 'Regular service prices must be finite and at least the sale price.';
      if (!Number.isInteger(s.durationMinutes) || s.durationMinutes <= 0) return 'Service durations must be positive whole minutes.';
      if (s.imageUrl !== undefined && !isSafeImageUrl(s.imageUrl)) return 'Use a valid service image URL or uploaded JPG, PNG or WebP.';
    }
  }
  for (const key of ['ownerPhotoUrl', 'coverImageUrl', 'logoUrl', 'socialShareImageUrl', 'customFaviconUrl']) {
    if (profile[key] !== undefined && !isSafeImageUrl(profile[key])) return `Invalid ${key}. Use an image URL or JPG, PNG or WebP upload.`;
  }
  if (profile.socialVideos !== undefined) {
    if (!Array.isArray(profile.socialVideos)) return 'Videos must be an array.';
    const ids = new Set<string>();
    let shorts = 0, showcases = 0;
    for (const v of profile.socialVideos) {
      if (!v || typeof v.id !== 'string' || !v.id.trim() || ids.has(v.id)) return 'Each video needs a unique ID.';
      ids.add(v.id);
      if (!extractYouTubeId(v.youtubeUrl)) return 'Videos can only be added with a valid YouTube link.';
      if (typeof v.title !== 'string' || !v.title.trim()) return 'Each video needs a title.';
      if (!['SHORT', 'LONG', 'SHOWCASE'].includes(v.categoryTag)) return 'Choose a valid video placement.';
      v.categoryTag === 'SHORT' ? shorts++ : showcases++;
    }
    if (shorts > 14 || showcases > 14) return 'Add up to 14 shorts and 14 showcases.';
  }
  if (profile.gallery !== undefined) {
    if (!Array.isArray(profile.gallery) || profile.gallery.length > 100) return 'The gallery must contain at most 100 images.';
    const ids = new Set<string>();
    for (const photo of profile.gallery) {
      if (!photo || typeof photo.id !== 'string' || !photo.id.trim() || ids.has(photo.id) || !isSafeImageUrl(photo.url)) return 'Each gallery image needs a unique ID and a valid image URL.';
      ids.add(photo.id);
    }
  }
  if (profile.testimonials !== undefined) {
    if (!Array.isArray(profile.testimonials) || profile.testimonials.length > 100) return 'Add up to 100 testimonials.';
    const ids = new Set<string>();
    for (const review of profile.testimonials) {
      if (!review || typeof review.id !== 'string' || !review.id.trim() || ids.has(review.id) || typeof review.name !== 'string' || !review.name.trim() || typeof review.comment !== 'string' || !review.comment.trim()) return 'Testimonials need unique IDs, a client name and a comment.';
      if (!Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5) return 'Testimonial ratings must be between one and five stars.';
      if (review.avatarUrl !== undefined && !isSafeImageUrl(review.avatarUrl)) return 'Use a valid testimonial image URL.';
      ids.add(review.id);
    }
  }
  return null;
}
