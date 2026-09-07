// ============================================================================
// Razorpay WEBHOOK — POST /api/payments/razorpay/webhook
// ----------------------------------------------------------------------------
// Why a webhook is needed even though the browser already calls
// /api/payments/razorpay/verify:
//   • The customer can pay and then close the tab / lose network before the
//     browser reports back. The webhook is the only path that still tells us
//     the money arrived.
//   • Refunds, late captures and failed authorizations never involve the
//     browser at all.
//
// Razorpay signs the RAW request body with the webhook secret you choose in
// the dashboard (Settings → Webhooks → Add New Webhook):
//     signature = HMAC_SHA256(raw_body, RAZORPAY_WEBHOOK_SECRET)   [hex]
// sent in the `X-Razorpay-Signature` header. The body must be hashed exactly
// as received, so both entrypoints capture it via express.json({ verify }).
//
// Contract with Razorpay:
//   • 2xx  → delivered, never retried
//   • 4xx/5xx → retried with backoff
// So: a bad signature answers 400 (never retry a forgery), an unknown event or
// an unmatched booking answers 200 (retrying would not help), and a genuine
// database failure answers 500 so Razorpay retries it later.
// ============================================================================

import crypto from 'node:crypto';
import { runDb, DEFAULT_DB_TIMEOUT_MS, LOOKUP_DB_TIMEOUT_MS, responseAlreadyEnded } from './dbGuard';

/** Events we act on. Anything else is acknowledged and ignored. */
export const HANDLED_EVENTS = new Set([
  'payment.captured',
  'payment.authorized',
  'payment.failed',
  'order.paid',
  'refund.created',
  'refund.processed',
]);

