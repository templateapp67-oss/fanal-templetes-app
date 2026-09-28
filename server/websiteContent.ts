import { isSafeImageUrl } from '../src/lib/websiteValidation.js';
import type { SalonProfile, SalonService, SocialVideo } from '../src/types.js';
import { extractYouTubeId, buildYouTubeWatchUrl, buildYouTubeThumbnailUrl } from '../src/utils/youtube.js';
import { catalogId } from './normalizedBookingCreate.js';

/** Public presentation data only. Never spread an owner snapshot: it contains
 * account identifiers, private settings and potentially booking/customer data. */
export function applyPublicWebsiteContent(profile: SalonProfile, raw: unknown): SalonProfile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return profile;
  const source = raw as Partial<SalonProfile>;
  const next = { ...profile };
  const textKeys = [
    'businessType', 'tagline', 'about', 'themePreset', 'themeAccentKey', 'shopFlatNo', 'foundingYear', 'faviconLetter', 'faviconColor',
    'ownerName', 'ownerBio', 'ownerExperience', 'ownerQualifications', 'ownerRole',
    'primaryColor', 'secondaryColor', 'backgroundColor', 'headingStyle', 'buttonStyle',
    'borderRadius', 'appearance', 'headingFont', 'bodyFont', 'customAccentColor',
    'seoTitle', 'seoDescription', 'seoKeywords',
    'instagramHandle', 'facebookPage', 'youtubeChannel', 'tiktokProfile', 'tiktokHandle', 'tiktokUrl', 'googleBusinessUrl',
  ] as const;
  for (const key of textKeys) {
    if (typeof source[key] === 'string') (next as any)[key] = source[key];
  }
  for (const key of ['ownerPhotoUrl', 'coverImageUrl', 'logoUrl', 'customFaviconUrl', 'socialShareImageUrl'] as const) {
    if (isSafeImageUrl(source[key])) next[key] = source[key];
  }
  if (typeof source.whiteLabelEnabled === 'boolean') next.whiteLabelEnabled = source.whiteLabelEnabled;
  if (Array.isArray(source.socialVideos)) {
    next.socialVideos = source.socialVideos.slice(0, 28).flatMap((video): SocialVideo[] => {
      if (!video || typeof video !== 'object') return [];
      const videoId = extractYouTubeId(video.youtubeUrl);
      if (!videoId || !['SHORT', 'LONG', 'SHOWCASE'].includes(video.categoryTag)) return [];
      return [{
        id: String(video.id), videoId, youtubeUrl: buildYouTubeWatchUrl(videoId),
        title: String(video.title || ''), description: String(video.description || ''),
        thumbnailUrl: video.thumbnailUrl && isSafeImageUrl(video.thumbnailUrl) ? video.thumbnailUrl : buildYouTubeThumbnailUrl(videoId), categoryTag: video.categoryTag,
        isOwnerVideo: video.isOwnerVideo === true, isDemo: video.isDemo === true,
      }];
    });
  }
  if (Array.isArray(source.gallery)) next.gallery = source.gallery.filter(p => p && isSafeImageUrl(p.url) && p.url !== '').slice(0, 100).map(p => ({ id: String(p.id), url: p.url, title: String(p.title || ''), tag: String(p.tag || '') }));
  if (Array.isArray(source.lookbookPhotos)) next.lookbookPhotos = source.lookbookPhotos.filter(p => p && isSafeImageUrl(p.url) && p.url !== '').slice(0, 100).map(p => ({ id: String(p.id), url: p.url, title: String(p.title || ''), tag: String(p.tag || ''), alt: String(p.alt || '') }));
  if (source.sectionVisibility && typeof source.sectionVisibility === 'object') {
    const keys = ['header', 'hero', 'metrics', 'about', 'services', 'offers', 'promoPopup', 'stylists', 'testimonials', 'gallery', 'location', 'whatsappFloat'];
    next.sectionVisibility = Object.fromEntries(Object.entries(source.sectionVisibility).filter(([key, value]) => keys.includes(key) && typeof value === 'boolean'));
  }
  if (source.sectionHeadings && typeof source.sectionHeadings === 'object') next.sectionHeadings = Object.fromEntries(Object.entries(source.sectionHeadings).filter(([, value]) => typeof value === 'string'));
  if (Array.isArray(source.offers)) next.offers = source.offers.filter(o => o && typeof o === 'object' && typeof o.title === 'string').slice(0, 100).map(o => ({ id: String(o.id), title: o.title, description: String(o.description || ''), code: String(o.code || ''), discountValue: String(o.discountValue || ''), isActive: o.isActive !== false, imageUrl: isSafeImageUrl(o.imageUrl) ? o.imageUrl : undefined, startDate: typeof o.startDate === 'string' ? o.startDate : undefined, expiryDate: typeof o.expiryDate === 'string' ? o.expiryDate : undefined, terms: String(o.terms || '') }));
  if (source.promotionalBanner && typeof source.promotionalBanner === 'object') {
    const banner = source.promotionalBanner;
    next.promotionalBanner = { enabled: banner.enabled === true, text: typeof banner.text === 'string' ? banner.text : '', buttonAction: banner.buttonAction === 'copy' ? 'copy' : 'book' };
    for (const key of ['discountCode', 'badgeText', 'buttonText', 'themePreset', 'customBgColor', 'customTextColor', 'startDate', 'endDate'] as const) if (typeof banner[key] === 'string') (next.promotionalBanner as any)[key] = banner[key];
  }
  if (source.homeService && typeof source.homeService === 'object') {
    const home = source.homeService;
    next.homeService = { enabled: home.enabled === true, baseCharge: Number.isFinite(home.baseCharge) && home.baseCharge >= 0 ? home.baseCharge : 0, radiusLimitKm: Number.isFinite(home.radiusLimitKm) && home.radiusLimitKm >= 0 ? home.radiusLimitKm : 0 };
  }
  if (Array.isArray(source.testimonials)) next.testimonials = source.testimonials.filter(r => r && typeof r.name === 'string' && typeof r.comment === 'string').slice(0, 100).map(r => ({
    id: String(r.id), name: r.name, comment: r.comment, rating: Math.min(5, Math.max(1, Math.round(Number(r.rating)) || 5)),
    location: String(r.location || ''), serviceName: String(r.serviceName || ''), date: String(r.date || ''), avatarUrl: isSafeImageUrl(r.avatarUrl) ? r.avatarUrl : '',
  }));
  return next;
}

