/** Resolve the app origin for share links (empty outside a browser context). */
export function partnerShareOrigin(): string {
  try {
    if (typeof window === 'undefined' || !window.location) return '';
    return window.location.origin;
  } catch {
    return '';
  }
}

/** The onboarding link a partner shares: /signup?ref=CODE. */
export function partnerReferralShareLink(code: string, origin?: string): string {
  const base = (origin ?? partnerShareOrigin()).replace(/\/+$/, '');
  const value = code.trim();
  if (!base || !value) return '';
  return `${base}/signup?ref=${encodeURIComponent(value)}`;
}

