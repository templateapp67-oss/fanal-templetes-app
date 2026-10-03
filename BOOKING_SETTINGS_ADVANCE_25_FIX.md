# Booking Settings Persistence — the 25% Advance Fix

**Status:** application fixed and tested against a real Postgres engine. One
rerunnable migration must be applied to the Supabase project (see
*Migration path*).

---

## The symptom

Signup, Profile Setup, Template Selection and the Services save all failed with:

```
23514  new row for relation "public.salon_booking_settings"
       violates check constraint "salon_booking_settings_deposit_25_check"
```

Four unrelated screens, one error — because all four end in the **same
transaction**. `save_owner_editor_state` (called directly by the editor, and by
`POST /api/website/save`) commits the profile, the catalogue and the template
selection together, so one rejected `salon_booking_settings` row rolled all of
it back.

## Root cause

**The application had no single owner of the advance percentage.** Nine
different places produced one, and they disagreed:

| Where | What it produced |
| --- | --- |
| `server.ts` demo profile + `mapProfileRow` | `20` |
| `server/siteLookup.ts` (3 sites) | `20` |
| `server/customerRoutes.ts` booking intent | `Number(row.deposit_percentage ?? 20)` |
| `src/lib/customer/mappers.ts` | `num(row.deposit_percentage, 20)` |
| `src/customer/screens/Book.tsx` | `Number(salon?.depositPercentage ?? 20)` |
| `src/lib/ownerSalonResolution.ts` blank profile | `20` |
| `src/lib/autoSave.ts` API fallback | `Number(profile.depositPercentage ?? 25)` → **NaN** |
| `server/websiteSave.ts` | clamped to 0–100, and **forwarded the client's `bookingSettings` verbatim** |
| `src/lib/websiteContentNormalize.ts` | healed deposit keys only when one was present |

The values round-tripped: a read default of 20 landed in editor state, the next
save wrote 20 into `salon_booking_settings`, Postgres rejected it, and the whole
transaction was lost.

The previously merged migration
(`20261102000000_salon_booking_settings_deposit.sql`) relaxed the check to a
0–100 range. That is the opposite of the product rule — the advance **is** 25%,
the customer UI already says *"Required Advance Payment (25%)"*
(`BookingModal.tsx`), and the hotfix applied in the SQL Editor normalizes to 25.
Relaxing the constraint let 20% through instead of making the app send 25%.

## What changed

### One source of truth — `src/lib/advanceDeposit.ts`

* `REQUIRED_ADVANCE_PERCENT = 25` (`DEFAULT_DEPOSIT_PERCENT` kept as an alias).
* `normalizeDepositPercentage()` returns **25 for every input** — 0, null,
  `undefined`, `''`, NaN, `20`, `999`, `'25%'` — and logs a safe one-line
  diagnostic naming the field and the value it replaced. No row, no ids, no
  tokens.
* `buildBookingSettingsPayload(profile, explicit?)` is the **only** place a
  `salon_booking_settings` payload is built. The percentage is never taken from
  a caller; only the two owner switches are.
* `accept_online_bookings` defaults to **true** when unspecified and preserves an
  explicit **false** — an owner who paused bookings stays paused.
* `computeAdvanceDeposit()` stays pure arithmetic (no normalization) so the
  checkout maths remains unit-testable; the contract is enforced at the
  boundaries.

### Every writer and reader now goes through it

`src/lib/salonSync.ts` (`toProfileRow`) · `src/lib/ownerEditorState.ts` (the
editor RPC) · `src/lib/autoSave.ts` (`saveViaWebsiteApi`) ·
`src/lib/websiteContentNormalize.ts` (heals 0/null/20 on every save, not only
when a deposit key is present) · `server/websiteSave.ts` (**derives** the
booking settings server-side and no longer trusts the request body; logs when it
ignores a wrong percentage) · `server/siteLookup.ts` · `server/customerRoutes.ts`
· `src/lib/customer/mappers.ts` · `src/customer/screens/Book.tsx` ·
`src/lib/ownerSalonResolution.ts` · `src/lib/salonStore.ts` · `src/mockData.ts` ·
`server.ts`.

### Errors an owner can act on — `src/lib/bookingSettingsErrors.ts`

The raw text `Profile save failed (23514): new row for relation … violates check
constraint "salon_booking_settings_deposit_25_check"` used to reach the screen
verbatim from `UserProfileSettingsModal` and `PartnerProfileModal`. Both now show
one instruction and keep the SQLSTATE + message in the console.
`server/websiteSave.ts` answers a booking-settings 23514 with
`400 BOOKING_SETTINGS_INVALID` instead of `503 WEBSITE_SAVE_FAILED`, and
`websiteSaveErrors.ts` classifies it as a named field
(*Booking settings › Advance payment*) so the toast and the pinned issue agree.
An unrelated 23514 is **not** mislabelled — the predicate requires both a check
violation and the table/constraint name.

### Services are written independently

`syncSalonToSupabase` already runs each table as its own operation and collects
errors per table; `tests/bookingSettingsSaveFlow.test.ts` now pins that a
rejected `profiles` write does not stop the `services` write. The live path stays
one atomic transaction on purpose — a half-saved website is worse than a
reported failure.

## Migration path

```
supabase/migrations/20261103000000_salon_booking_settings_advance_25.sql
```

Rerunnable, atomic (`begin`/`commit`), distinct dollar-quote tags per block
(`$mig$`, `$norm_body$`, `$constraint_block$`, `$repair_body$`, `$policy_block$`,
`$audit_block$`). It is the schema-correct version of the hand-applied hotfix and
re-installs the same two objects:

