# PHASE 7 — PART 3 × Growth Partner Connection

Branch `arena/01a09e6f-fanal-templetes-app`. Every claim below is either read out
of the current tree or produced by running the real migrations; the numbers at
the end come from the actual runs.

The question this phase had to answer: **PART 3 (owner/workspace provisioning)
had to be wired into an existing Growth Partner referral implementation — does it
integrate correctly, and did it grow a second referral model?**

Answer: **it integrates, and it did not — and both are now pinned by tests that
fail if either changes.** No production code, no migration and no table was
written for this phase; the deliverables are the two suites in PART F and the
evidence below.

---

## PART A — The connection, traced

```
share link /signup?ref=CODE
  OnboardingApp.tsx:189-205        signed-in? existing-account notice (no capture)
                                   signed-out? capture once via the real endpoint
  -> POST /api/referral-attribution -> server/referralAttribution.ts
  -> public.capture_growth_referral(p_code, p_token)      20260922:19
       growth_referral_attributions row (md5(token_hash), 7-day expiry,
       referral_id -> partner_referrals.id)  + HttpOnly nexora_referral cookie
  -> auth.users INSERT with raw_user_meta_data.growth_referral_token
  -> trg_signup_growth_referral                            20260922:81
       consume_signup_growth_referral()                      20260928:217
         re-validates partner <-> code <-> is_active
         upserts growth_onboarding (the ONE attribution edge) 20260928:233
         consumes the capability (consumed_by/consumed_at)
     create_clicked_partner_referral()                        20260928:200
     sync_partner_referral()  -> partner_referrals (the ledger) 20260928:110
     guard_growth_referral_identity  (immutability, defense in depth)
                                                   20260923:10 / 20261005:161

PART 3 entry (the owner's side of the same journey)
  StatusScreen -> create_template_handoff()                20260913
  TemplateHandoffPage.tsx:166-168 -> exchange_template_handoff()
  -> ownerWorkspace.resolveOwnerWorkspace()  src/lib/ownerWorkspace.ts
     -> public.ensure_owner_workspace()          20261002:255
          organizations + organization_members(role owner, status active)
          + salons(slug, name, deleted_at null)
     -> redirected into the Template App (src/App.tsx:686-700 entry routing)
  editor cloud save -> recordTemplateCompletion()  WebsiteEditor.tsx:200
  -> public.complete_template_onboarding()        20260914:135
       verifies template_website_is_complete() (the PART 3 workspace path:
       active owner/manager org + named slugged salon + an active service)
       -> growth_onboarding.status = template_completed
       -> sync trigger -> ledger status/conversion_status = converted
  partner portal reads: get_my_partner_dashboard 20261001:25,
       get_my_partner_referrals -> _filtered 20260926:40 / :120,
       get_my_partner_referral_detail 20260926:127
```

**Where PART 3 touches the referral chain: nowhere.** `20261002` writes
`organizations`, `organization_members`, `salons` (and reads `profiles` for the
workspace name); it names no referral table, no `referral_code`, no
`growth_partner`, and no `referral_status`. It is verified in PART C rather than
asserted here.

---

## PART B — The eight connections, verified

