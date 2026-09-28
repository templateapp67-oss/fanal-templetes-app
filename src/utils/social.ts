/**
 * Social Media utilities and URL formatters for Salon Website Header & Footers.
 */

function socialUrl(input: string | undefined, domain: string, at = ''): string {
  const value = input?.trim();
  if (!value) return '';
  const candidate = /^(?:www\.)?(?:[a-z]+\.)?(?:instagram|facebook|tiktok)\.com\//i.test(value) ? `https://${value}` : value;
  if (/^https?:\/\//i.test(candidate)) {
    try {
      const url = new URL(candidate);
      if (url.username || url.password || (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`))) return '';
      return url.href;
    } catch { return ''; }
  }
  const handle = value.replace(/^@/, '');
  if (!/^[a-zA-Z0-9._-]+$/.test(handle)) return '';
  return `https://www.${domain}/${at}${handle}`;
}
export function formatInstagramUrl(input?: string): string { return socialUrl(input, 'instagram.com'); }
export function formatFacebookUrl(input?: string): string { return socialUrl(input, 'facebook.com'); }
export function formatTikTokUrl(input?: string): string { return socialUrl(input, 'tiktok.com', '@'); }

/** Read legacy aliases even when template defaults supplied an empty handle.
 * Editor changes/clears write all three aliases together to avoid resurrection. */
export function getTikTokValue(profile: { tiktokHandle?: string; tiktokProfile?: string; tiktokUrl?: string }): string {
  return profile.tiktokHandle || profile.tiktokProfile || profile.tiktokUrl || '';
}

export function displaySocialHandle(input?: string, prefix = '@'): string {
  if (!input || !input.trim()) return '';
  const trimmed = input.trim();
  if (trimmed.includes('instagram.com/')) {
    const parts = trimmed.split('instagram.com/')[1].split('/')[0].split('?')[0];
    return parts ? `${prefix}${parts}` : trimmed;
  }
  if (trimmed.includes('tiktok.com/@')) {
    const parts = trimmed.split('tiktok.com/@')[1].split('/')[0].split('?')[0];
    return parts ? `${prefix}${parts}` : trimmed;
  }
  if (trimmed.includes('tiktok.com/')) {
    const parts = trimmed.split('tiktok.com/')[1].split('/')[0].split('?')[0];
    return parts ? `${prefix}${parts}` : trimmed;
  }
  if (trimmed.includes('facebook.com/')) {
    const parts = trimmed.split('facebook.com/')[1].split('/')[0].split('?')[0];
    return parts ? parts : trimmed;
  }
  return trimmed.startsWith(prefix) ? trimmed : `${prefix}${trimmed}`;
}
