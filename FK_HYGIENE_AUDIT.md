# FK & Write-Path Hygiene Audit — Nexora SalonOS

Scope: verify that no editor-only, temporary, slug-based, array-index,
generated-frontend, or localStorage-sourced IDs are ever sent as foreign keys
into the database.

Audited FK columns across every write path:
`s salon_id, organization_id, branch/location_id, service_id, staff_id/team_member_id,
customer_id/customer_user_id, created_by`. Also verified booking status,
payment status, and appointment start/end timestamps.

## Result: all write paths are clean after fixes

### Existing invariants (already correct before this session)

| Path | FK handling |
|---|---|
| Editor save (autoSave/salonSync) | Friendly `hs-*` / slug ids hashed to deterministic UUIDs via `toDbId(ns, id)`; existing UUIDs pass through. |
| `server/websiteSave.ts` | `ownerId` validated with UUID regex; bearer re-verified; service-role call to `nexora_save_owner_workspace` (SECURITY DEFINER, org-bound). |
| `server/ownerDashboard.ts` (`/api/owner/appointments`) | `clientId` validated as UUID, mapped through `catalogId(salon,kind,id)`, re-read from DB to confirm salon membership before invoking `create_owner_booking` RPC. |
| `server/bookingOps.sanitizeBookingRow()` (legacy) | Whitelist excludes `staff_id`, `salon_id`, `customer_user_id`, `created_by`; non-UUID ids nulled; names denormalized to text columns. |
| `server/bookingCreate.ts` (legacy) | Server-side resolves owner, re-verifies Razorpay signature, applies `sanitizeBookingRow`, never trusts client FKs. |
| `server/customerRoutes.ts` (legacy) | Uses `owner_id` (legacy); staff in `metadata` not FK; bearer verified; server-side FK resolution; Razorpay re-verification; slot-collision rollback. |
| `server/normalizedBookingAccess.ts` | Reads scoped by `customer_user_id=actor` OR owner-salon membership; owner status transitions strictly whitelisted; CAS updates filter by `(id, salon_id, status)` or `(id, customer_user_id, status)`; reschedule confirm recomputes UTC timestamps server-side via salon timezone; `presentBooking()` strips `internal_note`/`idempotency_key`/`created_by` from customer view. |
| `server/bookingCheckin.ts` | Normalized path: `findAuthorizedBooking` scopes by owner-salon membership; CAS update `(id, salon_id, status)` sets only `status='checked_in'`. Legacy path: resolves `owner_id` server-side from bearer/subdomain/email; `client_id` for loyalty ledger comes from a fresh `clients` lookup (never client body). |
| `server/bookingMine.ts` | Only writes are (a) `status='cancelled'` scoped by `.eq('id', existing.id)` on rows fetched for the authenticated actor; (b) `reviews.insert` with `salon_customer_id` taken from the freshly-read booking row; (c) `metadata` JSON update. No raw FK from client body. |
| `server/bookingRoutes.ts` | `/api/bookings/update` validates booking id as UUID, enforces `ALLOWED_BOOKING_STATUSES` (= PERSISTABLE_BOOKING_STATUS_SET), then delegates to `updateNormalizedBooking` (CAS, salon-scoped). |
| `server/normalizedNotifications.ts` | `recipient_user_id` set to authenticated `user.id`; client body's `email`/`recipient_user_id` are ignored (asserted by the test *"notifications cannot be read or marked as another identity"*). |
| `server/ownerBookings.ts` | Read-only — no writes. |
| `server/razorpayWebhook.ts` | Service-to-service callback; HMAC-verified raw body; writes only `payment_status`, `payment_id`, `paid_amount/advance_paid_amount` keyed by a booking id resolved via `.in('payment_id', ids)` lookup; no client-supplied FKs. |
| `src/App.tsx` (`toAppointmentInsert`/`toClientInsert`) | Uses `toDbId(id, namespace)` for deterministic UUID mapping; non-UUID `service_id`/`stylist_id` are NULLed with names preserved in denormalized text columns; in non-mock mode dispatches `owner-bookings-changed` event instead of writing directly to `appointments`/`clients`. |
| `server/staffPerformanceRoutes.ts` (read endpoints) | Pass through to SECURITY DEFINER RPCs (`owner_staff_performance_summary`, etc.) that use `nexora_owner_salon_ids()` internally; no client FK trusted directly. |