/** Keep bookable catalogue UUIDs, prices and durations authoritative. Only
 * presentation metadata comes from the saved editor item with the SAME id. */
export function mergeServicePresentation(services: SalonService[], raw: unknown, salonId: string): SalonService[] {
  if (!Array.isArray(raw)) return services;
  const byId = new Map(raw.filter(s => s && typeof s.id === 'string').map(s => [catalogId(salonId, 'service', s.id), s]));
  return services.map(service => {
    const saved = byId.get(service.id);
    if (!saved) return service;
    return { ...service,
      imageUrl: isSafeImageUrl(saved.imageUrl) ? saved.imageUrl : service.imageUrl,
      showDuration: typeof saved.showDuration === 'boolean' ? saved.showDuration : service.showDuration,
      category: typeof saved.category === 'string' ? saved.category : service.category,
      icon: typeof saved.icon === 'string' ? saved.icon : service.icon,
    };
  });
}

/** An owner snapshot can describe another salon owned by the same account.
 * Never use it on this site unless its immutable salon ID (or legacy slug)
 * proves that it belongs here. */
export function scopedWebsiteSnapshot(raw: any, salonId: string, slug: string): any | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.salonId === 'string') return raw.salonId === salonId ? raw : null;
  return typeof raw.profile?.subdomain === 'string' && raw.profile.subdomain.trim().toLowerCase() === slug.trim().toLowerCase() ? raw : null;
}