1. **`public.nexora_normalize_booking_settings()`** — a trigger function that
   rewrites every advance column *actually present* to 25 before the row is
   written, so no client — including an old browser bundle still sending 20 — can
   reach the check with a wrong value.
2. **`trg_nexora_normalize_booking_settings`** — `BEFORE INSERT OR UPDATE … FOR
   EACH ROW`. BEFORE, because a CHECK is evaluated when the row is written; an
   AFTER trigger would normalize too late and the 23514 would still fire.
3. Legacy deposit/advance CHECK constraints are dropped **before** the repair (a
   constraint pinning a different value would reject the repair itself), a NOTICE
   is raised if one pinned something other than 25.
4. Existing rows are repaired with `set <col> = 25 where <col> is distinct from
   25` — which also clears the NULLs that made `NOT NULL` impossible. **Only the
   advance columns are written**; `require_deposit`, `accept_online_bookings` and
   every other owner setting keep their stored value.
5. Every salon without a settings row is backfilled.
6. `DEFAULT 25` + `NOT NULL`, then one check per advance column under the name
   Postgres itself would give it — `salon_booking_settings_deposit_25_check` for a
   `deposit_25` column. If the live column has another name the constraint is
   still created under that reported name, so a verification that looks for it is
   truthful rather than silently checking nothing.
7. RLS is enabled and the owner policy is created **only when the project has
   none** — existing policies are never dropped or replaced.

Guarantees, each with a test:

* **No guessed or duplicate columns** — every column comes from `pg_attribute`;
  a project that only has `deposit_percent` gets `deposit_percent` repaired and
  no invented columns (`column list stays ['deposit_percent','salon_id']`).
* **Unrelated constraints preserved** — primary key, `salon_id` FK and an
  unrelated CHECK survive.
* **Trigger ordering** — BEFORE ROW, and an audit block raises a NOTICE naming
  any sibling BEFORE trigger on the same table that sorts after the normalizer.
  `trg_salon_booking_settings_sync` from `20261102000000` is an AFTER trigger on
  `public.salons` (a different table) and writes through
  `nexora_upsert_salon_booking_settings()`, so its rows pass through this
  normalizer — compatible, and covered by test C.

## Test results

`npm test` (1921 tests): **1853 pass, 65 fail**. The baseline commit
`b9fcd41` on an identical checkout: **1838 pass, 65 fail**, and the failing test
*names* are identical — zero new failures. Two pre-existing failures that this
code path caused (`ownerWorkspaceRpc`, `savePipeline`) were stale assertions and
are now fixed and passing, which is where the +15 passing tests come from.
`npm run test:dom`: 197 pass / 28 fail, the same count as baseline; the one
differing name passes in isolation on both trees (parallel-load flake).

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` (typecheck) | **PASS** — clean |
| `npm run build` (vite + esbuild server bundle) | **PASS** |
| Valid 25% writes accepted | **PASS** (`salonBookingSettingsAdvance25`) |
| 0 / null / 20 / 999 normalized to 25 on INSERT **and** UPDATE | **PASS** |
| Existing rows repaired atomically; columns `NOT NULL DEFAULT 25` | **PASS** |
| Check recreated as `= 25`; unrelated constraints + RLS preserved | **PASS** |
| `accept_online_bookings` default true, explicit false preserved | **PASS** |
| Migration rerunnable (3× → identical state, no duplicate trigger) | **PASS** |
| Schema variant with only `deposit_percent` | **PASS** |
| Chains onto `20261102000000` and normalizes the `salons` trigger's write | **PASS** |
| Editor RPC / API fallback / client sync all send 25 from a 20% state | **PASS** |
| Services written independently of a rejected profile | **PASS** |
| Legacy 20% salon row is quoted 25% at checkout; a 20% client is refused | **PASS** |
| 23514 → owner-facing message; unrelated 23514 not mislabelled | **PASS** |
| Profile persistence after refresh (`hydrationResume`, `ownerEditorStateRefresh`, `profileSettingsSave`, `profileSettingsPersistence`, `completeWebsitePersistence`) | **PASS** (133 tests across these + the files below) |
| Template → editor navigation (`templateHandoff`, `templateExplorerRoutes`, `ownerEditorRedirect`) | **PASS** |
| Services persistence (`salonSync`, `websitePublishRoundTrip`, `websiteTransaction`) | **PASS** |
| Signup / login against a **live** Supabase project | **NOT TESTED** — no `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` in this environment. The 65 pre-existing failures are these credential- and clock-dependent suites (e.g. `customerRoutes` booking tests hard-code `2026-09-30`, now in the past). |
| Applying the migration to the **production** project | **NOT TESTED** — no database credentials here. Verified against PGlite only. |

## Does more SQL have to be run?

**Yes — one file, once:**

```bash
supabase db push      # or paste the file into the SQL Editor
# supabase/migrations/20261103000000_salon_booking_settings_advance_25.sql
```

It is safe to re-run. Until it is applied, a project that still carries the
hand-applied hotfix keeps working (the app now sends 25, which that hotfix
accepts) — but it has no rerunnable record of the change, no `NOT NULL`, no
repaired legacy rows and no preserved-RLS guarantee.

After applying, re-check with:

```sql
select tgname, tgtype from pg_trigger
 where tgrelid = 'public.salon_booking_settings'::regclass and not tgisinternal;
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.salon_booking_settings'::regclass and contype = 'c';
select count(*) from public.salon_booking_settings
 where deposit_25 is distinct from 25;   -- expect 0
```

Those three queries confirm the objects **and** the data. Object existence alone
is what made the previous verification report `PASS` while signup was still
broken.
