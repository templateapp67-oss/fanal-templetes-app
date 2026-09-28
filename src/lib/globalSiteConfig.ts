import { isSafeImageUrl } from './websiteValidation';
import type { SalonProfile, SalonService } from '../types';
import { parseSeoKeywords } from './seoKeywords';
import { getTikTokValue } from '../utils/social';

export function regularServicePrice(service: SalonService): number {
  return service.originalPrice != null && Number.isFinite(service.originalPrice) && service.originalPrice >= service.price ? service.originalPrice : service.price;
}

/** Shared external contract. Internally price ALWAYS means the amount charged. */
export function globalSiteConfig(profile: SalonProfile, services: SalonService[]) {
  return {
    seo: { title: profile.seoTitle || '', description: profile.seoDescription || '', keywords: parseSeoKeywords(profile.seoKeywords) },
    social_links: { instagram: profile.instagramHandle || '', facebook: profile.facebookPage || '', tiktok: getTikTokValue(profile) },
    services: services.map(s => ({ id: s.id, name: s.name, category: s.category, description: s.description,
      price: regularServicePrice(s), sale_price: regularServicePrice(s) > s.price ? s.price : null,
      duration: `${s.durationMinutes} mins`, image_url: s.imageUrl || '' })),
  };
}

/** Boundary adapter for imports using the requested nested service contract. */
export function importRichService(row: { id: string; name: string; category: string; description: string; price: number; sale_price?: number | null; duration: string; image_url?: string }): SalonService {
  const match = /^(\d+)\s*(?:min|mins|minutes?)$/i.exec(row.duration.trim());
  const price = row.sale_price ?? row.price;
  if ((row.image_url !== undefined && !isSafeImageUrl(row.image_url)) || !row.id.trim() || !row.name.trim() || !match || Number(match[1]) <= 0 || !Number.isFinite(row.price) || row.price < 0 || !Number.isFinite(price) || price < 0 || price > row.price) throw new Error('Invalid service price, sale price, name or duration.');
  return { id: row.id, name: row.name, category: row.category || 'General', description: row.description,
    price, ...(price < row.price ? { originalPrice: row.price } : {}), durationMinutes: Number(match[1]), imageUrl: row.image_url || '', icon: 'Sparkles', showDuration: true };
}

export type GlobalSiteConfig = ReturnType<typeof globalSiteConfig>;

/** Imports merge into canonical editor state; pass this result to the existing save pipeline.
 * Missing sections preserve edits. Explicit empty strings/arrays clear them. */
export function applyGlobalSiteConfig(profile: SalonProfile, services: SalonService[], input: Partial<GlobalSiteConfig>) {
  return {
    profile: { ...profile,
      ...(input.seo ? { seoTitle: input.seo.title, seoDescription: input.seo.description, seoKeywords: parseSeoKeywords(input.seo.keywords.join(',')).join(', ') } : {}),
      ...(input.social_links ? { instagramHandle: input.social_links.instagram, facebookPage: input.social_links.facebook,
        tiktokHandle: input.social_links.tiktok, tiktokProfile: input.social_links.tiktok, tiktokUrl: input.social_links.tiktok } : {}),
    },
    services: input.services ? input.services.map(importRichService) : services,
  };
}
