# Backend + Live Appointment Flow — Final Report

**Date:** 2026-09-10 · **Branch:** `arena/01a0898b-fanal-templetes-app` · **Commit:** `500333c`
**Lineage:** continues PR #39 (`fix/live-calendar-overview`, merged) and PR #40 (`fix/dashboard-salon-resolution`, merged)

---

## ROOT CAUSE

`POST /api/owner/appointments` calls `rpc('create_owner_booking', …)` (added in PR #39,
`server/ownerDashboard.ts` → `createOwnerAppointment`), **but no migration had ever created
that function in the connected Supabase project** (`qwaehqsmodekbgvnaavz`). The repo's
migrations and SQL history contain no definition of it, and `SUPABASE_SETUP.md` documents
that only `20260909142000_normalized_owner_workspace.sql` was ever applied live.

Every manual appointment save was therefore rejected by the database:

```
PostgREST  HTTP 404
  code:    PGRST202
  message: Could not find the function public.create_owner_booking
           without parameters in the schema cache
  ← Postgres 42883: function public.create_owner_booking(uuid, uuid[], uuid,
                    timestamptz, uuid, text, text, text, boolean, text)
                    does not exist
```

Reproduced exactly (same SQL, same error code and message) against a real Postgres engine
(PGlite) loaded with the live normalized schema contract — see
`tests/ownerBookingRpcMigration.test.ts` test 1 and `tests/ownerBookingLivePath.test.ts`
test 1.

Dashboard **reads** are plain table selects, which is why the calendar worked and showed
`0 real bookings` while every **create** failed. The old handler then masked the rejection
as a generic `503 database_unavailable`, hiding the real cause.

## CODE FIX (application)

`server/ownerDashboard.ts` — `createOwnerAppointment`:
* refuses **editor-only / placeholder / non-UUID catalogue ids** (`srv-1`, `st-default`,
  `custom`, array indexes, slugs) before they can ever reach a database foreign key;
* reports a missing service vs a missing specialist as **separate, actionable errors**
  (409 `service_unavailable` / `staff_unavailable`) — no silent substitution anywhere;
* hashes the booking reference per owner (`sha256(actor:reference)`), the same idempotency
  scheme as the customer checkout path, so a retried submit returns the original booking;
* passes the client email as `p_customer_email` (stored on the canonical customer record)
  instead of burying it in the note.

`server/ownerBookingErrors.ts` (new): maps database rejections to actionable errors —
`PGRST202/204`, `42883`, `42P01` → 503 `booking_rpc_missing` (names the migration to
apply); `42501` → 403 "outside your salon workspace"; `23503` → 409 service/staff
unavailable; `23P01` → 409 slot conflict; `23505` → 409 duplicate reference; `22023` →
409 with the RPC's own customer-safe message. The raw code/message/details/hint are logged
**server-side only** (with auth uid, salon id, catalogue ids, requested local time) — never
sent to the browser.

`src/components/AppointmentsCalendarView.tsx`: the new-appointment form no longer
substitutes `services[0]` / `stylists[0]` when the selected record is gone (old code could
silently book a different service). Selection is validated by the new exported
`buildAppointmentDraft()` mapper, which only forwards **persisted catalogue UUIDs**, and
empty catalogues produce an actionable "save a service and specialist first" error.

## DATABASE FIX (migration)

`supabase/migrations/20260910200000_create_owner_booking.sql` — **one idempotent
migration** (safe to paste into the Supabase SQL Editor and re-run; verified by test):
* creates exactly one function `public.create_owner_booking(...)` (plus two private
  column-introspection helpers). **No table, column, index, constraint, policy or grant is
  created, dropped or changed; no data is touched.**
* caller-authorized `SECURITY DEFINER` (same model as `nexora_save_owner_workspace`):
  the caller must be an **active owner/manager/receptionist of the salon's organization**
  — the same membership rule the API enforces. Cross-salon calls fail `42501`.
* **atomic**: customer upsert → booking row → booking line items in one transaction; any
  failure rolls everything back (verified by test).
* walk-in support: the salon-scoped `salon_customers` row is upserted by phone — **no
  pre-existing customer and no fake auth user is ever required** (`p_customer_user_id`
  stays null).
