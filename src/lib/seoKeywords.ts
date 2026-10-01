/** Shared by controlled-input badges, client tags and crawler HTML. */
export function parseSeoKeywords(value?: string): string[] {
  const seen = new Set<string>();
  return (value || '').split(',').map(term => term.trim()).filter(term => {
    const key = term.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const codePoints = (text: string) => Array.from(text).length;

/**
 * Fit a comma-separated keyword list into `limit` characters by dropping whole
 * keywords from the END: lists are written most-important-first, and a keyword
 * cut in half is worse than a missing one. The kept list is written the way the
 * app writes it everywhere else (`a, b, c` — blanks and repeats removed).
 *
 * Returns `null` when not even the first keyword fits. That is a typing problem
 * (one enormous "keyword"), not a list that is a little too long, so it is left
 * for the owner to fix instead of being cut blindly.
 */
export function fitSeoKeywords(
  value: string | undefined,
  limit: number
): { value: string; kept: number; total: number } | null {
  const keywords = parseSeoKeywords(value);
  const kept: string[] = [];
  let length = 0;
  for (const keyword of keywords) {
    const next = length + (kept.length ? 2 : 0) + codePoints(keyword);
    if (next > limit) break;
    kept.push(keyword);
    length = next;
  }
  return kept.length ? { value: kept.join(', '), kept: kept.length, total: keywords.length } : null;
}
