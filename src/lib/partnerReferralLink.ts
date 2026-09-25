import { normalizeGrowthReferralCode } from './growthPartner';

/** Resolve the app origin for share links (empty outside a browser context). */
export function partnerShareOrigin(): string {
  try {
    if (typeof window === 'undefined' || !window.location) return '';
    return window.location.origin;
  } catch {
    return '';
  }
}

/**
 * Create a unified link combining the domain, the site (tenant ID) and the referral code.
 * Format: https://[domain]/signup?site=mysalon&ref=NEXORA-89A5C88E
 */
export function getShareableLink(site: string | null | undefined, ref: string | null | undefined, origin?: string): string {
  const base = (origin ?? partnerShareOrigin()).replace(/\/+$/, '');
  const cleanRef = ref ? normalizeGrowthReferralCode(ref) : '';
  const cleanSite = (site || '').trim();

  const queryParts: string[] = [];
  if (cleanSite) {
    queryParts.push(`site=${encodeURIComponent(cleanSite)}`);
  }
  if (cleanRef) {
    queryParts.push(`ref=${encodeURIComponent(cleanRef)}`);
  }

  const query = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
  return `${base}/signup${query}`;
}

/**
 * The onboarding link a partner shares.
 * Utilizes the unified getShareableLink layout combining both active site and referral code.
 */
export function partnerReferralShareLink(code: string, origin?: string): string {
  let currentSite = '';
  try {
    if (typeof window !== 'undefined' && window.location) {
      const params = new URLSearchParams(window.location.search);
      currentSite = params.get('site') || params.get('subdomain') || params.get('tenant') || '';
    }
  } catch {
    // ignore
  }

  if (!currentSite) {
    try {
      currentSite = localStorage.getItem('nexora_active_site') || localStorage.getItem('nexora_site') || '';
    } catch {
      // ignore
    }
  }

  return getShareableLink(currentSite, code, origin);
}
