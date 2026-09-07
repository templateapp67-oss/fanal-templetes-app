# End-to-End Audit II — "Server error (HTTP 500)" at checkout (2026-09-07)

Reported symptom (customer-facing, guest booking):

> **We couldn't save your booking (Server error (HTTP 500)). Please try again —
> your details are still here.**

That message is only produced when `POST /api/bookings/create` answers with a
body that is **not JSON, or JSON without an `error` field** — i.e. the failure
happened *outside* the booking handler, which always answers a structured JSON
error. Two root causes were reproduced locally; both are fixed.

## Root cause 1 — the API crashed at import time (every /api/* route → HTML 500)

`src/lib/supabaseClient.ts` called `createClient(url, key)` at module scope.
`@supabase/supabase-js` throws `supabaseKey is required.` **synchronously** when
the key is empty, and this module is imported at the top of BOTH entrypoints
(`server.ts`, `api/index.ts`). A deployment that set `SUPABASE_URL` (+
`SUPABASE_SERVICE_ROLE_KEY`) but no anon key therefore killed the whole
function before any route existed, so the platform answered every API call with
its own HTML error page — un-parseable by the SPA, hence the bare
"Server error (HTTP 500)".

Reproduced:

```
$ SUPABASE_URL=https://x.supabase.co SUPABASE_SERVICE_ROLE_KEY=svc \
    npx tsx -e "import('./src/lib/supabaseClient.ts')"
IMPORT CRASH: supabaseKey is required.
```

Fixed in `src/lib/supabaseClient.ts`:
- `createClient` is never called with an empty key and never throws out of the
  module (`createClientSafely` + placeholder fallback);
- server-side, a missing anon key falls back to the service-role key so the API
  keeps working, and the gap is reported instead of being fatal;
- more aliases accepted (`SUPABASE_KEY`, `VITE_SUPABASE_*`, `…PUBLISHABLE_KEY`),
  values are de-quoted, `.env.example` placeholders count as "not configured";
- `isMockSupabase` now requires a URL **and** a usable key (previously a URL
  alone claimed "live" and every query failed);
- a machine-readable `supabaseConfig` snapshot feeds `/api/health`.
- Covered by `tests/supabaseClientSafety.test.ts` (5 env permutations, each in
  its own child process).

## Root cause 2 — no database timeout (hung request → platform-killed → HTML 500)

No Supabase call had a timeout. Against a stub that accepts the connection and
never responds, `POST /api/bookings/create` hung for >20s; on a serverless host
the platform kills the invocation and returns its own error page.

Fixed with `server/dbGuard.ts` (`withDbTimeout`, `runDb`, `withRequestTimeout`):
- every DB call on a customer path is time-boxed (6s default, 4s for lookups)
  and retried **once** on transient faults (`fetch failed`, `ECONNRESET`,
  502/503/504, timeout);
- `runDb` never throws — timeouts become `{ code: 'db_timeout' }` results;
- `withRequestTimeout` (9s, `API_REQUEST_TIMEOUT_MS`) guarantees a JSON `504`
  **before** a 10s platform limit can produce an HTML page;
- `describeDbError` maps timeouts/transport faults to `503 + retryable: true`.

Verified against a local Supabase stub:

| Injected fault | Before | After |
| --- | --- | --- |
| DB never answers | hangs >20s → platform 500 (HTML) | `504` JSON in 9.0s, `code: request_timeout` |
| Connection reset | `500 {"error":"TypeError: fetch failed"}` | `503` JSON, retryable, retried once first |
| RLS rejection (42501) | `500` raw | `500` JSON naming `SUPABASE_SERVICE_ROLE_KEY` |
| Missing column (PGRST204) | `500`, booking lost | **`200` — column dropped, booking saved** |

## Also fixed in this batch

1. **Schema-drift recovery** (`insertBookingRow`) — a database one migration
   behind (`booking_type` / `home_address` / `notes` unknown) no longer loses
   the booking: the offending column is dropped and the insert retried, with a
   loud log line. Required columns are never dropped.
2. **Idempotency** — the browser now retries, and so does `runDb`, so the same
   booking could be POSTed twice (classic "row written, answer lost"). The
   handler looks for an existing row with the same `owner_id` + `payment_id`
   (booking ref / Razorpay payment id) and returns it with `duplicate: true`
   instead of double-booking the slot.
