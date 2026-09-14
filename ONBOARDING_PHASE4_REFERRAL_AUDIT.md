# PHASE 4 — Referral Code Audit

Branch `arena/01a09a39-fanal-templetes-app`. Every claim below was read out of the
current tree or produced by running the real code; the numbers at the end are
from the actual test runs.

---

## PART A — What the search actually found

The vocabulary spans **two unrelated referral systems**. They were built
separately, have different formats, and must not be conflated — crediting a
Growth Partner for a customer loyalty code (or the reverse) would pay the wrong
person.

| | **A. Growth Partner referral** | **B. Customer loyalty referral** |
|---|---|---|
| Purpose | attributes a new salon owner to the partner who recruited them | credits a customer who referred a friend to a booking |
| Code format | `^([A-Z0-9]{6,12}\|NEXORA-[A-Z0-9]{4,24})$` | `^NX-[A-Z0-9]{4,8}$` |
| Stored in | `growth_partners.referral_code`, `growth_onboarding.referral_code` | `bookings.metadata.referral_code` (JSONB) |
| Canonical form | `public.growth_normalize_code(text)` — SQL | `normalizeReferralCode()` — `src/lib/customer/schema.ts:592` |
| Client mirror | `normalizeGrowthReferralCode()` — `src/lib/growthPartner.ts:95` | `normalizeReferralCode()` (same function, server and client) |
| Entered by | the onboarding funnel | the booking form |

Deliberately kept apart in the schema too: `20260912_growth_partner_onboarding.sql`
documents that Growth Partner codes "never use the NX- prefix so the two flows
cannot be confused."

**Where the implementation lives** (the files that carry it, by mention count):

```
supabase/migrations/20260928_partner_referrals_table.sql     126
src/lib/growthPartner.ts                                     108   <- client library
supabase/migrations/20260912_growth_partner_onboarding.sql   101   <- base schema + normalizer
src/components/GrowthPartnerSections.tsx                      89   <- partner portal UI
src/components/GrowthPartnerPage.tsx                          71
supabase/migrations/20260916_part1_referral_hardening.sql     62
supabase/migrations/20260921_public_partner_referral_codes.sql 40  <- current authoritative validation
supabase/migrations/20260922_referral_link_attribution.sql    38   <- share-link capture
src/onboarding/OnboardingApp.tsx                              32
src/lib/router.ts                                             30
server/referralAttribution.ts                                 29   <- the one unauthenticated writer
```

The authoritative validators are the **latest** `create or replace` definitions —
`20260921` redefines both `validate_growth_referral_code` and
`link_my_growth_referral`, superseding `20260912` and `20260917`. Auditing the
first definition would have audited dead code.

---

## PART B — 4.1 REFERRAL INPUT

Verdict per arrival route. **No duplicate UI was built**: every route lands in the
one existing field, `#onboarding-referral-code` in
`src/onboarding/screens/ReferralScreen.tsx`.

| Route | Verdict | Where |
|---|---|---|
| manual input | ✅ already worked | `ReferralScreen.tsx:33` — the field; `submit()` trims and calls `linkReferralCode` |
| `?ref=CODE` | ✅ already worked | `readSharedReferralCode()` — `src/onboarding/OnboardingApp.tsx:78` |
| `?referral=CODE` | ❌ **missing — fixed** | was read nowhere in production code |
| Growth Partner share link | ✅ already worked | `partnerReferralShareLink()` emits `/signup?ref=CODE` — `src/lib/partnerReferralLink.ts:20` |
| server-side attribution | ✅ already worked | `POST /api/referral-attribution` — `server/referralAttribution.ts:104` → `capture_growth_referral` → `nexora_referral` cookie + `growth_referral_attributions` token (7-day TTL) |

### B.1 The missing case

`?referral=` was accepted nowhere. Confirmed by searching every `searchParams.get`
and every literal `?referral=`/`&referral=` in `src/`, `server/` and
`supabase/` — **zero** hits in production code.

`ref` is canonical because that is what a partner's share link emits, so it stays
first. `referral` is accepted as an alias because it is the spelling people type
and paste by hand.

### B.2 The fix

One reader, `src/lib/referralQuery.ts` → `referralCodeFromQuery(search)`, used by
both apps that can arrive with a code in the URL:

* `src/onboarding/OnboardingApp.tsx:78` — `readSharedReferralCode()` (kept: its
  name and shape are pinned by `tests/partnerPortalShell.test.ts:467`)
* `src/customer/CustomerApp.tsx:189` — previously hand-rolled
  `new URLSearchParams(...).get('ref')`, with no length cap

Two rules inside it, both worth stating because they are the ones that could
silently mis-attribute somebody:

* **the first parameter present decides** — an over-length `ref` is *not* replaced
  by a usable `referral`, because substituting a different code for the one a
  link actually carried would attribute the owner to somebody else's referral;
* **the reader only extracts, it never validates** — the two apps have different
  formats, and in both the database is authoritative.

---

## PART C — 4.2 REFERRAL NORMALIZATION

### C.1 The audit

| Rule | Client | Database | Verdict |
|---|---|---|---|
| trim | `String.prototype.trim()` | `btrim(text)` — **spaces only** | ❌ **diverged — fixed** |
| case | `.toUpperCase()` | `upper(...)` | ✅ agreed |
| max length | 64 at the URL boundary; format caps it at 31 | CHECK regex caps at 31 | ✅ database is stricter |
| allowed characters | `GROWTH_CODE_RE` — `src/lib/growthPartner.ts:89` | CHECK `growth_partners_code_format` | ✅ identical, now pinned live |
| empty values | `''` → rejected before the RPC | `''` → format check rejects | ✅ agreed |
| malformed values | pre-fill dropped, manual entry | `raise exception 'Invalid referral code'` (22023) | ✅ agreed |

Authoritative validation is server/database-side, as required:
`link_my_growth_referral` (`20260921:42`) normalizes, applies the format regex,
requires an **active** partner row, rejects self-referral, and takes a
`for update` lock before an atomic conditional `update`. The client can supply
only the code string — there is no parameter through which a browser could choose
a partner.

### C.2 The defect

`public.growth_normalize_code` (`20260912:66`) was:

```sql
select upper(btrim(coalesce(p_code, '')))
```

PostgreSQL's single-argument `btrim(text)` removes **spaces only**. So a code
pasted with a tab or a newline kept it:

```
growth_normalize_code(E'\tALPHA01\n')  ->  E'\tALPHA01\n'
```

That value fails the format regex and is rejected as an invalid code. JavaScript's
`String.prototype.trim()` — which `normalizeGrowthReferralCode()` uses — removes
the whole whitespace class. So the **same code** was:

* **accepted** when typed into the onboarding form (`ReferralScreen` →
  `linkReferralCode` normalizes before the RPC), and
* **rejected** when it arrived through the share-link attribution endpoint
  (`/api/referral-attribution` forwards the raw string to
  `capture_growth_referral`, which normalizes with the space-only `btrim`).

Two entry points, two answers for one code — and copy/paste from WhatsApp, email
or a PDF is exactly where a trailing newline comes from.

Measured, before the fix:

```
input="ALPHA01"        db_norm="ALPHA01"        passes_DB_regex=true
input=" alpha01 "      db_norm="ALPHA01"        passes_DB_regex=true
input="\tALPHA01\n"    db_norm="\tALPHA01\n"    passes_DB_regex=false   <- rejected
```

### C.3 The fix

`supabase/migrations/20261004_referral_code_normalization.sql` widens the trim to
the set `String.prototype.trim()` removes:

```sql
select upper(btrim(coalesce(p_code, ''), E' \t\n\r\f\v\u00a0\ufeff'))
```

Registered in `LOCAL_GROWTH_CHAIN` (`server/localSupabase.ts`), which now applies
**25** migrations — so the browser-level tests exercise it, not just PGlite.

**Why this cannot break an existing referral:**

* `growth_normalize_code` has **no EXECUTE grants** (revoked from public/anon/
  authenticated), so it is reachable only from the `SECURITY DEFINER` RPCs beneath
  it — no caller contract changes.
* every stored `referral_code` already satisfies
  `^([A-Z0-9]{6,12}|NEXORA-[A-Z0-9]{4,24})$`, which admits **no whitespace**, so
  no existing row's normalized form changes and the case-insensitive unique index
  on `upper(referral_code)` cannot gain a collision.