function cleanEnvValue(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^['"]/, '').replace(/['"]$/, '').trim();
}

export function readWebhookSecret(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string {
  return cleanEnvValue(env.RAZORPAY_WEBHOOK_SECRET || env.RAZORPAY_WEBHOOK_KEY);
}

export function isWebhookConfigured(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): boolean {
  const secret = readWebhookSecret(env);
  return !!secret && !/^(your_|my_|xxx|<)/i.test(secret);
}

/**
 * HMAC-SHA256 over the EXACT bytes Razorpay sent. Re-serializing the parsed
 * JSON would change key order/spacing and break every signature, which is the
 * classic "webhook always returns 400" bug.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!rawBody || !signature || !secret) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody)
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature).trim(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface WebhookFacts {
  event: string;
  paymentId: string | null;
  orderId: string | null;
  /** Amount in ₹ (Razorpay reports paise). */
  amount: number | null;
  /** The NX-… reference we put in the order notes / receipt. */
  bookingRef: string | null;
  /** What the booking's payment_status should become, if anything. */
  nextPaymentStatus: 'paid_deposit' | 'failed' | 'refunded' | null;
  errorDescription: string | null;
}

/** Normalize the different event payload shapes into one flat record. */
export function extractWebhookFacts(body: any): WebhookFacts {
  const event = String(body?.event || '');
  const payment = body?.payload?.payment?.entity ?? null;
  const order = body?.payload?.order?.entity ?? null;
  const refund = body?.payload?.refund?.entity ?? null;

  const notes = { ...(order?.notes || {}), ...(payment?.notes || {}) } as Record<string, string>;
  const bookingRef = notes.booking_ref || notes.bookingRef || order?.receipt || payment?.receipt || null;

  const paisa = refund?.amount ?? payment?.amount ?? order?.amount_paid ?? order?.amount ?? null;

  let nextPaymentStatus: WebhookFacts['nextPaymentStatus'] = null;
  if (event === 'payment.captured' || event === 'order.paid') nextPaymentStatus = 'paid_deposit';
  else if (event === 'payment.failed') nextPaymentStatus = 'failed';
  else if (event === 'refund.created' || event === 'refund.processed') nextPaymentStatus = 'refunded';
  // payment.authorized: money is only blocked, not captured → no status change.

  return {
    event,
    paymentId: refund?.payment_id || payment?.id || null,
    orderId: payment?.order_id || order?.id || null,
    amount: typeof paisa === 'number' ? paisa / 100 : null,
    bookingRef: bookingRef ? String(bookingRef) : null,
    nextPaymentStatus,
    errorDescription: payment?.error_description || null,
  };
}

export interface WebhookDeps {
  db: any;
  isMock: boolean;
  /** Live in-memory bookings array (mock mode). */
  getMockBookings: () => any[];
  addMockNotifications: (rows: any[]) => void;
  resolveOwnerEmail: (ownerId: string | null | undefined, deadlineAt?: number) => Promise<string>;
}

/** Human message for the salon owner's notification bell. */
function notificationFor(facts: WebhookFacts, booking: any): { title: string; message: string } | null {
  const who = booking?.customer_name || 'A customer';
  if (facts.nextPaymentStatus === 'paid_deposit') {
    return {
      title: 'Advance Payment Received',
      message: `${who} paid ₹${facts.amount ?? '—'} for ${booking?.service_name || 'a booking'} (Razorpay ${facts.paymentId}).`,
    };
  }
  if (facts.nextPaymentStatus === 'failed') {
    return {
      title: 'Payment Failed',
      message: `${who}'s payment could not be completed${facts.errorDescription ? ` — ${facts.errorDescription}` : ''}.`,
    };
  }
  if (facts.nextPaymentStatus === 'refunded') {
    return {
      title: 'Payment Refunded',
      message: `₹${facts.amount ?? '—'} was refunded to ${who} (Razorpay ${facts.paymentId}).`,
    };
  }
  return null;
}

export function createRazorpayWebhookHandler(deps: WebhookDeps) {
  return async function handleRazorpayWebhook(req: any, res: any): Promise<void> {
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      const secret = readWebhookSecret();
      if (!secret) {
        console.error(
          '[Razorpay webhook] Received a callback but RAZORPAY_WEBHOOK_SECRET is not set — cannot verify it. ' +
            'Add the same secret you entered in the Razorpay dashboard to the server environment.'
        );
        return void res
          .status(503)
          .json({ success: false, code: 'webhook_not_configured', error: 'Webhook secret is not configured.' });
      }

      const signature = req.headers?.['x-razorpay-signature'];
      const rawBody: Buffer | string | undefined = req.rawBody;

      if (!rawBody) {
        // express.json({ verify }) must stash the raw bytes — without them the
        // signature can never match.
        console.error('[Razorpay webhook] Raw request body was not captured; cannot verify the signature.');
        return void res.status(500).json({ success: false, error: 'Raw body unavailable for signature check.' });
      }

      if (!verifyWebhookSignature(rawBody, signature as string | undefined, secret)) {
        console.error('[Razorpay webhook] REJECTED — signature mismatch.', {
          hasSignature: !!signature,
          bytes: typeof rawBody === 'string' ? rawBody.length : rawBody.length,
        });
        return void res.status(400).json({ success: false, error: 'Invalid webhook signature.' });
      }

      let body: any;
      try {
        body = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)
          ? req.body
          : JSON.parse(String(rawBody));
      } catch {
        // A valid HMAC over malformed JSON is still a bad webhook payload, not
        // an internal error worth retrying forever.
        return void res.status(400).json({ success: false, error: 'Malformed webhook JSON.' });
      }

      const facts = extractWebhookFacts(body);
      console.log(
        `[Razorpay webhook] ${facts.event} · payment=${facts.paymentId ?? '—'} order=${facts.orderId ?? '—'} ` +
          `ref=${facts.bookingRef ?? '—'} amount=₹${facts.amount ?? '—'}`
      );

      if (!HANDLED_EVENTS.has(facts.event)) {
        // Acknowledge so Razorpay stops retrying an event we don't care about.
        return void res.json({ success: true, received: true, event: facts.event, handled: false });
      }

      const result = await applyWebhookToBooking(deps, facts, deadlineAt);
      if (responseAlreadyEnded(res)) return;
      res.json({ success: true, received: true, event: facts.event, handled: true, ...result });
    } catch (err: any) {
      if (responseAlreadyEnded(res)) return;
      // 500 → Razorpay retries with backoff, which is what we want for a
      // transient database/runtime fault.
      console.error('[Razorpay webhook] Unhandled error:', err?.stack || err?.message || err);
      res.status(500).json({ success: false, error: err?.message || 'Webhook processing failed.' });
    }
  };
}

/**
 * Find the booking this event belongs to and move its payment state forward.
 * Idempotent: replaying the same event is a no-op (Razorpay retries and can
 * deliver duplicates).
 */