| # | Connection | How it is enforced (canonical) | Verdict |
|---|---|---|---|
| 1 | **Partner referral code generation** | `provision_growth_partner()` — explicit code normalized (`growth_normalize_code`) and validated against `^([A-Z0-9]{6,12}\|NEXORA-[A-Z0-9]{4,24})$`; omitted code reuses the partner's existing one, or mints `NEXORA-` + 12 hex with bounded collision retry (`20260921:115-167`). The application queue's approval path delegates to the same helper (`20260919:253-262`). | ✅ one generator, one format |
| 2 | **Partner ownership of referral code** | `growth_partners.referral_code` is unique (exact **and** case-insensitive: `growth_partners_referral_code_key`, `growth_partners_code_case_insensitive_key`), the CHECK constraint is the same pattern, and a code cannot be claimed by another account (`23505`, `already in use`). Deactivation stops *new* referrals without releasing or reassigning the code. | ✅ |
| 3 | **Referred user mapping** | `growth_onboarding.user_id` (PK) is the account; `partner_referrals.referred_user_id` is the same id, globally unique where not null (`partner_referrals_referred_user_key`). The anonymous click is **promoted**, not duplicated: `capability.referral_id = ledger.id = growth_onboarding.referral_id`. A click with no account stays `clicked` with `referred_user_id is null` and is not a referral. | ✅ by id, never by email/phone |
| 4 | **Signup attribution** | Written inside the `auth.users` INSERT transaction from the one-use capability; the owner's own `growth_onboarding` row and RLS policies keep it private to the owner and the owning partner. Re-verified byte-for-byte across the PART 3 provisioning step (the new test asserts the row *and* the ledger row are unchanged by `ensure_owner_workspace()`). | ✅ |
| 5 | **Referral status** | `growth_effective_referral_status(status, override)`: `linked→pending`, `template_started→active`, `template_completed→converted`, with an admin-only override limited to `inactive/cancelled/rejected` and audited in `growth_referral_status_audit` (`20260924:8-11, :32`). Milestones are forward-only and never re-timestamp. | ✅ |
| 6 | **Partner dashboard visibility** | `get_my_partner_dashboard` (KPIs + `referral_status_counts` + activity) and `get_my_partner_referrals` (rows, status tabs, search, paging) are **caller-scoped** through `partner_dashboard_caller()`; a non-partner is refused, another partner sees `total: 0` and `null` details. Contacts are masked inside the database (`growth_mask_referral_email`) and the raw email / phone / user id never appear in the payload. | ✅ |
| 7 | **Conversion status** | The only converter is the verified completion: `complete_template_onboarding()` requires `template_website_is_complete()` — on the normalized (PART 3) path an active owner/manager membership plus a named, slugged salon plus an active service. Only then does the milestone flip to `template_completed`, which the sync trigger propagates to the ledger as `status/conversion_status = converted` with `converted_at`. An unfinished website is refused and changes nothing; a second completion is idempotent. | ✅ cannot be faked |
| 8 | **Duplicate prevention** | One attribution edge per user (PK), one ledger record per user (unique index), immutability trigger on both, one-use capability (consumed at signup, expired tokens are not reused), a second account cannot be attributed by a spent capability, and self-referral is refused by the CHECK constraint, by the guard trigger and by `link_my_growth_referral`. A code may serve **many** users — duplicates are per user, not per code (asserted, so the rule is not over-applied). | ✅ |

Each row is executed, not inspected, in
`tests/part3GrowthPartnerIntegration.test.ts` (tests 7.1–7.8) and, for the
journey as the partner experiences it, in
`tests/dom/part3GrowthPartnerJourneyBrowserFlow.test.ts` (signup → partner sees
**Pending** → handoff + workspace → partner sees **Active** → verified
completion → partner sees **Converted**, same single record, same attribution).

---

## PART C — One model, verified mechanically

`tests/part3GrowthPartnerIntegration.test.ts` asserts the boundary from four
directions:

1. **No referral object in the PART 3 migration** — the applied file is read and
   matched: no `create table … referral`, no `referral_code` / `growth_partner` /
   `referral_status`, no reference to `growth_onboarding` or `partner_referrals`.
2. **No referral column on any PART 3 table** — `organizations`,
   `organization_members`, `salons`, `services` match nothing for
   `%referral% | %partner% | %growth%` in `information_schema.columns`.
3. **The schema-wide inventory is still the canonical eight tables** (plus the
   `partner_referral_attribution` projection view, `security_invoker`), and
   `growth_partner_id` still lives in exactly two places — `growth_onboarding`
   (the attribution edge) and `template_handoffs` (the single-use grant
   snapshot). A parallel table (`owner_referrals_v2`, …) fails the build.
4. **No PART 3 function writes the edge** — a catalog scan for functions whose
   source mentions `growth_partner_id` and whose name looks owner/workspace
   returns none; `ensure_owner_workspace()` executes and both the attribution row
   and the ledger row are byte-identical afterwards.

**The one legacy shape that could have become a second model was checked and is
already dead.** `20260911094853_growth_partner_signup_approval.sql:54` inserts
into `growth_partners(user_id, partner_code, referral_code, status)` with
`NXGP-…` / `REF-…` codes — columns that do not exist and a format the CHECK
rejects. It is superseded later in the same chain (applied after it) by
`20260919_growth_partner_area_contract_alignment.sql:203`, which delegates
approval to `provision_growth_partner()`. The new test drives the real approval
path (submit with KYC → admin review) and asserts the returned code matches
`^NEXORA-[A-Z0-9]{12}$` and that the partner row has exactly the canonical
columns `{created_at, id, is_active, referral_code, updated_at, user_id}` — so if
the legacy definition ever wins again, that test fails rather than quietly
creating a second code store.

---

## PART D — Positive controls

Each mutation was applied to the real file, the suite was run, and the file was
restored byte-for-byte in a `finally` block (`git status` clean afterwards).
All four are reproducible with one command — `node scripts/phase7PositiveControls.mjs`
(~13s, exits non-zero if any control comes back green or a file is not restored);
the results below are that script's output.