* it only ever turns a previously-**rejected** input into a lookup, which still has
  to match an active partner's row. It cannot resolve a code to a different partner.

### C.4 Two client-side consistency fixes

* `partnerReferralShareLink()` emitted `code.trim()`, so a link generated from a
  padded or lowercase code carried that raw form
  (`?ref=alpha01`). It now emits the canonical `?ref=ALPHA01`, so what a partner
  shares is byte-identical to what will be stored.
* `readSharedReferralCode()` returned the raw query value for **any** charset up
  to 64 characters. It now pre-fills only a code the database can actually link —
  canonical form, and dropped when it fails the format check the database itself
  enforces. A rejected value falls back to manual entry instead of pre-filling
  something guaranteed to fail on submit.

### C.5 One intentional contract change

The onboarding client now POSTs the **canonical** code to
`/api/referral-attribution` instead of the raw one from the URL. The server
normalized it either way, and its response already returned the canonical form —
but `tests/dom/referralAttributionBrowserFlow.test.ts` pinned the raw body, so
that expectation was updated (`{ code: 'NEXORA-RAHUL25' }`, not
`'nexora-rahul25'`) with the reason recorded inline. This is the only existing
assertion the phase changed.

---

## PART D — Recorded, not changed

* **`provision_growth_partner` decides "no code supplied" with a space-only
  `btrim`** (`20260916:192`), not the canonical normalizer, so a tab-only code
  takes the explicit-code branch and is rejected by the format check rather than
  auto-generating a `NEXORA-` code. A safe outcome, on an RPC whose EXECUTE is
  revoked from `authenticated` and `anon`, so it is recorded rather than bundled
  into this phase.
* **A blank code auto-generates a public `NEXORA-` code** rather than being
  stored blank — verified, and correct by design (`20260921` is the public-codes
  migration). This was a *suspicion of mine that testing disproved*.
* Existing partner codes were **not** backfilled or rewritten; none need it.

---

## PART E — Verification

`tests/referralCodeAudit.test.ts` (16 tests) runs the **real migrations**
(`20260912`, `20260921`, `20261004`) in PGlite:

* the database normalizer is trim + uppercase, NULL → `''`
* **the client normalizer is compared against the live database output** for 16
  inputs including tabs, newlines, 200-char strings, `undefined`, `null` and `42`
* **the client format check is compared against the CHECK constraint read out of
  `pg_constraint`** — the regex is extracted from the live database, not restated,
  so a migration that widens the format is what fails the test
* the database refuses to store a malformed code
* two partners cannot hold codes differing only by case
* linking is case- and whitespace-insensitive, and stores the **canonical** form
* empty / whitespace / malformed codes link nothing and write no row
* an unknown but well-formed code reads exactly like an inactive one (no
  partner-existence oracle)
* validation and linking are not granted to `anon`
* the customer `NX-` system has its own format, and a partner code is not a
  customer code nor the reverse
* a generated share link carries the canonical form
* the query reader: `ref`, `referral`, precedence, the length cap, and no
  substitution from an unrelated parameter

`tests/dom/referralInputBrowserFlow.test.ts` (5) drives the real `OnboardingApp`
and `ReferralScreen` in jsdom: both arrival routes pre-fill the one field, the
pre-fill is the canonical form, an unlinkable code is not pre-filled, the read is
pure, and a dropped `ref` is never replaced by `referral`.

### Positive controls

Each fix was reverted and the tests were re-run to prove they fail for the right
reason:

| Reverted | Result |
|---|---|
| `growth_normalize_code` back to space-only `btrim` | 3 tests fail: the normalizer, the client/database agreement matrix, and case/whitespace-insensitive linking |
| `?referral=` removed from `REFERRAL_QUERY_PARAMS` | the browser input test and the reader test fail |
| `partnerReferralShareLink` back to `code.trim()` | the share-link test fails |

All three restored → green.

### Runs

```
tsc --noEmit (5.8.3)   exit 0
npm test               1331 tests, 1328 pass, 0 fail, 3 skipped
npm run test:dom         68 tests,   68 pass, 0 fail
npm run build          exit 0
```

`npm test` was 1315 before this phase (+16) and `test:dom` was 63 (+5).
