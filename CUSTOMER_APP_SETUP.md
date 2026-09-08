# Nexora Salon OS — Customer App ↔ Supabase

The Customer App lives at **`/app`** on the same deployment as the owner
dashboard. It has its own screens (`src/customer/`), its own API
(`server/customerRoutes.ts`), and its own data layer (`src/lib/customer/`). The
owner UI is untouched: `/app` is an early branch in `App.tsx` ahead of the editor
and the public salon site, and it also silences the owner auto-save engine so a
signed-out visitor can never write the default salon profile over a real one.

Everything below exists because of one constraint and one fact:

* **Constraint** — no new tables, no renamed tables, no new columns, no changed
  RLS policies. The app must run against the schema that is already deployed.
* **Fact** — `supabase/migrations/00001_init.sql` has **13 tables**. The
  Customer App spec names **18 entities**. Six of them have no table.

So the mapping is not a renaming exercise: some of those 18 entities are
*derived* from real rows or stored inside existing `jsonb` columns, and the app
says which is which — in the mapping (`src/lib/customer/schema.ts`), on every
screen (the `supabase` / `derived` / `this device` chip) and in a machine-checked
report (`npm run verify`).

---

## 1. The 18 entities, mapped

Authoritative source: `CUSTOMER_SCHEMA_MAP` in `src/lib/customer/schema.ts`.
Nothing else restates this list, and `npm run verify` fails if the two drift.

| Customer entity | Kind | Reads from | Endpoint |
|---|---|---|---|
| `profiles` (login, signup, profile) | table | `profiles` | `GET/POST /api/customer/me/profile` |
| `salons` (salon profile) | table | `profiles` where `salon_name`/`subdomain`/`business_type` are set | `GET /api/customer/salons`, `/salons/:idOrSubdomain` |
| `salon_services` | table | `services` | `GET /api/customer/salons/:id/services` |
| `salon_staff` | table | `stylists` | `GET /api/customer/salons/:id/staff` |
| `staff_slots` | **derived** | `stylists.schedule` minus `bookings` | `GET /api/customer/salons/:id/slots` |
| `bookings` | table | `bookings` | `GET /api/customer/me/bookings` |
| `booking_services` | **jsonb** | `bookings.metadata.services[]` | written by `POST /api/customer/bookings/create` |
| `favourites` | **derived** | your `bookings` (+ device pins) | `GET /api/customer/me/favourites` |
| `reviews` | **jsonb** | `bookings.metadata.review_*` | `GET/POST /api/customer/me/reviews` |
| `reward_wallets` | table | `clients` + `loyalty_config` | `GET /api/customer/me/rewards` |
| `reward_transactions` | table | `loyalty_point_transactions` | `GET /api/customer/me/rewards` |
| `customer_qr_payments` | table | `loyalty_point_transactions` where `type = 'qr_payment'` | `GET/POST /api/customer/me/qr-payments[/confirm]` |
| `memberships` | table | `clients.loyalty_tier` vs `loyalty_config` thresholds | `GET /api/customer/me/memberships` |
| `referrals` | **derived** | `bookings.metadata.referral_code` + `loyalty_point_transactions` | `GET /api/customer/me/referrals` |
| `notifications` | table | `in_app_notifications` addressed to your email | `GET /api/customer/me/notifications` |
| `search_history` | **device** | localStorage (suggestions read `services`/`bookings`) | `GET /api/customer/search-suggestions` |
| `offers` | table | `loyalty_rewards` (`is_active`) | `GET /api/customer/offers` |
| `offer_redemptions` | table | `loyalty_redeemed_rewards` | `POST /api/customer/offers/redeem` |

Salon-owned tables (`services`, `stylists`, `loyalty_*`) are **read-only for
customers**. There is no route in this app that lets a customer edit a price, a
stylist or a rewards rule.

---

## 2. What the schema cannot store — and what the app does instead

`CUSTOMER_SCHEMA_GAPS` lists these ten; the Activity → *Data sources* screen
renders them, so the limitation is visible in the product and not only in this
file.

