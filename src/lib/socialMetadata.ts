// `.js` extension required: this module is shared with the Node/API graph
// (server/publicSocialPage.ts), which is loaded as native ESM.
import { parseSeoKeywords } from './seoKeywords.js';
import type { SalonProfile } from '../types.js';

export function socialMetadata(profile: Partial<SalonProfile>, pageUrl: string) {
  const page = new URL(pageUrl);
  const site = page.searchParams.get('site');
  page.search = ''; page.hash = '';
  if (site) page.searchParams.set('site', site); // never collapse all tenant URLs to /
  const absoluteImage = (value?: string) => {
    if (!value) return '';
    try {
      const url = new URL(value, page.origin);
      return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  };
  const custom = absoluteImage(profile.socialShareImageUrl);
  return {
    title: profile.seoTitle?.trim() || [profile.businessName || 'Nexora', profile.tagline].filter(Boolean).join(' – '),
    description: (profile.seoDescription?.trim() || profile.about || 'Book appointments online.').slice(0, 160),
    keywords: parseSeoKeywords(profile.seoKeywords).join(', '),
    image: custom || absoluteImage(profile.coverImageUrl) || absoluteImage(profile.ownerPhotoUrl),
    sizedImage: !!custom,
    url: page.href,
    siteName: profile.businessName || 'Nexora',
  };
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Runs before HTML is returned to crawlers; React effects cannot do this. */
export function injectSocialMetadata(html: string, profile: Partial<SalonProfile>, pageUrl: string): string {
  const m = socialMetadata(profile, pageUrl);
  const property = (key: string, value: string) => `<meta property="${key}" content="${escapeHtml(value)}">`;
  const name = (key: string, value: string) => `<meta name="${key}" content="${escapeHtml(value)}">`;
  const tags = [`<title>${escapeHtml(m.title)}</title>`, name('description', m.description), name('keywords', m.keywords),
    `<link rel="canonical" href="${escapeHtml(m.url)}">`, property('og:title', m.title), property('og:description', m.description),
    property('og:url', m.url), property('og:type', 'website'), property('og:site_name', m.siteName),
    name('twitter:card', m.image ? 'summary_large_image' : 'summary'), name('twitter:title', m.title), name('twitter:description', m.description)];
  if (m.image) tags.push(property('og:image', m.image), property('og:image:alt', m.title), name('twitter:image', m.image));
  if (m.sizedImage) tags.push(property('og:image:width', '1200'), property('og:image:height', '630'));
  return html.replace(/<head\b([^>]*)>([\s\S]*?)<\/head>/i, (_, attrs, head) => {
    const cleaned = head.replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
      .replace(/<meta\b[^>]*>/gi, (tag: string) => /\b(?:name|property)\s*=\s*["'](?:og:[^"']*|twitter:[^"']*|description|keywords)["']/i.test(tag) ? '' : tag)
      .replace(/<link\b[^>]*>/gi, (tag: string) => /\brel\s*=\s*["']canonical["']/i.test(tag) ? '' : tag);
    return `<head${attrs}>${cleaned}\n${tags.join('\n')}\n</head>`;
  });
}
