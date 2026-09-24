import { isGrowthReferralCodeFormat, normalizeGrowthReferralCode } from '../../lib/growthPartner';
import { referralCodeFromQuery } from '../../lib/referralQuery';

/**
 * Referral intent is a convenience for signup UX only. The backend still
 * validates the code and accepts only its own short-lived attribution token.
 */
export const REFERRAL_INTENT_STORAGE_KEY = 'nexora_ref_code';
export const FLASH_TOAST_STORAGE_KEY = 'nexora_flash_toast';

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage; } catch { return null; }
}

function canonical(value: unknown): string {
  return isGrowthReferralCodeFormat(value) ? normalizeGrowthReferralCode(String(value)) : '';
}

export function persistReferralIntent(value: unknown): string {
  const code = canonical(value);
  if (!code) return '';
  try { storage()?.setItem(REFERRAL_INTENT_STORAGE_KEY, code); } catch {}
  return code;
}

export function readPersistedReferralIntent(): string {
  try { return canonical(storage()?.getItem(REFERRAL_INTENT_STORAGE_KEY) || ''); } catch { return ''; }
}

/** Capture a referral link immediately, before any auth redirect drops ?ref=. */
export function captureReferralIntentFromLocation(search?: string): string {
  const query = search ?? (typeof window !== 'undefined' ? window.location?.search || '' : '');
  return persistReferralIntent(referralCodeFromQuery(query));
}

export function hasReferralIntentInLocation(search?: string): boolean {
  const query = search ?? (typeof window !== 'undefined' ? window.location?.search || '' : '');
  return Boolean(canonical(referralCodeFromQuery(query)));
}

export function readReferralIntent(): string {
  return captureReferralIntentFromLocation() || readPersistedReferralIntent();
}

export function writeFlashToast(message: string, type: 'success' | 'error' = 'success'): void {
  try { storage()?.setItem(FLASH_TOAST_STORAGE_KEY, JSON.stringify({ message, type })); } catch {}
}

export function takeFlashToast(): { message: string; type: 'success' | 'error' } | null {
  try {
    const raw = storage()?.getItem(FLASH_TOAST_STORAGE_KEY);
    storage()?.removeItem(FLASH_TOAST_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed.message !== 'string' || !parsed.message.trim()) return null;
    return { message: parsed.message, type: parsed.type === 'error' ? 'error' : 'success' };
  } catch {
    return null;
  }
}
