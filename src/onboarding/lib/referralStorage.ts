import { referralCodeFromQuery } from '../../lib/referralQuery';
import { isGrowthReferralCodeFormat, normalizeGrowthReferralCode } from '../../lib/growthPartner';

export const PENDING_REFERRAL_KEY = 'pending_referral_code';

export function getCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : '';
}

/**
 * Stores the pending referral code in both localStorage and cookies.
 */
export function savePendingReferralCode(code: string): void {
  if (!code || typeof window === 'undefined') return;
  const trimmed = code.trim();
  if (!trimmed) return;
  try {
    localStorage.setItem(PENDING_REFERRAL_KEY, trimmed);
    document.cookie = `${PENDING_REFERRAL_KEY}=${encodeURIComponent(trimmed)}; path=/; max-age=86400; SameSite=Lax`;
  } catch (e) {
    console.warn('[Referral Storage] Failed to save pending referral code:', e);
  }
}

/**
 * Clears the pending referral code from both localStorage and cookies.
 */
export function clearPendingReferralCode(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(PENDING_REFERRAL_KEY);
    document.cookie = `${PENDING_REFERRAL_KEY}=; path=/; max-age=0; SameSite=Lax`;
  } catch (e) {
    console.warn('[Referral Storage] Failed to clear pending referral code:', e);
  }
}

/**
 * Reads a referral code explicitly passed in the URL search query parameters (?ref, ?referral, ?code).
 */
export function readURLReferralCode(): string {
  if (typeof window === 'undefined' || !window.location) return '';
  const candidate = referralCodeFromQuery(window.location.search);
  if (isGrowthReferralCodeFormat(candidate)) {
    const norm = normalizeGrowthReferralCode(candidate);
    savePendingReferralCode(norm);
    return norm;
  }
  return '';
}

/**
 * Reads a saved referral code from localStorage or cookies.
 */
export function readStoredReferralCode(): string {
  if (typeof window === 'undefined') return '';
  try {
    const saved = localStorage.getItem(PENDING_REFERRAL_KEY) || getCookie(PENDING_REFERRAL_KEY) || '';
    if (isGrowthReferralCodeFormat(saved)) {
      return normalizeGrowthReferralCode(saved);
    }
  } catch {}
  return '';
}

/**
 * Reads the referral code from the URL query params, falling back to localStorage/cookies.
 */
export function readSharedReferralCode(): string {
  return readURLReferralCode() || readStoredReferralCode();
}
