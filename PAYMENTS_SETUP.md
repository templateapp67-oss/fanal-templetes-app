# Payments & Booking Checkout (Razorpay)

This document covers the checkout step that was answering
`Server error (HTTP 500)` on **"Confirm Appointment & Generate Pass (₹)"**,
what actually caused it, and how the flow works now.

---

## 1. What was broken

The confirm button POSTs to `/api/bookings/create`. The old handler pushed the
client payload almost straight into `bookings.insert()`, so three different
problems all surfaced to the customer as a bare **HTTP 500**:

| # | Cause | What the customer saw |
|---|-------|------------------------|
| 1 | `bookings.owner_id` is `uuid NOT NULL references auth.users(id)`, but a booking made from a template/preview site has `profile.ownerId === null`. `sanitizeBookingRow()` nulls it → Postgres `23502 not-null violation`. | `Server error (HTTP 500)` |
| 2 | Nothing validated the payload. An empty name, `02-10-2026` instead of `2026-10-02`, or a non-numeric amount reached Postgres and came back as `22P02` / `23514`. | `Server error (HTTP 500)` |
| 3 | The catch-all only ran `console.warn(err)` — no code, no details, no stack — so the real reason was invisible in the logs. | *(nothing useful in the logs)* |

There was also **no Razorpay integration at all** in the repository: the button
label promised a payment, but the handler never created an order, and
`advance_paid_amount` was always `0` because `paymentMethod` defaulted to
`pay_at_salon` even though the UI showed the 25 % advance card as selected.

---

## 2. Environment variables

Add these to `.env` (already git-ignored; `.env.example` documents them):

```dotenv
RAZORPAY_KEY_ID="rzp_test_TIzKly1Z2NMnum"
RAZORPAY_KEY_SECRET="9SehLfvRW6eVtHXtFXzL2Ovm"
```

* `RAZORPAY_KEY_ID` is **public** — it is served to the browser so Checkout can
  open. `RAZORPAY_KEY_SECRET` is **server-only**: it signs the order request
  and verifies the payment signature, and is never sent to the client.
* Aliases accepted: `VITE_RAZORPAY_KEY_ID`, `RAZORPAY_API_KEY`,
  `RAZORPAY_SECRET`, `RAZORPAY_API_SECRET`. Surrounding quotes/whitespace are
  stripped, so a value pasted straight from the dashboard works.
* On boot the server prints one of:
  * `[Razorpay] Gateway ready (TEST key rzp_test_TIz…).`
  * `[Razorpay] Online payments are DISABLED — RAZORPAY_KEY_SECRET is missing …`
* On Vercel/Cloud Run set the same two variables in the project's environment
  settings (`.env` is not deployed).

For **live** Supabase deployments also set, server-side:

```dotenv
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...       # bypasses RLS for guest bookings
DEFAULT_OWNER_ID=<auth user uuid>   # fallback owner for guest bookings
```

---

## 3. API surface

| Method | Route | Purpose |
|--------|-------|---------|
| `GET`  | `/api/payments/razorpay/config` | `{ configured, keyId, mode }` — public key only, never the secret. |
| `POST` | `/api/payments/razorpay/order`  | Body `{ amount (₹), currency?, receipt?, notes? }` → creates the order server-side. |
| `POST` | `/api/payments/razorpay/verify` | Body `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }` → HMAC-SHA256 check. |
| `POST` | `/api/bookings/create`          | Validates → resolves owner → re-verifies payment → inserts the booking. |

Status codes are now precise — a 500 means "genuinely unexpected", nothing else:

| Status | When |
|--------|------|
| `400 invalid_booking` | Missing/malformed booking details (`fieldErrors` says which). |
| `400 payment_unverified` | The Razorpay signature did not match — nothing is stored. |
| `422 owner_unresolved` | The salon has no owner account to attach the booking to. |
| `422` (`23502`/`23503`) | A database constraint rejected the row, explained in plain English. |
| `503 razorpay_not_configured` | Keys missing — the UI falls back to "pay at salon". |
| `503 razorpay_unreachable` | The gateway could not be reached from the server — same fallback. |
| `502 razorpay_order_failed` | Razorpay refused the order (message forwarded). |

---

## 4. Checkout flow

```
BookingModal → payAdvanceWithRazorpay()          src/lib/razorpayCheckout.ts
   1. GET  /api/payments/razorpay/config         is the gateway live?
   2. POST /api/payments/razorpay/order          server creates the order (secret stays server-side)
   3. checkout.js opens with that order id       customer pays the 25 % advance
   4. POST /api/payments/razorpay/verify         HMAC signature check
   5. POST /api/bookings/create { payment }      signature re-checked before the row is written
```

* The confirm button is disabled while the flow runs (no double bookings /
  double charges) and shows `Opening secure payment (₹…)` → `Saving your booking…`.
* Closing the payment window → the booking is **not** saved and the customer
  keeps their details ("tap confirm to try again").
* If the payment succeeded but the save failed, the error message includes the
  Razorpay payment id so the salon can reconcile it.
* If the gateway is not configured/reachable, the booking is still stored and
  the customer is told to pay at the salon (amber notice).

Test cards (Razorpay test mode): card `4111 1111 1111 1111`, any future expiry,
any CVV, OTP `1234`. UPI success handle: `success@razorpay`.

---

## 5. Owner resolution (`bookings.owner_id`)

Because the column is `NOT NULL`, a guest booking must be attached to a salon
owner. The server now tries, in order:

1. a uuid sent by the client (`owner_id`),
2. the profile that owns the request's subdomain / custom domain,
3. the profile matching the owner email in the notification payload,
4. `DEFAULT_OWNER_ID` / `SUPABASE_DEMO_OWNER_ID` from the environment,
5. the only profile in the database (single-salon deployments).

If all five fail it answers `422 owner_unresolved` with an actionable message
instead of letting Postgres raise a 500.

---

## 6. Tests

```bash
npm test        # tests/razorpay.test.ts + tests/bookingCreate.test.ts (and the rest)
npm run lint    # tsc --noEmit
```

They cover credential loading/placeholder detection, signature verification,
the order/verify/config endpoints, payload validation, owner resolution, the
Postgres-code → HTTP mapping and the "NOT NULL violation must not be a 500"
regression.