3. **Cross-tenant leak** — `GET /api/bookings` returned **every** salon's
   bookings (names, phone numbers, revenue) to any caller. It is now scoped to
   `?owner_id=` / `?subdomain=` / `?email=` and refuses to answer unscoped in
   live mode; the dashboard passes the signed-in owner id.
4. **Silent failures are gone** — the read/update handlers used to answer
   `{ success: true, data: <empty in-memory mock> }` when the database errored,
   so an outage looked like "No bookings found". Live mode now returns the real
   error; the mock store is used only when Supabase is not configured.
5. **`/api/notifications/read`** no longer answers `success: true` after a
   failed update (the badge silently came back on the next poll).
6. **Handler drift** — the five booking/notification read+update handlers were
   hand-copied in both entrypoints. They now live in `server/bookingRoutes.ts`
   and are wired identically in `server.ts` and `api/index.ts`.
7. **`/api/health` is now a real diagnostic** — configuration checks
   (Supabase URL/anon/service-role, Razorpay, webhook), `bookingReady`, and
   `?deep=1` round-trips the `bookings` and `profiles` tables. Secrets are
   reported as booleans only.
8. **Process guards** — `unhandledRejection` / `uncaughtException` are logged
   with stacks instead of silently killing the runtime.
9. **Client resilience** (`src/lib/bookingApi.ts`) — the checkout retries
   transient failures (up to 3 attempts, 20s per attempt), never retries a 4xx,
   reports the server's `error` + `code` + `requestId`, and when the body is an
   HTML error page it shows the status **plus a text snippet** instead of a bare
   number.
10. **No more silent "confirmed"** — if the API is unreachable the booking is
    still kept locally, but the pass now says so and asks the customer to
    confirm by WhatsApp/phone instead of implying the salon received it.
11. **UI failure surfaces** — `BookingManager`, `CustomerBookingPortal` and
    `NotificationBell` check `res.ok` / `success === false`, show the reason,
    disable buttons while a mutation is in flight, roll back optimistic
    "mark as read", and back off polling (3s → max 60s) while the API is
    unhealthy instead of hammering it every 3s forever.
12. **Request ids** — every booking answer (success or failure) carries
    `requestId`, printed in the server logs, so a customer screenshot maps to
    an exact log line.

## Verification

- `tsc --noEmit` — exit 0.
- `npm test` — **295/295 pass** (238 before; +57 across
  `tests/supabaseClientSafety.test.ts`, `tests/dbGuard.test.ts`,
  `tests/bookingCreateResilience.test.ts`, `tests/bookingRoutes.test.ts`,
  `tests/bookingApiClient.test.ts` and new e2e HTTP cases).
- `npm run build` — vite build + esbuild server bundle succeed.
- Live HTTP smoke (mock mode): create → duplicate submit returns the same row
  (`duplicate: true`, one row stored) → list → confirm → 200.
- Fault-injection smoke (stub Supabase): see the table above.

## Operating notes

- Diagnose a failing production checkout with
  `curl https://<your-domain>/api/health?deep=1` — `problems[]` names the exact
  misconfiguration (missing anon key, missing service-role key, unreachable
  table, no salon profile to attach guest bookings to).
- Tunables: `DB_TIMEOUT_MS` (6000), `DB_LOOKUP_TIMEOUT_MS` (4000),
  `API_REQUEST_TIMEOUT_MS` (9000). Raise the last one only if your host allows
  invocations longer than 10s.

## Report-only observations (still not changed)

- Notifications remain in-app only; no email/SMS provider exists in this
  codebase (`resolveOwnerEmail` addresses the row, nothing sends mail).
- `GET /api/bookings/:id` is protected only by the unguessable booking uuid —
  fine for a "manage my booking" link, but it is not authenticated.
- The dashboard's live list requires a signed-in owner id; in mock/preview mode
  it still shows the in-memory bookings of the current process.

---

# End-to-End Audit — Booking / Save / Parity Gaps (2026-09-07)

Scope: full review of the save pipeline, booking API surfaces (dev `server.ts`
and serverless `api/index.ts`), guest-booking flow, owner notifications, and
dev/prod tenant payload parity. Every confirmed bug below was fixed in this
branch; everything under "Report-only observations" is left as noted.

## Confirmed bugs — fixed in this batch

