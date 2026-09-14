# PHASE 6 — Referral Attribution Audit

Branch `arena/01a09e6f-fanal-templetes-app`. Every claim below is either read out
of the current tree or produced by running the real migrations; the numbers at
the end come from the actual runs.

The question this phase had to answer was: **after a referral code validates,
what actually happens — is the relationship persisted server-side, and does it
survive refresh, logout, login and a browser restart?**

Answer: **yes, and it always did — but only because the write path is server-side
end to end.** Nothing needed to be built. What this phase produced is the
evidence and the regression pins, on the existing canonical tables: **no new
table, no new view, no new column and no new migration** (the only files added
are the two test files named in Part F).

---

## PART A — 6.1 Reuse the current database

### A.1 The requested names, resolved against the schema that already exists

| Requested (generic) | Canonical thing that already exists | Defined in |
|---|---|---|
| `growth_partners` | `public.growth_partners` — PK `user_id`, stable surrogate `id`, uniquely indexed case-insensitive `referral_code`, `is_active` | `20260912_growth_partner_onboarding.sql:119` |
| `referral_codes` | `growth_partners.referral_code` (the public code) + `growth_referral_attributions.referral_code` (the anonymous capture, 7-day capability) | `20260912:119`, `20260922_referral_link_attribution.sql:43` |
| `onboarding_sessions` | `public.growth_onboarding` — the **authoritative owner↔partner edge**: `user_id` PK, `growth_partner_id`, `referral_code`, `status`, `linked_at`, `referral_id`, `referral_clicked_at`, `template_*` | `20260912:142` |
| `partner_referrals` | `public.partner_referrals` — the physical ledger (`partner_id` → `growth_partners.id`, globally unique `referred_user_id`, status/conversion CHECKs) | `20260928_partner_referrals_table.sql:28` |
| `referred_users` | `partner_referrals.referred_user_id` + the authoritative `growth_onboarding.user_id` | `20260928:57`, `20260912:142` |
| `partner_conversions` | `partner_referrals.status` / conversion columns + `growth_onboarding.status` + `growth_referral_status_audit` | `20260928:28`, `20260924_referral_lifecycle.sql` |

Two look-alikes were checked and are **not** this domain, so nothing was merged
into them:

* `public.referrals` (`20260908_complete_rewards_qr_referrals_backend.sql:559`)
  is the per-salon customer loyalty ledger: its code is deterministic from the
  customer's own uid (`NX-xxxxxxxx`, `src/lib/customer/schema.ts:581`) and a
  referral is counted from `bookings.metadata.referral_code`. It shares no
  column, function or policy with Growth Partner attribution.
* `public.partner_settings` (`20260909035237_partner_profile_settings.sql:3`) is
  the partner's own profile row.

`public.partner_referral_attribution` (`20260922:86`) is a **view**, not a
store — `security_invoker`, so it inherits the underlying RLS instead of
bypassing it. It projects `growth_onboarding`; it is not a second source of
truth.

### A.2 What the live schema actually contains

Both inventories are asserted by tests, so a future parallel table fails the
build rather than going unnoticed:

* **Runtime (PGlite, the committed chain):** exactly 8 base tables match
  `%referral%|%partner%|%growth%` — `growth_onboarding`,
  `growth_partner_applications`, `growth_partners`,
  `growth_referral_admin_audit`, `growth_referral_attributions`,
  `growth_referral_status_audit`, `partner_referral_events`,
  `partner_referrals` — plus the one projection view above.
* **Every committed migration:** the same 8 tables, plus the two look-alikes
  (`partner_settings`, `referrals`). **No `owner_referrals_v2`, `new_referrals`,
  `referral_system_new`, `*_legacy`, `*_tmp` or `*_copy` exists anywhere** — and
  no `_v2`/`_new` referral migration is in `LOCAL_GROWTH_CHAIN`
  (`server/localSupabase.ts:41`).
* One home per concern: `growth_partner_id` lives in `growth_onboarding` (and is
  snapshotted per grant in `template_handoffs`); `referred_user_id` lives in the
  ledger + the two audit tables; `referral_code` lives in the partner row, the
  attribution edge, the capture row and the ledger.
* Invariants that make "one attribution per account" possible are all indexed:
  `growth_partners_referral_code_key`, `growth_partners_code_case_insensitive_key`,
  `growth_partners_id_key`, `partner_referrals_referred_user_key`,
  `growth_referral_attributions_referral_id_key`.
* Grants: `anon` has **no** table privilege at all on the domain; `authenticated`
  has `SELECT` only (`growth_partners`, `growth_onboarding`,
  `partner_referrals`), and the admin audit table is not readable by clients at
  all. All six tables have RLS enabled.

---

## PART B — What happens after a code validates