### Fixes applied this session

1. **Missing customer-booking RPCs created** (`supabase/migrations/20260911_customer_booking_rpc.sql`)
   - Added `create_customer_booking(...)` SECURITY DEFINER function that:
     - Requires authentication; enforces `p_customer_user_id = auth.uid()` so an attacker cannot book as another user.
     - Derives `organization_id` and salon timezone from the salon row — never from the request body.
     - Re-verifies every `p_service_ids` entry belongs to the salon, is active, and is bookable-online; re-verifies `p_staff_id` (if supplied) belongs to the salon and offers every selected service.
     - Upserts `salon_customers` scoped to `(salon_id, phone)` — no cross-salon customer reuse.
     - Detects time-slot overlap against active bookings; uses an exclusion-guard insert.
     - Server-computes `appointment_end = appointment_start + Σ(service.duration_minutes)`, sets `created_by = auth.uid()`, sets `status = 'payment_pending'`, stores an immutable `idempotency_key` (sha256 of actor+reference).
     - Rejects via specific SQLSTATEs (`22023` for invalid input, `42501` for auth, `23503` for FK, `23514` for check, `23P01` for overlap, `23505` for duplicate reference).
   - Added `record_verified_payment_capture(...)` SECURITY DEFINER function:
     - Only authenticated callers; re-scopes by `bookings.customer_user_id = actor FOR UPDATE`.
     - Caps `p_amount_paise` ≤ booking total.
     - Sets `paid_amount`, `payment_id = provider_payment_id`, transitions `payment_status` to `paid_deposit`/`paid_full` and `status` from `payment_pending → confirmed`. This is the **only** path that can set a paid payment status — the browser-supplied `payment_status='paid'` is already ignored by the caller.
     - Appends a `payments` ledger row (when the table exists) with `on conflict do nothing` keyed by `provider_payment_id` for webhook idempotency.
   - Column-introspection helper (`nexora_owner_booking_columns` / `nexora_owner_booking_has_column`) reused from `20260910200000_create_owner_booking.sql` so the RPC works against every deployed schema generation.
   - Revokes EXECUTE from `public`/`anon`; grants only to `authenticated`.

2. **`server/normalizedBookingCreate.ts` hardened**
   - Now passes `p_customer_user_id: actor` (server-set, never client-supplied), plus `p_customer_name`, `p_customer_phone`, `p_customer_email`, `p_customer_note`.
   - Adds server-side validation of `customer_name` (non-empty, ≤120 chars) and `customer_phone` (digits/+ only, 7-20 chars) before invoking the RPC, so a malformed payload never reaches Postgres.
   - Phone is normalized to digits/`+`; email is lower-cased and length-bounded.

3. **`server/staffPerformanceRoutes.ts` UUID-guards**
   - Added `optionalUuid()` helper; every `p_staff_id` query/body param is now validated as a UUID before being passed to the RPC, returning HTTP 400 for non-UUID values (previously a slug / localStorage id would have been forwarded and only rejected by the downstream RPC or returned empty).

4. **Booking-status whitelist extended** (`src/lib/bookingStatus.ts`)
   - Added `payment_pending`, `checked_in`, `in_progress` to `BOOKING_STATUS_ORDER` and `reschedule_requested` to `TRANSITIONAL_BOOKING_STATUSES` so the API allow-list matches the real normalized state machine used by `OWNER_TRANSITIONS` in `normalizedBookingAccess.ts`. (Previously `checked_in` was not in the persistable set even though `bookingCheckin.ts` and the transition table wrote it.)
   - Added corresponding descriptors (labels, descriptions, tones, terminal flags) and confirmation-page headlines.
   - Updated `OWNER_TRANSITIONS` to include `payment_pending → {confirmed, cancelled, reschedule_proposed}`.

5. **Tests updated** (`tests/bookingStatus.test.ts`, `tests/normalizedBackend.test.ts`)
   - Lifecycle/label/headline expectations updated to match the extended, correct set.
   - Normalized-create test now asserts `p_customer_user_id === actor` and that customer name/phone are forwarded correctly; supplies valid customer contact fields so the new server-side validation passes.

