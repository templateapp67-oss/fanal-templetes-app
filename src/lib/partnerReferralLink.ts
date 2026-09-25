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

/**
 * Resolve the origin that is safe to share publicly.  A configured public
 * origin always wins.  In particular, never copy the current AI Studio
 * `*.run.app` preview origin because visitors would be asked to sign in to
 * Google before they can see the Nexora signup form.
 */
export function publicOnboardingOrigin(origin = partnerShareOrigin()): string {
  const configured = configuredOnboardingOrigin();
  if (configured) return configured;

  const candidate = String(origin || '').trim().replace(/\/+$/, '');
  if (!candidate) return '';
  try {
    const host = new URL(candidate).hostname.toLowerCase();
    if (host.endsWith('.run.app')) return DEFAULT_PUBLIC_ONBOARDING_ORIGIN;
  } catch {
    return '';
  }
  return candidate;
}

/**
 * The onboarding link a partner shares: /signup?ref=CODE.
 *
 * The code goes out in its canonical form (trim + uppercase), so the recipient
 * sees exactly what will be stored, and a link generated from a lowercase or
 * padded code is identical to one generated from the clean code.
 */
export function partnerReferralShareLink(code: string, origin?: string): string {
  const base = publicOnboardingOrigin(origin ?? partnerShareOrigin());
  const value = normalizeGrowthReferralCode(code);
  if (!base || !value) return '';
  return `${base}/signup?ref=${encodeURIComponent(value)}`;
}