```
OnboardingApp.tsx:189-205     signed-in? -> existing-account notice, no capture
                              signed-out? -> capture via POST /api/referral-attribution
  -> src/onboarding/lib/referralAttribution.ts:21         (relative URL, same-origin)
  -> server/referralAttribution.ts -> capture_growth_referral()
       insert into growth_referral_attributions (token_hash = md5(token),
       7-day expires_at, consumed_at null)       20260922:43
       + HttpOnly nexora_referral cookie (SameSite=Lax, path-scoped)
  -> SignupScreen: prepareSignupAttribution() (GET, includeToken) ->
       auth.users.raw_user_meta_data.growth_referral_token
  -> trg_signup_growth_referral  AFTER INSERT ON auth.users   20260922:81
     consume_signup_growth_referral()                         20260928:217
       re-validates partner <-> code <-> is_active for share
       insert into growth_onboarding (...) on conflict (user_id) do update
         ... where o.growth_partner_id is null                20260928:233-240
       update growth_referral_attributions set consumed_by/consumed_at
     create_clicked_partner_referral()  20260928:200  (promote the anonymous click)
     sync_partner_referral()            20260928:110  (maintain the ledger row)
     guard_growth_referral_identity     20260923:42 / 20261005 (defense in depth)
  -> read back: get_my_onboarding_status()   20260912:371   (nothing else)
```

The decided facts:

* The relationship is written **inside the signup transaction**, by a trigger,
  from a capability the browser holds in an HttpOnly cookie. There is no code
  path in which the browser states who its partner is.
* The capability is one-use and short-lived (`token_hash`, `expires_at`,
  `consumed_at`) and is only accepted from `auth.users` INSERT.
* The owner's session is never the source: `get_my_onboarding_status` reads the
  row, and RLS scopes it (`growth_onboarding_select_own_or_partner`,
  `20260912:221`).

---

## PART C — 6.2 The attribution lock

Five classes of attempt, all driven by the tests against real RPC/RLS:

| Attempt | Result |
|---|---|
| signed-in owner opens `?ref=PARTNER-B` | UI shows "This account is already registered. Opening a referral link does not change your existing attribution." **Zero** capture requests, **no** capability cookie, the authoritative row is byte-identical (`tests/dom/referralAttributionPersistence.test.ts`, step 6) |
| owner calls `link_my_growth_referral` with B (or with A again) | refused `22023` "This account is already linked to a Growth Partner"; ledger unchanged |
| owner (or `anon`, or the other partner) writes the tables directly | `permission denied` on UPDATE/INSERT/DELETE for `growth_onboarding` and `partner_referrals`; anonymous reads and the capability ledger are denied too |
| owner's `raw_user_meta_data` edited afterwards with a fresh, unconsumed capability for B | unchanged: the consume trigger is INSERT-only, so nothing re-points an existing account |
| three concurrent link attempts | exactly one winner; one attribution row and one ledger row exist afterwards, and the winner cannot be changed by a later attempt |

And the one legitimate reassignment path, unchanged and privileged:

| `admin_correct_growth_referral` (`20260923:63`) | Result |
|---|---|
| `anon` / `authenticated` / a partner | `permission denied` — granted to `service_role` only |
| missing/short reason | refused (`An audit reason of 5–1000 characters is required`) |
| unknown or inactive target code, self-referral | refused `22023`; no-op |
| re-correcting to the code already stored | silent no-op, **no** audit row |
| valid correction | the same ledger row is re-pointed (never duplicated), `linked_at` is preserved, and exactly one `growth_referral_admin_audit` row records `old_partner_id`, `new_partner_id`, both codes, the actor and the reason |

**A click is not an attribution.** A signed-out visitor opening `?ref=PARTNER-B`
does create a `clicked` ledger row for B with `referred_user_id is null` — but
B's dashboard KPI `total_referrals` stays `0` and the referral list stays empty.
That is the product's existing last-click lead capture (it has no account to
attribute to); it cannot become an attribution for an account that already has
one. Recorded, not changed.

The one-time handoff is also bound to the attribution that existed when it was
minted: after an admin correction, `exchange_template_handoff` fails closed
("Your account cannot continue at this time."), and `template_handoffs`
snapshots the partner id per grant.

---

## PART D — Persistence, point by point

`tests/dom/referralAttributionPersistence.test.ts` runs the whole journey
through the real `OnboardingApp`, real HTTP, real Supabase Auth and real RPC/RLS
on a disk-backed database. Only cookies and `localStorage` are simulated,
because jsdom's `fetch` implements neither.

