import { supabase } from '../../lib/supabaseClient';
import type { OnboardingSupabaseClient } from './auth';
import { OnboardingError } from './flow';

// ============================================================================
// Phase 4 — secure one-time handoff into the Template App.
//
// Trust model (all enforced server-side, migration 20260913):
//   • create_template_handoff: caller must be authenticated + referral-linked;
//     the backend derives the user from auth.uid() — no user-id parameter.
//   • The token is a 64-hex opaque random value. Only its hash is stored; the
//     raw token travels once (create response → redirect URL → exchange).
//   • exchange_template_handoff: validates owner/destination/consumed/expiry/
//     account/live-referral, consumes atomically, and records template_started.
//   • The referral code, user id, email or partner id in a URL are NEVER
//     identity proof — only the server-side exchange result is trusted.
//   • No access/refresh/service-role tokens or passwords ever enter the URL.
//
// This module is transport + validation only: env/URL building, anti-CSRF
// state, RPC calls with safe error mapping, and URL cleanup after success.
// ============================================================================

export const TEMPLATE_HANDOFF_ROUTE = '/onboarding/handoff';
export const HANDOFF_STATE_KEY = 'onb_handoff_state';

function readEnvVar(key: string): string {
  try {
    const fromProcess =
      typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>)?.[key] : '';
    if (fromProcess) return String(fromProcess);
  } catch {
    // ignore
  }
  try {
    const fromVite = (import.meta as unknown as { env?: Record<string, string> })?.env?.[key];
    if (fromVite) return String(fromVite);
  } catch {
    // ignore
  }
  return '';
}

function windowOrigin(): string {
  try {
    return typeof window !== 'undefined' ? window.location.origin || '' : '';
  } catch {
    return '';
  }
}

function normalizeBaseUrl(raw: string): string {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  // http(s) only — javascript:, data: or relative values are rejected so a
  // misconfigured env can never turn the redirect into an open redirector.
  if (!/^https?:\/\/[^/\s]+/i.test(value)) {
    throw new OnboardingError('unknown', 'The Template App address is misconfigured.');
  }
  return value;
}

/**
 * Template App base URL: VITE_TEMPLATE_APP_URL when set, else the current
 * origin (same deployment). Empty string only where no origin exists at all
 * (SSR/tests) — callers then build a relative URL.
 */
export function templateAppBaseUrl(overrides?: { envVar?: string; origin?: string }): string {
  const fromEnv = (overrides?.envVar ?? readEnvVar('VITE_TEMPLATE_APP_URL')).trim();
  if (fromEnv) return normalizeBaseUrl(fromEnv);
  const origin = (overrides?.origin ?? windowOrigin()).trim();
  return origin ? normalizeBaseUrl(origin) : '';
}

/** Onboarding App base (recovery links): optional env, else current origin. */
export function onboardingAppBaseUrl(overrides?: { envVar?: string; origin?: string }): string {
  const fromEnv = (overrides?.envVar ?? readEnvVar('VITE_ONBOARDING_APP_URL')).trim();
  if (fromEnv) return normalizeBaseUrl(fromEnv);
  const origin = (overrides?.origin ?? windowOrigin()).trim();
  return origin ? normalizeBaseUrl(origin) : '';
}

/** Absolute (or relative, when base is '') handoff URL carrying token+state. */
export function buildTemplateHandoffUrl(base: string, token: string, state: string): string {
  const prefix = String(base || '').replace(/\/+$/, '');
  return `${prefix}${TEMPLATE_HANDOFF_ROUTE}?token=${encodeURIComponent(token)}&state=${encodeURIComponent(state)}`;
}

/** Recovery link back to the Onboarding App login. Never carries the token. */
export function buildOnboardingLoginUrl(base: string): string {
  const prefix = String(base || '').replace(/\/+$/, '');
  return `${prefix}/onboarding/login`;
}

/** 128-bit anti-CSRF state for one handoff redirect (hex, unpredictable). */
export function newHandoffState(): string {
  const bytes = new Uint8Array(16);
  const cryptoObj = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } })?.crypto;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function saveHandoffState(state: string): void {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(HANDOFF_STATE_KEY, state);
  } catch {
    // Storage failures degrade to "state unknown" (exchange still validates).
  }
}

export function readHandoffState(): string | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage.getItem(HANDOFF_STATE_KEY);
  } catch {
    return null;
  }
}

export function clearHandoffState(): void {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(HANDOFF_STATE_KEY);
  } catch {
    // ignore
  }
}

/** Length-checked comparison (both sides must be present to match). */
export function handoffStateMatches(expected: string | null, actual: string | null): boolean {
  if (!expected || !actual || expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  }
  return diff === 0;
}

