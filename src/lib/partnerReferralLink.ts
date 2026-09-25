import { normalizeGrowthReferralCode } from './growthPartner';

/**
 * The public production onboarding site. AI Studio preview URLs are protected
 * by Google sign-in, so they are not valid destinations for a customer-facing
 * referral link. This fallback keeps a link copied from a preview usable by
 * taking the new owner to the public Vercel deployment instead.
 *
 * Production can override this during the Vite build with
 * `VITE_ONBOARDING_APP_URL` (for example after moving to a custom domain).
 */
export const DEFAULT_PUBLIC_ONBOARDING_ORIGIN = 'https://fanal-templetes-app.vercel.app';

function configuredOnboardingOrigin(): string {
  try {
    const value = String((import.meta as any)?.env?.VITE_ONBOARDING_APP_URL || '').trim();
    if (/^https?:\/\/[^/\s]+/i.test(value)) return value.replace(/\/+$/, '');
  } catch {
    // Vite environment values are not present in SSR/unit-test contexts.
  }
  return '';
}

/** Resolve the app origin for share links (empty outside a browser context). */
export function partnerShareOrigin(): string {
  try {
    if (typeof window === 'undefined' || !window.location) return '';
    return window.location.origin;
  } catch {
    return '';
  }
}

/** Resolve the only public onboarding origin that may be shared. */
export function publicOnboardingOrigin(origin = partnerShareOrigin()): string {
  const configured = configuredOnboardingOrigin();
  if (configured) return configured;
  const candidate = String(origin || '').trim().replace(/\/+$/, '');
  if (!candidate) return '';
  try {
    if (new URL(candidate).hostname.toLowerCase().endsWith('.run.app')) return DEFAULT_PUBLIC_ONBOARDING_ORIGIN;
  } catch {
    return '';
  }
  return candidate;
}

/** Build a public signup link retaining the optional tenant and referral code. */
export function getShareableLink(site: string | null | undefined, ref: string | null | undefined, origin?: string): string {
  const base = publicOnboardingOrigin(origin ?? partnerShareOrigin());
  const cleanRef = ref ? normalizeGrowthReferralCode(ref) : '';
  const cleanSite = String(site || '').trim();
  if (!base) return '';
  // Keep URL encoding stable for copied links (`%20`, not form-style `+`).
  const parts: string[] = [];
  if (cleanSite) parts.push(`site=${encodeURIComponent(cleanSite)}`);
  if (cleanRef) parts.push(`ref=${encodeURIComponent(cleanRef)}`);
  const query = parts.join('&');
  return `${base}/signup${query ? `?${query}` : ''}`;
}

/** A partner referral link must always contain a valid referral code. */
export function partnerReferralShareLink(code: string, origin?: string): string {
  const cleanCode = normalizeGrowthReferralCode(code);
  if (!cleanCode) return '';
  let currentSite = '';
  try {
    if (typeof window !== 'undefined' && window.location) {
      const params = new URLSearchParams(window.location.search);
      currentSite = params.get('site') || params.get('subdomain') || params.get('tenant') || '';
    }
  } catch {}
  if (!currentSite) {
    try {
      currentSite = localStorage.getItem('nexora_active_site') || localStorage.getItem('nexora_site') || '';
    } catch {}
  }
  return getShareableLink(currentSite, cleanCode, origin);
}