| Mutated (reverted in place) | Result |
|---|---|
| `growth_effective_referral_status()` maps `template_completed → 'converted'` (`20260924:12`) changed to `'active'` | `7.7 …converts the referral…` **fails** (`expected 'converted', actual 'active'`) and the browser journey **fails**: the partner's KPI reads `1 Total / 1 Active / 0 Pending / 0 Converted` instead of `1 Converted` |
| `get_my_partner_referrals_filtered` returns `u.email` instead of `growth_mask_referral_email(u.email)` (`20260926:71`) | `7.6 …masked, scoped to the owning partner` **fails** (`expected 'vi***@example.com', actual 'visible.owner@example.com'`) |
| the PART 3 migration creates `public.owner_referrals_v2` | `7.4 …survives the PART 3 workspace step…` **fails** on the table inventory (`+ 'owner_referrals_v2'`) and `7.9 PART 3 consumes the referral model…` **fails** with `no referral table` |
| `ensure_owner_workspace()` deletes the caller's `partner_referrals` row | `7.4 …` **fails** on the byte-for-byte ledger comparison |

All restored → green.

---

## PART E — Recorded, not changed

1. **Anonymous clicks are not deduplicated by design.** A visitor with no cookie
   clicking the same link twice creates two `clicked` ledger rows (no account
   identity exists to dedupe on). Neither can become a second attribution — the
   per-user unique index and the trigger make that impossible — and neither
   counts as a referral: the dashboard's totals come from `growth_onboarding`,
   which is asserted (`totalReferrals` stays 2 for two real users while two
   anonymous clicks sit beside them).
2. **`get_my_partner_referrals` is a thin wrapper** over
   `get_my_partner_referrals_filtered` (`20260926:120`). Both are used by the
   portal; the four-argument call is kept for older clients. No new wrapper was
   added.
3. **The PART 3 workspace step is best-effort by design**
   (`src/lib/ownerWorkspace.ts` — it never throws, and `TemplateHandoffPage`
   enters the Template App regardless). This phase did not change that: an
   unresolved workspace cannot travel back into the referral chain because
   nothing in the referral chain reads it.
4. **Referral status is read from the milestones, not from the ledger's status
   column.** The ledger is a write-through projection (`sync_partner_referral`,
   `20260928:110`), so both are asserted to agree in the tests rather than
   assumed.
5. **Two things the live-schema test had to model, stated plainly:** the shared
   fixture (`tests/liveSchemaFixture.ts`) models only the columns the server
   reads, so the test adds production's `profiles` shape (00001), `salons.deleted_at`
   and the `auth` schema usage the client roles have; and it grants the
   `service_role` default EXECUTE the local gateway also sets. Without them the
   fixture – not the product – would be what fails.
6. **The browser journey seeds the editor's save.** The local gateway serves no
   REST route for `profiles`/`services` (`LOCAL_TABLE_ALLOWLIST`), so the two
   rows the legacy editor save writes are inserted while the gateway is stopped,
   and the completion itself is the real `complete_template_onboarding()` RPC the
   editor calls. Everything else in that test — capture, signup, handoff,
   workspace, partner portal, statuses — goes through the real components.

---

## PART F — Verification

New artifacts (the only files this phase adds):

* `tests/part3GrowthPartnerIntegration.test.ts` — 9 tests on the live normalized
  schema with the whole committed growth chain plus PART 3 applied: the eight
  connections in PART B and the boundary in PART C.
* `tests/dom/part3GrowthPartnerJourneyBrowserFlow.test.ts` — the same journey
  through real React components + real HTTP/Auth/RPC/RLS on disk-backed
  PostgreSQL, ending with the partner portal showing the referral move
  Pending → Active → Converted.

Existing suites that already carried parts of this (extended, not duplicated):
`tests/dom/onboardingJourneyBrowserFlow.test.ts` (share link → signup → handoff →
workspace), `tests/dom/partnerFinalAcceptance.test.ts` (ledger, portal, masked
contact), `tests/templateCompletion.test.ts` (verified completion),
`tests/referralOwnershipJourney.test.ts` and
`tests/referralAttributionLock.test.ts` (ownership and the lock).

### Runs

```
tsc --noEmit (5.8.3)   exit 0
npm run build          exit 0
npm test               1376 tests, 1373 pass, 0 fail, 3 skipped   (was 1367)
npm run test:dom         70 tests,   70 pass, 0 fail               (was 69)
npm run test:partner    451 tests,  451 pass, 0 fail               (was 450)
```
