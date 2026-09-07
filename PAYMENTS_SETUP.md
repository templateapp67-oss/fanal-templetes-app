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
RAZORPAY_WEBHOOK_SECRET="C9EWXhp3cHnow4oUGIzeCTIXzbmswV3Y"
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

### Where the keys are loaded from

`server/env.ts` loads them in this precedence order (first match wins, missing
files are ignored):

| Priority | Source | Committed? | Use for |
|---|---|---|---|
| 1 | real environment variables (Vercel / Cloud Run / shell) | – | production |
| 2 | `.env` | no (git-ignored) | your machine's real secrets |
| 3 | `.env.development` | **yes** | shared Razorpay **TEST** keys, so previews/CI always work |

`.env.development` is committed on purpose and holds test-mode keys only
(test mode cannot move real money). Anything you set in `.env` or in the
hosting dashboard automatically overrides it — never put `rzp_live_*` keys or
the Supabase service-role key there.

### Verify the setup

```bash
npm run check:razorpay
```

Prints which file the keys came from, whether they are well-formed, and then
creates a real ₹1 test order to prove Razorpay accepts them:

```
  loaded from      : .env
  RAZORPAY_KEY_ID  : rzp_test_TIzKly1Z2NMnum
  RAZORPAY_KEY_SECRET: 9SehLf**************2Ovm
  mode             : TEST
✔ Order created: order_Rk2… (INR 1.00, status created)
✔ Payments are ACTIVE — the checkout button will open Razorpay.
```

For **live** Supabase deployments also set, server-side:

```dotenv
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...       # server-only key for authenticated bookings
DEFAULT_OWNER_ID=<auth user uuid>   # fallback owner for authenticated bookings
```

---

## 3. API surface

| Method | Route | Purpose |
|--------|-------|---------|
| `GET`  | `/api/payments/razorpay/config` | `{ configured, keyId, mode }` — public key only, never the secret. |
| `POST` | `/api/payments/razorpay/order`  | Body `{ amount (₹), currency?, receipt?, notes? }` → creates the order server-side. |
| `POST` | `/api/payments/razorpay/verify` | Body `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }` → HMAC-SHA256 check. |
| `POST` | `/api/payments/razorpay/webhook` | Server-to-server callback from Razorpay (captured / failed / refunded). |
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
| `400` (webhook) | The `X-Razorpay-Signature` did not match — the callback is ignored. |
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

## 5. Webhook

**URL to register:**

```
https://fanal-templetes-app.vercel.app/api/payments/razorpay/webhook
```

### Why it matters

The browser flow (`/verify`) only works if the customer stays on the page. The
webhook is the fallback that still records the money when they close the tab,
lose network, or when Razorpay captures/refunds later — no browser involved.

### Setting it up in the dashboard

1. Razorpay Dashboard → **Settings → Webhooks → Add New Webhook**.
2. **Webhook URL:** the URL above.
3. **Secret:** a value *you* choose. It must be identical to
   `RAZORPAY_WEBHOOK_SECRET` in the app's environment. The value currently
   configured in `.env` / `.env.development` is:

   ```
   C9EWXhp3cHnow4oUGIzeCTIXzbmswV3Y
   ```

4. **Active events:** `payment.captured`, `payment.failed`, `order.paid`,
   `refund.processed` (`payment.authorized` and `refund.created` are also
   understood).
5. Save, then use **Send Test Webhook** — the response should be
   `200 {"success":true,"received":true,…}`.

On Vercel, add `RAZORPAY_WEBHOOK_SECRET` under **Project → Settings →
Environment Variables** and redeploy (the committed `.env.development` value is
only a fallback for previews).

### How it behaves

| Situation | HTTP | Effect |
|---|---|---|
| Valid signature, known booking | `200` | `payment_status` → `paid_deposit` / `failed` / `refunded`, `advance_paid_amount` and the Razorpay `payment_id` are stored, owner + customer notified. |
| Replay of the same event | `200 updated:false` | Idempotent — the row is written only once. |
| Event we don't handle | `200 handled:false` | Acknowledged so Razorpay stops retrying. |
| Booking not found | `200 updated:false` | Acknowledged (a retry wouldn't help); logged with the ids. |
| **Invalid signature** | `400` | Rejected, nothing is written. |
| Secret not configured | `503` | Logged loudly; Razorpay retries after you set it. |
| Database failure | `500` | Razorpay retries with backoff. |

The signature is `HMAC_SHA256(raw_body, secret)` from the `X-Razorpay-Signature`
header. Both entrypoints capture the **raw bytes** via
`express.json({ verify })` — hashing a re-serialized `req.body` is the classic
reason webhooks fail with a permanent 400.

Boot log confirms it is armed:

```
[Razorpay] Webhook signature verification ready (POST /api/payments/razorpay/webhook).
```

### Test it locally

```bash
BODY='{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_1","order_id":"order_1","amount":18800,"notes":{"booking_ref":"NX-JPR-40213"}}}}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$RAZORPAY_WEBHOOK_SECRET" -hex | sed 's/.*= //')
curl -X POST localhost:3000/api/payments/razorpay/webhook \
  -H 'Content-Type: application/json' -H "X-Razorpay-Signature: $SIG" -d "$BODY"
```

---

## 6. Owner resolution (`bookings.owner_id`)

Because the column is `NOT NULL`, every authenticated booking must be attached to a salon
owner. The server now tries, in order:

1. a uuid sent by the client (`owner_id`),
2. the profile that owns the request's subdomain / custom domain,
3. the profile matching the owner email in the notification payload,
4. `DEFAULT_OWNER_ID` / `SUPABASE_DEMO_OWNER_ID` from the environment,
5. the only profile in the database (single-salon deployments).

If all five fail it answers `422 owner_unresolved` with an actionable message
instead of letting Postgres raise a 500.

---

## 7. Tests

```bash
npm test        # razorpay + razorpayWebhook + bookingCreate suites (and the rest)
npm run lint    # tsc --noEmit
```

They cover credential loading/placeholder detection, signature verification,
the order/verify/config endpoints, webhook signature + event handling +
idempotency + retry semantics, payload validation, owner resolution, the
Postgres-code → HTTP mapping and the "NOT NULL violation must not be a 500"
regression.