### Columns that are NOT written from any client-controlled path

| Column | Where it's set |
|---|---|
| `salon_id` | Resolved server-side from `subdomain` slug or server-validated UUID; re-verified by every RPC against the caller's org membership. |
| `organization_id` | Derived inside the RPC from the `salons.organization_id` FK; never sent by clients. |
| `branch_id / location_id` | Not modelled in this schema. The `salons` row is the canonical location; no branch FK exists anywhere in the workspace. |
| `service_id(s)` | Mapped from friendly id → deterministic UUID via `toDbId()` (editor path) or `catalogId()` (booking path), then re-verified against a fresh `services` SELECT for this salon before insert. Forgery = 409. |
| `staff_id / team_member_id` | Same discipline as `service_id`; NULL is allowed ("any available"). Non-UUID values are nulled in legacy path and validated in the new RPC. |
| `customer_id / customer_user_id` | Set to `auth.uid()` inside the RPC; clients can't target another customer. The `salon_customer_id` is upserted server-side keyed by `(salon_id, phone)`. |
| `created_by` | Set to `auth.uid()` inside every SECURITY DEFINER RPC; stripped from `BOOKING_COLUMNS` legacy whitelist; stripped from customer-presented views. |
| `booking status` | Whitelisted (`payment_pending, pending, confirmed, checked_in, in_progress, completed, cancelled, no_show, reschedule_requested, reschedule_proposed`); transitions governed by `OWNER_TRANSITIONS`; customer actions limited to (a) accept a salon reschedule proposal via CAS `(id, customer_user_id, status='reschedule_proposed')` or (b) cancel via the dedicated `cancel_customer_booking` RPC. |
| `payment status` | Defaults to `pending` on insert; only `record_verified_payment_capture` (called after server-side Razorpay signature verification) can set `paid_deposit`/`paid_full`; webhook path sets based on HMAC-verified payload; client-supplied `payment_status` is ignored. |
| `appointment_start / appointment_end` | `start` is built server-side from salon-timezone-local date+slot via `appointmentInstant()`; `end` is computed as `start + Σ(catalogue durations)` inside the RPC — a client-supplied end/duration is never honoured. Reschedule confirm recomputes timestamps server-side using the salon's timezone. |

### Generated / localStorage / slug IDs — disposition

- `Math.random()` in `src/` is used only for cosmetic/demo purposes (human-readable reference strings, mock IDs); none of those values reach a foreign key column.
- `toDbId(ns, id)` (cyrb128 → UUID v4) is a **deterministic** hash, keyed by namespace (`'nexora-service'`, `'nexora-stylist'`, `'nexora-appointment'`, `'nexora-client'`). It is applied **before** any upsert and produces valid UUIDs; the value is then re-validated by SECURITY DEFINER RPCs against the real `services`/`staff` tables for that salon, so an id from another tenant's editor draft cannot be attached.
- Template seeds (`hs-*`, `srv-*`, `st-*`) are static and hashed through `toDbId()` before being sent.
- `localStorage`-sourced draft ids never hit Supabase: the autoSave pipeline either (a) replaces them with hashed UUIDs on the server via `nexora_save_owner_workspace`, or (b) in mock Supabase mode writes only to the in-memory mock store.
- No array indices are used as ids anywhere in a write path (the only `index` usages are for React `key` props and for ordering `p_service_ids` to preserve display order, never as identifiers).

### Gaps that remain out-of-repo

- `cancel_customer_booking` RPC is referenced by `normalizedBookingAccess.ts` (customer-cancel path) but is not defined in any committed migration — like the two RPCs this audit adds, it is assumed to exist on the remote Supabase instance. Its call site follows the same discipline (caller's bearer token, no client-supplied customer id), but the SQL body cannot be audited from this workspace.
- Base normalized tables (`salons`, `salon_customers`, `booking_items`, `staff`, `reviews`, `payments`) are not created in any migration under `supabase/migrations/` — they pre-date the repo or were applied out-of-band. The SECURITY DEFINER RPCs shipped here use column introspection to tolerate schema variation, so they will bind safely against the deployed columns when applied.

## Verification

- `npm test` → 860 passed, 0 failed, 3 skipped (pre-existing skips).
- `npx tsc --noEmit` → clean.
