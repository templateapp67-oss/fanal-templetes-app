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