* validates services/staff belong to the resolved salon and are active; enforces
  staff-service assignments when the salon saved them (`22023`);
* rejects overlapping slots for the same specialist (`23P01`) and mirrors the
  `bookings_staff_active_slot_no_overlap` exclusion constraint for schema generations
  where it is absent;
* idempotent per booking reference — a retry returns the original booking id;
* writes **only columns that exist in the live table** (checked against
  `information_schema` at call time), so an unknown optional column cannot cause `42703`;
* `revoke … from public, anon`, `grant execute … to authenticated`, and
  `notify pgrst, 'reload schema'` so PostgREST picks it up immediately.

## SECURITY

* **No RLS weakened.** RLS stays enabled on all tenant tables (test asserts direct
  `authenticated` inserts into `bookings` are still refused). The RPC is `SECURITY
  DEFINER` with explicit membership checks inside — the established pattern in this
  codebase — and anonymous execution is revoked (test: `anon` → permission denied).
* Cross-salon creation is denied at **two layers**: the server resolves the salon from
  verified membership only, and the RPC re-verifies it (`42501`, test-pinned).
* The stale-slug fallback remains "exactly one authorized salon" — never global-first,
  never another owner's salon (tests in `tests/ownerDashboard.test.ts` +
  live-path test 4).
* No service-role credentials in client code; the browser still sends only the user's
  session token. Server logs carry diagnostics, the browser receives mapped messages only.

## LIVE APPOINTMENT TEST (`Backend Verification`)

End-to-end acceptance was executed against a **real Postgres engine (PGlite)** loaded with
the live normalized schema contract **and the actual migration file**, driving the **real
server handlers** (`createOwnerAppointment` → `readOwnerDashboard` →
`updateNormalizedBooking`) — the strongest verification possible from this environment.
What could **not** run here: the hosted production database itself (see FINAL STATUS).

