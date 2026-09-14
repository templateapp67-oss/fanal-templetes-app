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
 * The onboarding link a partner shares: /signup?ref=CODE.
 *
 * The code goes out in its canonical form (trim + uppercase), so the recipient
 * sees exactly what will be stored, and a link generated from a lowercase or
 * padded code is identical to one generated from the clean code.
 */
export function partnerReferralShareLink(code: string, origin?: string): string {
  const base = (origin ?? partnerShareOrigin()).replace(/\/+$/, '');
  const value = normalizeGrowthReferralCode(code);
  if (!base || !value) return '';
  return `${base}/signup?ref=${encodeURIComponent(value)}`;
}