| Missing entity | How it works today | What would make it native (NOT applied) |
|---|---|---|
| `staff_slots` | Availability is computed per stylist: their `schedule` window, minus `bookings` rows whose status holds a slot | a `staff_slots` table if you want reserved-slot rows instead of derived availability |
| `booking_services` | Written as `bookings.metadata.services[]` (id, price, duration, stylist) in the same request as the booking | a `booking_services` junction table with `booking_id → bookings.id` |
| `favourites` | Derived from salons you actually booked, merged with pins kept on this device | a `favourite_salons` / `favourite_staff` table |
| `reviews` | `bookings.metadata.review_rating` / `review_text` / `reviewed_at` | a `reviews` table (would also let one review exist per salon rather than per booking) |
| `search_history` | This device only, namespaced by your account id | a `customer_searches` table, or a `search_history` jsonb column on `profiles` |
| `customer_qr_payments` | A `loyalty_point_transactions` row typed `qr_payment`; the amount and UPI reference live in its `description` | an `amount`, `currency` and `reference` column (or a `payments` table) |
| `memberships` | `clients.loyalty_tier` measured against `loyalty_config` thresholds and multipliers | a `memberships` table with join/expiry dates |
| `referrals` | Code derived from your auth uid (`NX-<first 8>`), stored on `bookings.metadata.referral_code` | a `referrals` table with click/booking/credit states |
| `salons` | A salon is an owner `profiles` row; discovery filters on `salon_name is not null` | a `salons` table (would also fix the geo collision below) |
| `notifications` | Delivered by email address — the one customer-readable policy in the schema | an `on delete cascade` recipient key, i.e. `user_id` on the row |

**The `profiles` geo collision.** `latitude` / `longitude` / `city` on a
`profiles` row are the *salon's* public discovery coordinates. A customer signing
in with an owner account must not move that salon on every map, so
`POST /api/customer/me/profile` refuses to write geo columns on a row that looks
like a published salon (`isSalonProfile`) and answers with a `notice` saying so;
those customers keep their location on the device. That guard is the reason a
customer profile and an owner profile can share one table safely.

---

## 3. Identity, scoping and RLS

No policy was changed, because no policy needed changing:

* Every private read/write goes through this app's Express API, which uses the
  `service_role` client (the same pattern as `/api/bookings/*`).
* The customer's id comes **only** from the verified bearer token
  (`authenticateUser`). No customer route accepts `user_id` or `customer_id` as a
  parameter, and `tests/customerRoutes.test.ts` asserts that an unauthenticated
  request never reaches the database at all.
* A foreign booking id answers **404**, not 403 — confirming that someone else's
  booking exists is information this app must not leak.
* Wallet rows (`clients`) have no `user_id`, so they are resolved from the email
  on your verified token plus the email/phone already on your own bookings, and
  only `points`, `lifetime_points`, `total_spent`, `last_visit`, `loyalty_tier`
  are ever written.

Why the browser must not read Supabase directly: `services`, `stylists` and
`loyalty_*` are owner-scoped, so an `anon` query from a customer returns **zero
rows**. `npm run verify` stage 3 demonstrates this against your own project.

---

## 4. Realtime

| Channel | Transport |
|---|---|
| Notifications | Native Supabase Realtime (`postgres_changes` on `in_app_notifications`), the only table a customer can subscribe to under the current policies |
| Booking status, rewards, slot availability | Adaptive polling fallback, coalesced; the notification row is the wake signal and the payload is always re-read through the API |

Slot chips on the booking screen show `live` or `polling` because that distinction
is real. `bookings` has no customer RLS policy, so a native subscription to it
would silently deliver nothing — subscribing and hoping is not in this build.

`src/lib/customer/realtime.ts` is the whole implementation: wake signal →
`createCoalescedRefresh` → refetch, with `slotsSignature` so a poll that changed
nothing does not re-render the grid.

---

## 5. Environment

**No new variables.** The Customer App uses what the owner app already needs:

```
SUPABASE_URL=…                      # or VITE_SUPABASE_URL
SUPABASE_ANON_KEY=…                 # or VITE_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=…         # required for customer writes
RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET   # only if deposits are online
```

If the Supabase keys are missing the app runs in **mock mode**, and mock mode in
this surface means:

* reads answer `{ success: true, mode: 'mock', data: [] }` plus a `notice`
* writes that need persistence answer **503** `supabase_not_configured` — booking,
  deposit, QR credit and offer redemption all refuse instead of faking success
* the screens say "Not connected to Supabase" where data would be

There is no sample salon, service, stylist, booking, reward, offer or review
anywhere in `src/customer/` or `src/lib/customer/`, and
`tests/customerScreens.test.ts` fails if a mock-data string ever appears in
rendered customer markup. (Signing up needs live keys: the auth screen uses
`supabase.auth`, and in mock mode it explains that instead of pretending.)

Routes are registered in **both** entrypoints — `server.ts` (dev/preview) and
`api/index.ts` (serverless) — so `/api/customer/*` behaves the same either way.

---

## 6. Verifying the connection

```bash
npm run verify                       # mapping integrity, always
npm run verify -- --api https://your-host   # also compare the API's own report
```

`scripts/verify-supabase-connection.mjs` runs four stages:

1. **Mapping integrity** (offline) — 18 entities, every table they claim exists
   in `00001_init.sql`, every endpoint registered on the server, gaps explained.
2. **Table probe** — each mapped table is asked over PostgREST whether it exists
   and how many rows it holds (`HEAD` with `Prefer: count=exact`, `limit=1`
   read). Read-only, no writes, no DDL.
