import { useEffect, useState, useCallback } from 'react';

export const NEXORA_REFERRAL_KEY = 'nexora_active_referral';
export const NEXORA_REFERRAL_EVENT = 'nexora_referral_detected';

/**
 * Reads the stored active referral code from sessionStorage or localStorage.
 */
export function getStoredReferralCode(): string {
  if (typeof window === 'undefined') return '';
  try {
    const sessionVal = sessionStorage.getItem(NEXORA_REFERRAL_KEY);
    if (sessionVal && sessionVal.trim()) return sessionVal.trim();

    const localVal = localStorage.getItem(NEXORA_REFERRAL_KEY);
    if (localVal && localVal.trim()) return localVal.trim();
  } catch (err) {
    console.warn('Failed to read referral code from storage:', err);
  }
  return '';
}

/**
 * Stores a referral code into sessionStorage and localStorage and dispatches a notification event.
 */
export function storeReferralCode(rawCode: string): string {
  if (typeof window === 'undefined') return '';
  const cleaned = rawCode ? rawCode.trim() : '';
  if (!cleaned) return '';

  try {
    sessionStorage.setItem(NEXORA_REFERRAL_KEY, cleaned);
    localStorage.setItem(NEXORA_REFERRAL_KEY, cleaned);
  } catch (err) {
    console.warn('Failed to store referral code:', err);
  }

  // Dispatch custom event for real-time app reaction
  window.dispatchEvent(
    new CustomEvent(NEXORA_REFERRAL_EVENT, { detail: { code: cleaned } })
  );

  return cleaned;
}

/**
 * Appends or updates the active referral parameter (`ref`) on any given internal link.
 */
export function preserveReferralUrl(targetUrl: string): string {
  const activeCode = getStoredReferralCode();
  if (!activeCode || !targetUrl) return targetUrl;

  try {
    const dummyBase = 'https://nexora.internal';
    const urlObj = new URL(targetUrl, dummyBase);

    if (!urlObj.searchParams.has('ref') && !urlObj.searchParams.has('referral') && !urlObj.searchParams.has('code') && !urlObj.searchParams.has('partner_code')) {
      urlObj.searchParams.set('ref', activeCode);
    }

    if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
      return urlObj.toString();
    }
    return urlObj.pathname + urlObj.search + urlObj.hash;
  } catch {
    return targetUrl;
  }
}

export interface UseReferralTrackerResult {
  referralCode: string;
  isReferralDetected: boolean;
  clearReferralCode: () => void;
}

/**
 * Global Referral Tracker Hook:
 * - Detects `ref`, `referral`, `code`, or `partner_code` URL search params.
 * - Stores the code in localStorage / sessionStorage.
 * - Triggers `onReferralDetected` callback (e.g., to auto-open signup modal).
 */
export function useReferralTracker(options?: {
  onReferralDetected?: (code: string) => void;
}): UseReferralTrackerResult {
  const [referralCode, setReferralCode] = useState<string>(() => getStoredReferralCode());
  const [isReferralDetected, setIsReferralDetected] = useState<boolean>(false);

  const checkUrlParams = useCallback(() => {
    if (typeof window === 'undefined') return;

    try {
      const isSignupPath = window.location.pathname.toLowerCase() === '/signup';
      const searchParams = new URLSearchParams(window.location.search);
      const paramCode =
        searchParams.get('ref') ||
        searchParams.get('referral') ||
        searchParams.get('code') ||
        searchParams.get('partner_code');

      if (paramCode && paramCode.trim()) {
        const stored = storeReferralCode(paramCode);
        setReferralCode(stored);
        setIsReferralDetected(true);
        if (options?.onReferralDetected) {
          options.onReferralDetected(stored);
        }
      } else {
        const existing = getStoredReferralCode();
        if (existing) {
          setReferralCode(existing);
        }
        if (isSignupPath && options?.onReferralDetected) {
          options.onReferralDetected(existing);
        }
      }
    } catch (err) {
      console.warn('Error parsing referral URL parameters:', err);
    }
  }, [options]);

  useEffect(() => {
    checkUrlParams();

    const handleCustomEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ code: string }>;
      if (customEvent.detail?.code) {
        setReferralCode(customEvent.detail.code);
      }
    };

    window.addEventListener(NEXORA_REFERRAL_EVENT, handleCustomEvent);
    window.addEventListener('popstate', checkUrlParams);

    return () => {
      window.removeEventListener(NEXORA_REFERRAL_EVENT, handleCustomEvent);
      window.removeEventListener('popstate', checkUrlParams);
    };
  }, [checkUrlParams]);

  const clearReferralCode = useCallback(() => {
    try {
      sessionStorage.removeItem(NEXORA_REFERRAL_KEY);
      localStorage.removeItem(NEXORA_REFERRAL_KEY);
    } catch {}
    setReferralCode('');
    setIsReferralDetected(false);
  }, []);

  return {
    referralCode,
    isReferralDetected,
    clearReferralCode,
  };
}
