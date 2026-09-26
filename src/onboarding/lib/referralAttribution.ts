import { OnboardingError } from './flow';
import { projectValidationResponse, REFERRAL_CAPABILITY } from '../../lib/safePartnerResponse';

/** What this client may hold from the attribution endpoint — nothing else. */
interface AttributionAnswer {
  valid: boolean;
  referralCode: string | null;
  token?: string;
}

/**
 * Cookie-backed attribution. Never persisted to localStorage or trusted from a URL.
 *
 * 5.2 SAFE RESPONSE: the JSON answer is projected through the shared allowlist
 * (`valid` + canonical code + the one-use capability) instead of being taken
 * as-is. The endpoint is ours, but the client is the last boundary: a drifted
 * deployment, an intermediate proxy or a future field must not be able to put
 * private partner profile data, internal ids, bank details, commission
 * configuration, admin metadata or private contact details into signup state.
 */
async function requestAttribution(code?: string): Promise<AttributionAnswer> {
  // Match the database normalizer before crossing the HTTP boundary. The
  // backend repeats this normalization; this is for consistent URL-prefill and
  // manual-input behaviour, never an authorization decision.
  const cleanedCode = code === undefined ? undefined : String(code).trim().toUpperCase();
  let response: Response;
  try { response = await fetch('/api/referral-attribution', {
    method: cleanedCode === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    ...(cleanedCode === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: cleanedCode }) }),
  });
  } catch { throw new OnboardingError('network', 'Network error. Check your connection and try again.'); }
  if (!response.ok) throw new OnboardingError('unknown', 'Referral attribution could not be checked. Please retry.');
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new OnboardingError('unknown', 'Referral attribution could not be checked. Please retry.'); }
  const safe = projectValidationResponse(code === undefined ? 'prepare-signup' : 'capture-attribution', payload);
  return {
    valid: safe.valid,
    referralCode: safe.referralCode,
    // The capability is re-validated (opaque 64-hex) rather than trusted, and
    // its lifetime is the endpoint's, never the browser's.
    ...(safe.token && REFERRAL_CAPABILITY.test(safe.token) ? { token: safe.token } : {}),
  };
}

export async function captureSignupReferral(code: string): Promise<string> {
  const result = await requestAttribution(code);
  return result.valid ? result.referralCode || '' : '';
}

/**
 * The DB trigger accepts only a live one-use capability, not an arbitrary code.
 * Passing the persisted referral intent refreshes the cookie/capability after an
 * account switch or OAuth-style full-page redirect; the backend still decides
 * whether that code is valid and linkable.
 */
export async function prepareSignupAttribution(referralCode?: string): Promise<string | undefined> {
  const code = String(referralCode || '').trim();
  if (!code) return undefined; // An old cookie must not attribute an organic signup.
  if (code) {
    // POST deliberately does not return the capability token: it is stored in
    // the HttpOnly cookie so referral attribution cannot be copied from page
    // state. Refresh the code first, then make the cookie-backed GET that is
    // explicitly allowed to return the short-lived token for Auth metadata.
    const captured = await requestAttribution(code);
    if (!captured.valid) throw new OnboardingError('invalid-code', 'This referral code is unavailable. Update or remove it to continue.');
  }
  const prepared = await requestAttribution();
  if (!prepared.valid || !prepared.token) throw new OnboardingError('invalid-code', 'This referral code is unavailable. Update or remove it to continue.');
  return prepared.token;
}
