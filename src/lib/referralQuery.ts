// ============================================================================
// Referral codes in a URL.
//
// One reader for every page that can arrive with a code in the query string, so
// the accepted parameter names and the length rule cannot drift between the
// onboarding funnel and the customer app.
//
// This module deliberately does NOT decide whether a code is valid — the two
// apps that use it have different code formats (a Growth Partner code is
// ^([A-Z0-9]{6,12}|NEXORA-[A-Z0-9]{4,24})$, a customer loyalty code is
// ^NX-[A-Z0-9]{4,8}$), and in both cases the DATABASE is authoritative. This
// only extracts the raw candidate.
// ============================================================================

/**
 * Accepted parameter names, in priority order. `ref` is canonical — it is what
 * a partner's share link emits (see partnerReferralShareLink) — and `referral`
 * is accepted as an alias because it is the spelling people type and paste by
 * hand.
 */
export const REFERRAL_QUERY_PARAMS = ['ref', 'referral'] as const;

/**
 * Upper bound on a code read from a URL. The database's own format check tops
 * out far below this (`NEXORA-` + 24 = 31 characters), so the cap exists to
 * keep an arbitrarily long query value from being carried into form state.
 */
export const MAX_REFERRAL_QUERY_LENGTH = 64;

/**
 * Read a referral code out of a query string. Trims surrounding whitespace;
 * returns '' when nothing usable is present.
 *
 * The FIRST parameter that is present decides — a value that fails the length
 * cap is not silently replaced by the other parameter, because substituting a
 * different code for the one a link actually carried would attribute the owner
 * to somebody else's referral.
 */
export function referralCodeFromQuery(search: unknown): string {
  try {
    const params = new URLSearchParams(typeof search === 'string' ? search : '');
    for (const name of REFERRAL_QUERY_PARAMS) {
      const raw = params.get(name);
      if (raw === null) continue;
      const value = raw.trim();
      return value.length > 0 && value.length <= MAX_REFERRAL_QUERY_LENGTH ? value : '';
    }
    return '';
  } catch {
    return '';
  }
}