async function applyWebhookToBooking(
  deps: WebhookDeps,
  facts: WebhookFacts,
  deadlineAt?: number
): Promise<{ bookingId?: string; updated: boolean; reason?: string }> {
  // The booking row stores either the Razorpay payment id (browser flow
  // completed) or the NX-… reference (customer left before we heard back).
  const ids = [facts.paymentId, facts.bookingRef].filter(Boolean) as string[];
  if (ids.length === 0) return { updated: false, reason: 'no payment id or booking reference in the event' };

  if (deps.isMock) {
    const booking = deps.getMockBookings().find((b) => ids.includes(b.payment_id));
    if (!booking) return { updated: false, reason: 'booking not found (mock)' };
    if (!facts.nextPaymentStatus || booking.payment_status === facts.nextPaymentStatus) {
      return { bookingId: booking.id, updated: false, reason: 'already up to date' };
    }
    booking.payment_status = facts.nextPaymentStatus;
    if (facts.nextPaymentStatus === 'paid_deposit') {
      booking.payment_id = facts.paymentId || booking.payment_id;
      if (facts.amount !== null) booking.advance_paid_amount = facts.amount;
    }
    if (facts.nextPaymentStatus === 'refunded') booking.advance_paid_amount = 0;

    const note = notificationFor(facts, booking);
    if (note) {
      deps.addMockNotifications([
        { user_email: 'owner@salon.com', ...note, id: `mock-${Date.now()}`, created_at: new Date().toISOString() },
      ]);
    }
    console.log(`[Razorpay webhook] (mock) booking ${booking.id} → ${facts.nextPaymentStatus}`);
    return { bookingId: booking.id, updated: true };
  }

  const lookup = await runDb(
    () => deps.db.from('bookings').select('*').in('payment_id', ids).limit(1),
    { label: 'Razorpay webhook booking lookup', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt, retry: false }
  );
  if (lookup.error) {
    // Throw so the outer catch answers 500 and Razorpay retries. The timeout
    // guard still prevents a dead Supabase project from becoming an HTML 500.
    throw new Error(`Booking lookup failed: ${lookup.error.message || lookup.error}`);
  }
  const booking = Array.isArray(lookup.data) ? lookup.data[0] : lookup.data;
  if (!booking) {
    console.warn(`[Razorpay webhook] No booking matches ${ids.join(' / ')} — acknowledged without changes.`);
    return { updated: false, reason: 'booking not found' };
  }

  if (!facts.nextPaymentStatus || booking.payment_status === facts.nextPaymentStatus) {
    return { bookingId: booking.id, updated: false, reason: 'already up to date' };
  }

  const changes: Record<string, any> = { payment_status: facts.nextPaymentStatus };
  if (facts.nextPaymentStatus === 'paid_deposit') {
    if (facts.paymentId) changes.payment_id = facts.paymentId;
    if (facts.amount !== null) changes.advance_paid_amount = facts.amount;
  }
  if (facts.nextPaymentStatus === 'refunded') changes.advance_paid_amount = 0;

  const updateResult = await runDb(
    () => deps.db.from('bookings').update(changes).eq('id', booking.id),
    { label: 'Razorpay webhook booking update', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt, retry: false }
  );
  if (updateResult.error) throw new Error(`Booking update failed: ${updateResult.error.message || updateResult.error}`);
  console.log(`[Razorpay webhook] Booking ${booking.id} → ${facts.nextPaymentStatus}`);

  const note = notificationFor(facts, booking);
  if (note) {
    try {
      const ownerEmail = await deps.resolveOwnerEmail(booking.owner_id, deadlineAt);
      const rows: any[] = [{ user_email: ownerEmail, ...note }];
      if (booking.customer_email) rows.push({ user_email: booking.customer_email, ...note });
      const notifResult = await runDb(
        () => deps.db.from('in_app_notifications').insert(rows),
        { label: 'Razorpay webhook notification', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt, retry: false }
      );
      // A notification failure must never make Razorpay retry a processed event.
      if (notifResult.error) console.warn('[Razorpay webhook] Notification insert failed:', notifResult.error.message || notifResult.error);
    } catch (notifErr: any) {
      console.warn('[Razorpay webhook] Notification insert threw:', notifErr?.message || notifErr);
    }
  }

  return { bookingId: booking.id, updated: true };
}