export interface CreatedHandoff {
  token: string;
  expiresAt: string;
}

/** Mint a one-time grant for the CALLER (backend derives identity + link). */
export async function createTemplateHandoff(
  client: OnboardingSupabaseClient = supabase as unknown as OnboardingSupabaseClient,
  state: string
): Promise<CreatedHandoff> {
  if (!state) throw new OnboardingError('unknown', 'Something went wrong. Please try again.');
  const { data, error } = await client.rpc('create_template_handoff', { p_state: state });
  if (error) throw toSafeHandoffError(error);
  if (!data?.token) throw toSafeHandoffError(new Error('handoff failed'));
  return { token: String(data.token), expiresAt: String(data.expires_at || '') };
}

export interface ExchangedHandoff {
  userId: string;
  referralCode: string | null;
  onboardingStatus: string | null;
  templateStartedAt: string | null;
}

/** Redeem a grant: single-use, server-validated, records template_started. */
export async function exchangeTemplateHandoff(
  client: OnboardingSupabaseClient = supabase as unknown as OnboardingSupabaseClient,
  token: string
): Promise<ExchangedHandoff> {
  const trimmed = String(token || '').trim();
  if (!trimmed) throw new OnboardingError('invalid-handoff', 'Invalid onboarding session.');
  const { data, error } = await client.rpc('exchange_template_handoff', { p_token: trimmed });
  if (error) throw toSafeHandoffError(error);
  if (!data?.user_id) throw toSafeHandoffError(new Error('exchange failed'));
  return {
    userId: String(data.user_id),
    referralCode: typeof data.referral_code === 'string' ? data.referral_code : null,
    onboardingStatus: typeof data.onboarding_status === 'string' ? data.onboarding_status : null,
    templateStartedAt: typeof data.template_started_at === 'string' ? data.template_started_at : null,
  };
}

/**
 * Map handoff failures to the exact safe user-facing messages. Anything
 * unrecognized becomes the generic message — raw database/driver text,
 * token values and internal ids are never surfaced.
 */
export function toSafeHandoffError(error: unknown): OnboardingError {
  const raw = !error ? '' : typeof error === 'string' ? error : String((error as { message?: unknown })?.message || '');
  if (/already been used/i.test(raw)) {
    return new OnboardingError('handoff-used', 'This onboarding session has already been used.');
  }
  if (/expired/i.test(raw)) {
    return new OnboardingError(
      'handoff-expired',
      'Your onboarding session has expired. Please return to the onboarding app and try again.'
    );
  }
  if (/cannot continue/i.test(raw)) {
    return new OnboardingError('handoff-forbidden', 'Your account cannot continue at this time.');
  }
  if (/verified referral/i.test(raw)) {
    return new OnboardingError(
      'handoff-forbidden',
      'A verified referral is required before entering the Template App.'
    );
  }
  if (/sign in required|not authenticated|jwt expired|invalid jwt|permission denied for function/i.test(raw)) {
    return new OnboardingError('session', 'Your session expired. Please sign in again.');
  }
  if (/invalid onboarding session/i.test(raw)) {
    return new OnboardingError('invalid-handoff', 'Invalid onboarding session.');
  }
  if (/failed to fetch|network|fetch failed|connection/i.test(raw)) {
    return new OnboardingError('network', 'Network error. Check your connection and try again.');
  }
  return new OnboardingError('unknown', 'Something went wrong. Please try again.');
}

/** True when the backend status means "already entered" (used-token fallback). */
export function isEnteredOnboardingStatus(status: unknown): boolean {
  return status === 'template_started' || status === 'template_completed';
}

/**
 * Remove token/state params from a URL (post-exchange cleanup), preserving
 * any other params and the hash. Pure — the component applies it via
 * history.replaceState so the token never lingers in the address bar.
 */
export function stripHandoffQuery(url: string): string {
  const input = String(url || '');
  const hashIndex = input.indexOf('#');
  const hash = hashIndex >= 0 ? input.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? input.slice(0, hashIndex) : input;
  const queryIndex = withoutHash.indexOf('?');
  if (queryIndex < 0) return input;
  const params = new URLSearchParams(withoutHash.slice(queryIndex + 1));
  params.delete('token');
  params.delete('state');
  const rest = params.toString();
  return `${withoutHash.slice(0, queryIndex)}${rest ? `?${rest}` : ''}${hash}`;
}

/** Full-page redirect to the Template App (supports a split deployment). */
export function redirectToTemplateApp(url: string): void {
  if (typeof window === 'undefined' || !window.location) {
    throw new OnboardingError('unknown', 'Redirect is unavailable here.');
  }
  window.location.assign(url);
}
