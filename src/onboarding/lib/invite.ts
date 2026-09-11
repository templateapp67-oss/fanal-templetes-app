// An invite is only a form hint. The referral RPC validates ownership and
// eligibility; browser storage never grants a relationship or partner access.
const KEY = 'growth-invite-v1';
const MAX_AGE = 24 * 60 * 60 * 1000;
export function inviteCode(search: string): string {
  const value = new URLSearchParams(search).get('ref')?.trim() || '';
  return /^[a-zA-Z0-9_-]{1,120}$/.test(value) ? value : '';
}
export function buildInviteUrl(origin: string, code: string): string {
  const url = new URL('/onboarding/signup', origin);
  url.searchParams.set('ref', code);
  return url.toString();
}
export function restoreInvite(search: string, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, now = Date.now()): string {
  const incoming = inviteCode(search);
  try {
    if (incoming) {
      storage?.setItem(KEY, JSON.stringify({ code: incoming, expires: now + MAX_AGE }));
      return incoming;
    }
    const saved = JSON.parse(storage?.getItem(KEY) || 'null');
    if (saved && saved.expires > now && saved.expires <= now + MAX_AGE &&
        inviteCode('?ref=' + encodeURIComponent(saved.code)) === saved.code) return saved.code;
    storage?.removeItem(KEY);
  } catch { /* Storage may be disabled; incoming links still work. */ }
  return incoming;
}
export function clearInvite() {
  try { window.sessionStorage.removeItem(KEY); } catch { /* Optional form hint. */ }
}