| # | Step | Result |
|---|------|--------|
| 1 | Sign in → dashboard loads (`GET /api/owner/dashboard`) | **PASS** — verified session token → membership → salon; empty databases stay empty |
| 2 | Create appointment `Backend Verification` (`POST /api/owner/appointments`, empty customer table) | **PASS** — RPC returned a booking uuid; `bookings`, `booking_items` and `salon_customers` rows persisted with real salon/service/staff ids, `status='confirmed'`, `total_paise=50000`, `currency='INR'`, `created_by=auth.uid()` |
| 3 | Row persisted in the database (all FKs are real persisted ids) | **PASS** — `salon_id`, `staff_id`, `service_id`, `salon_customer_id` all reference persisted rows (asserted in SQL) |
| 4 | Calendar/dashboard displays the appointment (client name, service, specialist, salon-local date/time) | **PASS** — `2026-09-12`, `10:00` IST, `Signature Cut`, `Priya`; calendar render test with real data passes and asserts no mock data |
| 5 | Browser-style refresh (new dashboard read) → appointment still there | **PASS** — fresh `readOwnerDashboard` returns the same persisted row (no localStorage/mocks involved) |
| 6 | Cancel via the real app flow (`POST /api/bookings/update` → `updateNormalizedBooking`) → refresh | **PASS** — `status='cancelled'`, `cancelled_at` set, row still present after re-read; retrying the same slot for that specialist then succeeds (cancelled slots don't stay active) |
| 7 | Totals from real data; cancelled booking not counted as active | **PASS** — revenue counts completed only (0 after cancel), "Appointments" counts all records (1), customers count real `salon_customers` rows |

Not executable from this sandbox (see FINAL STATUS): the **hosted** Supabase project and
the deployed Vercel app. Those steps are the user's 5-minute runbook below.

## TESTS

* **Full regression:** `npm test` → **861 tests, 858 pass, 0 fail, 3 skipped**
  (the 3 skips are the pre-existing credential-dependent ones). Baseline before this
  change: 837 tests / 834 pass / 3 skipped. Nothing regressed.
* `tsc --noEmit` (typecheck + lint script) — clean. `npm run build` (vite + esbuild) —
  passes.
* New regression suites (24 new tests):
  * `tests/ownerBookingRpcMigration.test.ts` (12) — exact pre-migration rejection
    (`42883`), idempotent migration + grants, anon denied, empty-customer creation,
    atomic rollback, reference idempotency, cross-salon denial (incl. inactive member),
    retired catalogue, staff-service mapping, slot overlap, cancellation persistence,
    RLS still blocking direct inserts.
  * `tests/ownerBookingLivePath.test.ts` (6) — PGRST202 → actionable 503
    `booking_rpc_missing`; full create → read → refresh → cancel → re-read flow through
    the real handlers; cross-owner denial; stale slug → sole authorized salon; editor/placeholder
    ids never reach FKs; slot conflict → 409 `slot_conflict`.
  * `tests/appointmentsCalendar.test.ts` (4) — calendar renders real saved data (no mock
    data), empty salon stays empty, draft uses persisted service/staff database ids
    (**C/D**), missing catalogue record is an error, never a substitution.
  * `tests/ownerDashboard.test.ts` (+3) — payload contract (UUID-only catalogue ids,
    hashed reference, email param), missing-record errors, and the error-mapping table
    (PGRST202/42883/42501/23503/23P01/22023 → status + code + message).
* Required scenarios A–G: **A** stale slug + sole authorized salon (ownerDashboard.test.ts
  + live-path #4) · **B** stale slug/unauthorized salon denied (ownerDashboard.test.ts +
  migration test #7 + live-path #3) · **C/D** persisted DB ids in dropdowns/payload
  (appointmentsCalendar.test.ts + live-path row assertions) · **E** empty customer table
  (migration #4 + live-path #2) · **F** survives refresh (live-path #2) · **G** cancelled
  appointment persists with status (migration #11 + live-path #2).

## PR

Commit `500333c` on `arena/01a0898b-fanal-templetes-app` (this session's branch, same
lineage as PRs #39/#40, which are already merged — so a new focused PR is required rather
than reopening #39). **The push could not be completed:** this sandbox's GitHub token is
read-only (`git push` → `Authentication failed`; `gh auth status` → "token no longer
valid"). The commit is in the workspace and ready; **reconnect GitHub in Arena (or push
from a local clone: `git push origin arena/01a0898b-fanal-templetes-app`) and open the PR
from that branch into `main`** with the commit message as the PR description.

## USER RUNBOOK (5 minutes, live)

1. Supabase dashboard → project `qwaehqsmodekbgvnaavz` → **SQL Editor** → paste the whole
   contents of `supabase/migrations/20260910200000_create_owner_booking.sql` → **Run**.
   (Idempotent; expect `SUCCESS`.)
2. Deploy this branch (Vercel preview auto-deploys on push) or run `npm run dev`.
3. Sign in → Calendar → **Add Appointment** → client name `Backend Verification` → pick
   the saved service + specialist → date/time → **Add**.
4. Verify: the appointment appears; refresh the browser — still there; sign out/in — still
   there; totals reflect it; open it → **Cancel**; refresh — it stays with status
   `Cancelled` and no longer blocks that specialist's slot.

---

## FINAL STATUS

**BLOCKED** — the fix is complete and verified against a real Postgres engine, but the
live flow (real browser → hosted Supabase) could not be executed from this sandbox:

* **Exact remaining failure:** no live-DB connectivity from this environment — the
  sandbox's egress proxy cuts TLS to every host except github.com and registry.npmjs.org
  (`qwaehqsmodekbgvnaavz.supabase.co` and `fanal-templetes-app.vercel.app` both fail the
  TLS handshake), and no Supabase credentials (`.env` / `SUPABASE_URL` / anon key) exist
  in the sandbox. GitHub push is likewise unavailable (read-only token).
* **Raw database error code:** `42883` (`function public.create_owner_booking(…) does not
  exist`), surfaced by PostgREST as **`PGRST202` / HTTP 404** — reproduced exactly and now
  fixed by the migration; the remaining blocker is only that the migration has not yet
  been applied to the hosted project and the branch has not been pushed.
* **Smallest concrete next actions:** (1) paste
  `supabase/migrations/20260910200000_create_owner_booking.sql` into the Supabase SQL
  Editor and Run (step 1 above); (2) push this branch (reconnect GitHub in Arena or push
  from a local clone) and merge the PR; (3) run the 4-step live check above in the
  browser. With (1) alone, the existing deployed app will already save appointments.
