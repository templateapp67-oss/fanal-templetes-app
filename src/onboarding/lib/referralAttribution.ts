import { OnboardingError } from './flow';
/** Cookie-backed attribution. Never persisted to localStorage or trusted from a URL. */
async function requestAttribution(code?: string): Promise<{ valid: boolean; token?: string; referralCode?: string }> {
  let response: Response;
  try { response = await fetch('/api/referral-attribution', {
    method: code === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    ...(code === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }),
  });
  } catch { throw new OnboardingError('network', 'Network error. Check your connection and try again.'); }
  if (!response.ok) throw new OnboardingError('unknown', 'Referral attribution could not be checked. Please retry.');
  try { return await response.json(); }
  catch { throw new OnboardingError('unknown', 'Referral attribution could not be checked. Please retry.'); }
}

export async function captureSignupReferral(code: string): Promise<string> {
  const result = await requestAttribution(code);
  return result.valid ? result.referralCode || '' : '';
}

/** The DB trigger accepts only a live one-use capability, not an arbitrary code. */
export async function prepareSignupAttribution(): Promise<string | undefined> {
  const result = await requestAttribution();
  return result.valid ? result.token : undefined;
}