| Step | What was done | What the server answered |
|---|---|---|
| 1 | opened `?ref=PARTNER-A`, signed up | `linked: true`, `referral_code = A`, `growth_partner_id = A` |
| 2 | **refresh** (remount with no `?ref`) | same payload, byte-identical; zero capture requests |
| 3 | **what the browser remembers** | exactly one key, `sb-127-auth-token` (the Supabase session: `access_token` / `refresh_token` / `user`) — no referral code, no partner id, no attribution key; the owner can read their own row through RLS but the ledger is not readable by them at all |
| 4 | **logout** (real Sign out button) → **login** | the session key is gone; after login the status payload is byte-identical |
| 5 | **browser restart** (localStorage + sessionStorage cleared, new cookie jar, new client) | login screen; after logging in, byte-identical again |
| 6 | later **`?ref=PARTNER-B`** | notice, zero captures, no cookie, direct `link_my_growth_referral` refused `22023`, ledger still 1 row with code A |
| 7 | partner-side reads | A: 1 referral, code A, `referral_status = pending`; B: 0 — the click is not a referral |
| 8 | **server restart** + fresh browser (`stop()` → `boot()` on the same `dataDir`) then login | same partner, same code, same `linked_at` instant; the partner's ledger read after the restart returns the same row |

`tests/referralAttributionLock.test.ts` adds the database half of the same
property: a raw PGlite re-open of the same `dataDir` returns the identical row,
and the lifecycle edges hold (a partner who owns referrals cannot be deleted —
the FK is RESTRICT; deleting the referred **account** cascades the attribution
and ledger row away, which is erasure and not silent rewriting).

---

## PART E — Recorded, not changed

1. **`where o.growth_partner_id is null` (20260928:240) is unreachable
   defence in depth.** The trigger is `AFTER INSERT ON auth.users` and
   `growth_onboarding.user_id` is the account's own key, so the row it writes
   cannot pre-exist. Removing the clause changed no observable behaviour in any
   test. It stays as the cheap backstop it is.
2. **The lock has three independent layers**, and removing the first two still
   does not open it: with both `link_my_growth_referral` guards deleted the
   write is refused by the trigger ("Referral attribution is immutable;
   administrator action required"). See the positive controls.
3. **`referrals` and `partner_settings` are not this domain** (Part A.1). They
   were left exactly as they are.
4. **Existing attributions survive partner deactivation/ban** — `20261005`
   deliberately guards *new* referrals only, and the audit reason is unchanged.
5. **`linked_at` is a server instant** taken once at link time and preserved
   across an admin correction; no browser clock participates.
6. **`growth_referral_admin_audit` keeps the user ids** after the referred
   account is deleted, so a correction remains traceable.

---

## PART F — Verification

New artifacts (the only files this phase adds):

* `tests/referralAttributionLock.test.ts` — 8 tests: schema inventory and
  forbidden parallel names (both at runtime and across every committed
  migration), the `?ref=B`-after-`?ref=A` lock, the audited-only reassignment,
  the no-client-write-path sweep, concurrency, a raw database re-open, and the
  delete/erasure edges.
* `tests/dom/referralAttributionPersistence.test.ts` — the 8-step browser
  journey in Part D.

Existing suites that already pinned parts of this (extended, not duplicated):
`tests/referralOwnershipJourney.test.ts`, `tests/dom/resumeOnboardingBrowserFlow.test.ts`,
`tests/dom/partnerFinalAcceptance.test.ts` (steps 9 and 15),
`tests/dom/partnerExistingReferralBrowserFlow.test.ts`,
`tests/dom/onboardingJourneyBrowserFlow.test.ts`.

### Positive controls

Each mutation was applied to the real file, the suite was run, and the file was
restored (`git diff` clean afterwards).

| Reverted / mutated | Result |
|---|---|
| both guards removed from `link_my_growth_referral` (`20261005:122-138`: the fast refusal **and** the `growth_partner_id is null` predicate) | `6.2 opening ?ref=PARTNER-B…` and `6.2 concurrent link attempts…` **fail** — and the write is still refused, now by the trigger (`Referral attribution is immutable; administrator action required`) |
| the audit `insert` removed from `admin_correct_growth_referral` (`20260923:88`) | `6.2 only an audited administrator correction…` **fails** (no audit row) |
| the signed-in check inverted in `OnboardingApp.tsx:189` (capture even for a restored session) | the browser journey **fails** at step 6 ("existing-account notice for a signed-in owner") |
| the `where o.growth_partner_id is null` clause removed (`20260928:240`) | all 8 tests **pass** — recorded in Part E.1 as unreachable defence in depth rather than claimed as a pin |

All restored → green.

### Runs

```
tsc --noEmit (5.8.3)   exit 0
npm run build          exit 0
npm test               1367 tests, 1364 pass, 0 fail, 3 skipped   (was 1359)
npm run test:dom         69 tests,   69 pass, 0 fail               (was 68)
npm run test:partner    450 tests,  450 pass, 0 fail               (was 441)
```
