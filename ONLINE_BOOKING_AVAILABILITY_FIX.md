# End-to-End Fix: "This salon is not accepting online bookings"

## Symptom (as reported)

> This salon is not accepting online bookings. Contact the salon to book.
> ++Retry availability++

A customer opens a salon's public site, starts a booking, reaches the
date/time step, and is permanently blocked by the message above — accompanied
by a **Retry availability** button that can never succeed.

## Root cause

Online-booking availability was gated on `salons.verified` in **two** places,
but the authoritative booking path gates **only** on `is_active` +
`accepts_online_bookings`:

| Path | File / object | Gate |
| --- | --- | --- |
| Availability (HTTP) | `server/customerAvailability.ts` | `is_active` **and `verified`** and `accepts_online_bookings` |
| Availability (DB RPC) | `public.nexora_customer_booking_options` (`20260911110000_customer_availability_bridge.sql`) | `is_active` **and `verified`** and `accepts_online_bookings` |
| Booking (HTTP) | `server/normalizedBookingCreate.ts` | `is_active` and `accepts_online_bookings` |
| Booking (DB RPC) | `public.create_customer_booking` / `nexora_create_customer_booking` (`20260911_customer_booking_rpc.sql`) | `is_active` and `accepts_online_bookings` |

`complete_shop_onboarding` creates every salon with `verified = false`, and
**nothing in the entire repository ever sets `salons.verified = true`** (no
admin/approval flow, no migration backfill, no owner toggle). The public
storefront (`server/siteLookup.ts`) is also served regardless of `verified`.

Net effect: every onboarded salon loads fine, but its availability check fails
with `online_booking_disabled` forever, even though an actual booking would have
succeeded. The availability gate was stricter than the booking gate — the exact
opposite of what a read-only preview should be.

`accepts_online_bookings` is the real product toggle: `20261013_online_booking_defaults.sql`
adds it, defaults it to `true`, backfills legacy nulls to `true`, and treats an
explicit `false` as the only opt-out. `verified` is a separate business flag
(consumed by the growth-partner reward migrations), not the online-booking
switch.

## Fix (availability now mirrors the booking contract exactly)

1. **`server/customerAvailability.ts`** — removed the `!salon.verified`
   requirement; split the overloaded 409 into two precise outcomes:
   - missing/inactive/deleted salon → `404 salon_not_found`
   - `accepts_online_bookings === false` → `409 online_booking_disabled`
   - kept the legacy `null → true` default for `accepts_online_bookings`
2. **`supabase/migrations/20261016_customer_availability_align_verified.sql`** —
   `create or replace`s `nexora_customer_booking_options` dropping `and verified`
   from the salon guard (body otherwise identical to the bridge migration). The
   booking RPC already ignored `verified`, so this only removes the inconsistency.
3. **`server/normalizedBookingCreate.ts`** — added the `online_booking_disabled`
   code to its existing 409 for parity with availability.
4. **Frontend UX (`src/lib/useCustomerAvailability.ts`, `src/components/BookingModal.tsx`)** —
   the hook now surfaces the machine-readable `code`. In the modal:
   - `online_booking_disabled` → clear "contact the salon directly" card, **no
     futile Retry button** (this removes the `++Retry availability++` trap).
   - `salon_not_found` → "This salon could not be found."
   - any transient failure → keeps the working **Retry availability** button.

## Tests

- `tests/customerAvailability.test.ts` — added: unverified salons remain
  bookable; missing salon → `404 salon_not_found`; disabled salon → `409
  online_booking_disabled`; migration drops the `verified` gate. (10/10 pass.)
- `tests/dom/customerAvailabilityUi.test.ts` (new) — drives the real modal to
  the date/time step and asserts the disabled state shows the contact card with
  no retry, while a transient failure keeps a working retry. (2/2 pass.)

## Gaps analysis — related issues found (documented, not changed here)

These are outside the reported booking symptom and touch money/eligibility
logic, so they are called out rather than silently changed:

- **`salons.verified` is dead for its other consumer.** The growth-partner
  reward migrations (`20261007`–`20261009`) require `s.verified`, but nothing
  sets it, so referred-shop rewards can never qualify. If that feature is meant
  to work, an explicit salon-verification step (admin approval, or
  auto-verify on a completed + reviewed `shop_onboarding_applications` row) is a
  missing item. It is intentionally **not** folded into this booking fix because
  auto-verifying everyone could grant unvetted shops partner rewards.
- **`shop_onboarding_applications` has no committed DDL** in
  `supabase/migrations/` even though reward SQL references it; it is assumed to
  exist in the live project.