3. **RLS reality** — the same catalogue read, done anonymously, to show why the
   app goes through the API.
4. **API agreement** — `/api/customer/connection` must agree with what the
   database said, per table and per entity.

Exit codes: `0` verified · `1` mismatch · `2` nothing verifiable (no
credentials). A run that only checked the mapping deliberately does **not** exit
`0`.

The same report is in the app: **Activity → Data sources** shows each entity, its
backing table, row counts, and the gap list, straight from
`/api/customer/connection`.

---

## 7. Booking, deposits and money

`POST /api/customer/bookings/create` is one unit of work:

1. slot re-checked (`slotIsTaken`, both `HH:MM` and `HH:MM:00` spellings of the
   free-text `time_slot`)
2. `bookings` row inserted — `status: 'pending'`, `advance_paid_amount: 0`
3. service lines written into `bookings.metadata.services`; **if that write
   fails the booking is deleted again**, and the error names
   `staleBookingId` only if the rollback also failed
4. the stored row is re-read and returned, plus a fresh availability grid, so the
   taken slot disappears without a second request
5. notifications for customer and salon are best-effort: a failed insert never
   undoes an accepted booking

Payment is deliberately a **second** request (`POST /api/customer/me/bookings/:id/advance`)
because a gateway round-trip can outlive a request. The signature is re-verified
server-side, the deposit amount is **recomputed from the stored booking**
(`metadata.deposit_policy` percentage × `total_amount`) and a client-claimed
amount that disagrees is refused with `payment_amount_mismatch` rather than
recorded. If the money was captured but the row could not be updated, the answer
is `success: true` + `needsSalonAttention: true` and a `notice` — never a silent
loss of a paid deposit.

QR rewards are not a second ledger: confirming one writes a
`loyalty_point_transactions` row and credits `clients.points`; if the credit
fails, the ledger row is deleted so points never exist without their transaction.

Every failure answer carries a stable `code`, a `requestId` to grep in the
server logs, and `retryable` where a retry is safe. Nothing on this list leaves a
half-written booking.

| Code | HTTP | Meaning |
|---|---|---|
| `auth_required` | 401 | Sign in first — nothing was changed |
| `invalid_request` / `invalid_date` | 400 | The request body is not usable as given |
| `payment_reference_required` | 400 | No gateway reference, so the payment cannot be verified — nothing recorded |
| `payment_unverified` | 400 | Gateway signature did not verify; the booking stays pending |
| `invalid_offer` | 400 | That reward cannot be redeemed here |
| `unknown_service` | 422 | A chosen service is not offered by this salon |
| `invalid_booking` | 422 | Missing/invalid customer fields (`fieldErrors` names each one) |
| `invalid_amount` / `invalid_reference` / `below_minimum` | 422 | A QR credit needs a real positive amount and a reference |
| `invalid_review` | 422 | A review needs a completed visit and a 1–5 rating |
| `no_wallet_at_salon` / `program_disabled` / `insufficient_points` | 422 / 402 | Loyalty cannot pay for this: no client row yet, program off, or not enough points |
| `offer_inactive` | 410 | The reward is no longer published by the salon |
| `salon_not_published` / `offer_saloon_mismatch` | 422 | The salon or reward this request points at is not redeemable |
| `slot_taken` | 409 | Someone else got that time — pick another; the grid is re-sent |
| `duplicate_booking` | 409 | The same customer/salon/date/time is already held |
| `not_cancellable` | 409 | Too late to cancel from here (`src/lib/bookingTabs.ts`, the owner app's rule) |
| `payment_amount_mismatch` | 409 | The order was not for this booking's deposit |
| `no_deposit_due` | 409 | Nothing left to pay on this booking |
| `payments_disabled` | 409 | No gateway key in this deployment — pay at the salon |
| `not_found` | 404 | Not yours, or not there. Foreign ids answer 404, never 403 |
| `salon_unreadable` | 502 | The owner's salon row could not be read right now |
| `db_timeout` / `db_error` / `request_timeout` | 503 / 504 | The database did not answer — retryable, and no money moved |
| `supabase_not_configured` | 503 | No keys in this deployment; nothing was saved |

---

## 8. Tests

```bash
npm test
```

* `tests/customerRoutes.test.ts` — identity, scoping, the whitelist that keeps
  salon columns away from customers, the transactional booking and its rollback,
  slot derivation, cancellation and review rules, deposit verification.
* `tests/customerDataLayer.test.ts` — the mapping's invariants, referral codes,
  slot arithmetic (including `HH:MM:00` spelling), mappers never inventing a
  missing value, the QR `description` round-trip, error copy.
* `tests/customerScreens.test.ts` — every screen renders without a session, a
  database or props; no mock data in rendered markup; source labels do not claim
  a database before the API answers.