1. **Booking handlers duplicated and drifted between `server.ts` and `api/index.ts`**
   The serverless copy silently omitted `working_hours`/`home_service` when
   serving public tenant data, so editor-configured hours/home pricing were
   missing in production. Both entrypoints now share `server/bookingOps.ts`
   and identical `mapProfileRow` output (working-hours + `home_service`).
   Verified: `GET /api/site/:subdomain`, `POST /api/bookings/create`,
   `POST /api/bookings/update` blocks are textually identical in both files.

2. **Fake-success booking update (live mode)**
   When the database update failed, the handler fell back to mutating an
   in-memory mock row and returned `success:true` — the UI showed "confirmed"
   while Supabase still said "pending". Live mode now reads the current row
   first and surfaces a 500 with the real error; mock fallback is only used
   when Supabase is not configured at all (mock mode).

3. **Reschedule-accept bug**
   Confirming a booking that carried a proposed slot only flipped `status`;
   `booking_date`/`time_slot` were never moved to the proposal and the
   proposal fields were never cleared. `applyBookingUpdate()` now promotes
   the proposed slot on `confirmed` and nulls `proposed_date` /
   `proposed_time_slot` (unit-tested; verified over HTTP in mock mode:
   propose → accept returns the new date/time with proposal cleared).

4. **Guest booking FK crash risk (uuid columns)**
   The public modal posts editor preview ids (`hs-1`, `apt-…`, `cli-…`,
   `srv-…`) which are not uuid-shaped. `sanitizeBookingRow()` drops invalid
   `service_id`/`owner_id` values (null) while preserving denormalized
   `service_name`, and drops unknown payload keys that would raise
   `column … does not exist`. Same class fixed for owner-dashboard
   appointments/clients cloud sync in `src/App.tsx`: local `apt-…`/`cli-…`
   ids now map deterministically to uuids (`toDbId`) for `appointments`/
   `clients` rows, and non-uuid `service_id`/`stylist_id` values are nulled —
   previously every such insert/update failed silently (the error object was
   ignored), so appointments/clients were never persisted to the cloud.

5. **Owner notifications hardcoded to `owner@salon.com`**
   `resolveOwnerEmail()` reads the salon's real `profiles.email` for the
   booking's `owner_id` (falls back only when unknown), and guest-created
   notifications whose `user_email` is missing are back-filled to the real
   owner address before insert.

6. **BookingModal reported success for failed bookings**
   The guest submit handler ignored `!response.ok`/`success:false` and always
   advanced to the "confirmed" screen. It now parses the JSON error, stays on
   the payment step with an actionable inline banner, and only falls back to a
   local demo copy when the API is unreachable (offline/preview).

7. **`home_service` never left the editor**
   Side Panel Customizer's home-service toggle/charge/radius lived only in
   localStorage; `syncSalonToSupabase` now writes `home_service` to
   `profiles` and the editor's profile merge reads it back
   (`data.home_service ?? prev.homeService`).

## Verification

- `tsc --noEmit` — exit 0.
- `npm test` — 139/139 pass (127 prior + 12 new `tests/bookingOps.test.ts`
  covering sanitize, reschedule promotion, notification addressing).
- `vite build` — succeeds (existing chunk-size warning only).
- esbuild bundle of `server.ts` — succeeds.
- HTTP smoke (mock mode): create booking with non-uuid ids → `service_id`/
  `owner_id` null, `service_name` kept; propose reschedule → proposal stored,
  original slot untouched; confirm → slot promoted, proposal cleared; unknown
  id → 404; missing status → 400.

## Deploy checklist (for the live app)

1. Merge/push `arena/01a079e3-fanal-templetes-app` (contains `dab4741` +
   this audit batch) to the Vercel deployment source and redeploy.
2. Run `supabase/migrations/20260907_owner_save_grants.sql` in the SQL editor
   (idempotent) — required by the earlier save-load fix.
3. Sign out and sign back in once.
4. Confirm with the verification SQL in `SUPABASE_SETUP.md` §9.

## Report-only observations (not changed)

- `BookingManager`, `CustomerBookingPortal` and `NotificationBell` never
  inspect HTTP `!ok` or `json.success === false`, so failures render as
  silent empty lists; they also poll every 3 s (cleanup is correct).
- `/api/notifications/read` in both entrypoints returns `success:true` on a
  failed update (identical copies; cosmetic — badge may stay unread).
- Notifications are console-mocked only; no real email/SMS provider exists in
  this codebase.
- Local preview ids (`hs-1`, `apt-…`, `cli-…`) remain safe only in
  non-FK/mock contexts; they are now systematically downgraded at every
  Supabase boundary that requires uuids.
