// ============================================================================
// Service gender — one vocabulary, one matching rule, used by both data paths.
//
// WHY THIS FILE EXISTS
// --------------------
// The Discover screen has a "Gender / service type" filter. Until now the value
// it filtered on was assembled inline in two places with two different
// fallbacks, and neither the `services` table nor `mapServiceRow` ever carried a
// gender, so every salon looked like `['All genders']` and picking "Women"
// emptied the list instead of narrowing it.
//
// The rule implemented here is the one a customer actually means:
//
//   • A salon matches a requested gender when ANY of its published services is
//     for that gender, or is unisex ("All genders"), or has no gender at all.
//   • "No gender published" therefore matches every request — a salon that
//     never set the field is never hidden by the filter. That is what keeps the
//     filter usable on deployments where the owner has not tagged services yet,
//     instead of silently returning zero results.
//
// Gender reaches the API from exactly one place: the owner's website editor
// payload (`salons.data.editor_services[].gender`, merged by
// `mergeServicePresentation`). There is no `services.gender` column in this
// schema — see supabase/migrations/00001_init.sql:109 — and none is added here.
// ============================================================================

/** The only gender values the owner editor and the customer filter agree on. */
export const SERVICE_GENDERS = ['All genders', 'Women', 'Men', 'Kids'] as const;

export type ServiceGender = (typeof SERVICE_GENDERS)[number];

/**
 * Normalize anything that claims to be a service gender. Unknown, blank or
 * missing values become `undefined` — meaning "this service has no published
 * gender", which `salonMatchesGender` treats as a match for every request.
 */
export function normalizeServiceGender(value: unknown): ServiceGender | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const exact = SERVICE_GENDERS.find((entry) => entry.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;
  // Owners type free text in the editor; accept the obvious spellings rather
  // than dropping the tag (a dropped tag silently widens the salon's audience).
  const aliases: Record<string, ServiceGender> = {
    all: 'All genders',
    unisex: 'All genders',
    everyone: 'All genders',
    any: 'All genders',
    female: 'Women',
    woman: 'Women',
    ladies: 'Women',
    male: 'Men',
    man: 'Men',
    kids: 'Kids',
    kid: 'Kids',
    children: 'Kids',
    child: 'Kids',
  };
  return aliases[trimmed.toLowerCase()];
}

/**
 * The distinct published genders of a service list, in the canonical order, for
 * display ("Women, Kids") and for the customer filter. Services without a
 * gender contribute nothing — an empty result means "this salon publishes no
 * gender tags at all", which callers must not confuse with "unisex only".
 */
export function serviceGendersOf(services: Array<{ gender?: unknown } | null | undefined> | undefined): ServiceGender[] {
  if (!Array.isArray(services)) return [];
  const found = new Set<ServiceGender>();
  for (const service of services) {
    const gender = normalizeServiceGender(service?.gender);
    if (gender) found.add(gender);
  }
  return SERVICE_GENDERS.filter((entry) => found.has(entry));
}

/**
 * Does this salon satisfy a customer's gender request?
 *
 * `requested` blank/unknown → no filtering at all.
 * `genders` empty (nothing published) → matches, see the header note.
 * Otherwise → the salon must offer the requested gender or a unisex service.
 */
export function salonMatchesGender(genders: unknown[] | undefined | null, requested: unknown): boolean {
  const want = normalizeServiceGender(requested);
  if (!want) return true;
  const published = serviceGendersOf((Array.isArray(genders) ? genders : []).map((gender) => ({ gender })));
  if (!published.length) return true;
  return published.includes('All genders') || published.includes(want);
}
