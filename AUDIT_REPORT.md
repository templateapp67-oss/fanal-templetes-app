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
