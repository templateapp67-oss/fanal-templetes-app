// ============================================================================
// Razorpay integration — shared by BOTH Express entrypoints (server.ts for
// dev/prod and api/index.ts for the serverless deployment) so the two can
// never drift.
//
// Why a hand-rolled client instead of the `razorpay` npm SDK?
//   • The SDK is a thin wrapper over the same REST endpoints and drags in a
//     transitive dependency tree that must also exist in the serverless
//     bundle. Everything below is plain `fetch` + `node:crypto`, so it works
//     in Node 18+, in the Vercel runtime and inside unit tests with no
//     network mocking gymnastics.
//   • `createRazorpayClient()` is the "instance initializer": it reads the
//     credentials from the environment ONCE per call, validates them, and
//     returns null with a precise reason when they are missing — instead of
//     throwing deep inside a request handler and surfacing as an opaque
//     HTTP 500.
//
// Environment variables (see .env.example):
//   RAZORPAY_KEY_ID       rzp_test_xxxxxxxxxxxxx  (public — safe in browser)
//   RAZORPAY_KEY_SECRET   xxxxxxxxxxxxxxxxxxxxxx  (SECRET — server only)
// ============================================================================

import crypto from 'node:crypto';

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';
const REQUEST_TIMEOUT_MS = 20_000;

export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
}

export interface RazorpayOrder {
  id: string;
  entity: string;
  amount: number;
  amount_due?: number;
  amount_paid?: number;
  currency: string;
  receipt?: string | null;
  status?: string;
  notes?: Record<string, string>;
  created_at?: number;
}

export interface CreateOrderInput {
  /** Amount in the major unit (₹). Converted to paise internally. */
  amount: number;
  currency?: string;
  receipt?: string;
  notes?: Record<string, unknown>;
}

/** Strip accidental quotes/whitespace copied from a .env file. */
function cleanEnvValue(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^['"]/, '').replace(/['"]$/, '').trim();
}

/**
 * Read the credentials from the environment. Several aliases are accepted so
 * a deployment that already used a different variable name keeps working.
 */
export function readRazorpayCredentials(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): RazorpayCredentials {
  const keyId = cleanEnvValue(
    env.RAZORPAY_KEY_ID || env.VITE_RAZORPAY_KEY_ID || env.RAZORPAY_API_KEY || env.RAZORPAY_KEY
  );
  const keySecret = cleanEnvValue(
    env.RAZORPAY_KEY_SECRET || env.RAZORPAY_SECRET || env.RAZORPAY_API_SECRET
  );
  return { keyId, keySecret };
}

/**
 * Human-readable list of everything wrong with the current credentials.
 * Empty array === ready to charge. Placeholder values from `.env.example`
 * ("YOUR_RAZORPAY_KEY_ID", "") are treated as *not configured* so the app
 * degrades to the demo flow instead of failing the checkout with a 500.
 */
export function getRazorpayConfigIssues(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string[] {
  const { keyId, keySecret } = readRazorpayCredentials(env);
  const issues: string[] = [];
  const looksPlaceholder = (v: string) => /^(your_|my_|xxx|<)/i.test(v) || v.includes('PLACEHOLDER');

  if (!keyId) issues.push('RAZORPAY_KEY_ID is missing from the environment (.env).');
  else if (looksPlaceholder(keyId)) issues.push('RAZORPAY_KEY_ID still holds the placeholder value from .env.example.');
  else if (!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId)) {
    issues.push(`RAZORPAY_KEY_ID "${keyId}" is malformed — expected rzp_test_… or rzp_live_….`);
  }

  if (!keySecret) issues.push('RAZORPAY_KEY_SECRET is missing from the environment (.env).');
  else if (looksPlaceholder(keySecret)) issues.push('RAZORPAY_KEY_SECRET still holds the placeholder value from .env.example.');

  return issues;
}

export function isRazorpayConfigured(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): boolean {
  return getRazorpayConfigIssues(env).length === 0;
}

/** ₹ (rupees, possibly fractional) → integer paise, as Razorpay expects. */
export function toPaise(amountInRupees: number): number {
  return Math.round(Number(amountInRupees) * 100);
}

/**
 * HMAC-SHA256 signature check for the checkout callback.
 * Razorpay signs `${order_id}|${payment_id}` with the key secret.
 */
export function verifyRazorpaySignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
  keySecret?: string;
}): boolean {
  const keySecret = input.keySecret || readRazorpayCredentials().keySecret;
  if (!keySecret || !input.orderId || !input.paymentId || !input.signature) return false;
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(input.signature), 'utf8');
  // Constant-time compare — lengths must match first, timingSafeEqual throws otherwise.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface RazorpayClient {
  keyId: string;
  createOrder(input: CreateOrderInput, deadlineAt?: number): Promise<RazorpayOrder>;
  verifyPaymentSignature(input: { orderId: string; paymentId: string; signature: string }): boolean;
}

/**
 * The Razorpay "instance initializer". Returns null (never throws) when the
 * credentials are absent/malformed so callers can answer with a precise 503
 * instead of an unhandled 500.
 */
export function createRazorpayClient(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): RazorpayClient | null {
  const issues = getRazorpayConfigIssues(env);
  if (issues.length > 0) return null;

  const { keyId, keySecret } = readRazorpayCredentials(env);
  const authHeader = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

  return {
    keyId,

    async createOrder(
      { amount, currency = 'INR', receipt, notes }: CreateOrderInput,
      deadlineAt?: number
    ): Promise<RazorpayOrder> {
      const paise = toPaise(amount);
      if (!Number.isFinite(paise) || paise < 100) {
        // Razorpay rejects anything below ₹1.00 — catch it here with a clear
        // message instead of relaying a cryptic gateway error.
        throw new Error('Order amount must be at least ₹1.00.');
      }

      const body = {
        amount: paise,
        currency,
        receipt: receipt ? String(receipt).slice(0, 40) : undefined,
        payment_capture: 1,
        notes: notes
          ? Object.fromEntries(
              Object.entries(notes)
                .filter(([, v]) => v !== undefined && v !== null)
                .map(([k, v]) => [k, String(v).slice(0, 250)])
            )
          : undefined,
      };

      const remaining = typeof deadlineAt === 'number' ? deadlineAt - Date.now() : REQUEST_TIMEOUT_MS;
      if (remaining <= 0) {
        const timeout: any = new Error('The payment gateway request exceeded the server response deadline.');
        timeout.code = 'razorpay_timeout';
        throw timeout;
      }

      let response: Response;
      try {
        response = await fetch(`${RAZORPAY_API_BASE}/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.max(1, Math.min(REQUEST_TIMEOUT_MS, remaining))),
        });
      } catch (networkError: any) {
        const timedOut = networkError?.name === 'TimeoutError' || networkError?.name === 'AbortError';
        if (timedOut) {
          const timeout: any = new Error('Razorpay did not answer before the server response deadline.');
          timeout.code = 'razorpay_timeout';
          throw timeout;
        }
        // The gateway itself is unreachable (DNS/firewall/outage). Tag it so
        // the route can answer 503 and the checkout can degrade to
        // "pay at salon" instead of dead-ending the customer.
        const unreachable: any = new Error(
          `Could not reach Razorpay (${networkError?.message || 'network error'}). Check the server's outbound connectivity.`
        );
        unreachable.code = 'razorpay_unreachable';
        throw unreachable;
      }

      const raw = await response.text();
      let payload: any = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        // non-JSON error page from an intermediary proxy
      }

      if (!response.ok) {
        const description =
          payload?.error?.description || payload?.message || raw?.slice(0, 300) || 'Unknown Razorpay error';
        const reason = payload?.error?.reason ? ` (${payload.error.reason})` : '';
        throw new Error(`Razorpay order failed [HTTP ${response.status}]${reason}: ${description}`);
      }

      if (!payload?.id) throw new Error('Razorpay returned a response without an order id.');
      return payload as RazorpayOrder;
    },

    verifyPaymentSignature({ orderId, paymentId, signature }) {
      return verifyRazorpaySignature({ orderId, paymentId, signature, keySecret });
    },
  };
}

// ============================================================================
// Express handlers
// ============================================================================

/**
 * GET /api/payments/razorpay/config
 * Lets the browser learn the PUBLIC key id (never the secret) and whether the
 * gateway is live. When it isn't, the booking flow falls back to the demo
 * "pay at salon" path instead of throwing at the user.
 */
export function handleRazorpayConfig(_req: any, res: any): void {
  try {
    const issues = getRazorpayConfigIssues();
    const { keyId } = readRazorpayCredentials();
    if (issues.length > 0) {
      console.warn('[Razorpay] Not configured:', issues.join(' '));
      return void res.json({ success: true, configured: false, keyId: null, issues });
    }
    res.json({ success: true, configured: true, keyId, mode: keyId.startsWith('rzp_live_') ? 'live' : 'test' });
  } catch (err: any) {
    console.error('[Razorpay] config endpoint error:', err?.stack || err?.message || err);
    res.status(500).json({ success: false, configured: false, error: err?.message || 'Razorpay config unavailable.' });
  }
}

/**
 * POST /api/payments/razorpay/order
 * Body: { amount (₹), currency?, receipt?, notes? }
 * → 200 { success, order, keyId } | 400 invalid amount | 503 not configured
 *   | 502 gateway error
 */
export async function handleCreateRazorpayOrder(req: any, res: any): Promise<void> {
  try {
    const { amount, currency = 'INR', receipt, notes } = req.body ?? {};
    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      console.warn('[Razorpay] Rejected order — invalid amount:', amount);
      return void res.status(400).json({
        success: false,
        error: 'A positive payment amount (in ₹) is required to start a Razorpay order.',
      });
    }

    const client = createRazorpayClient();
    if (!client) {
      const issues = getRazorpayConfigIssues();
      console.error('[Razorpay] Order requested but the gateway is not configured:', issues.join(' '));
      return void res.status(503).json({
        success: false,
        code: 'razorpay_not_configured',
        error:
          'Online payment is temporarily unavailable (payment gateway not configured). You can still confirm your booking and pay at the salon.',
        issues,
      });
    }

    const order = await client.createOrder(
      { amount: numericAmount, currency, receipt, notes },
      res.locals?.requestDeadlineAt
    );
    console.log(
      `[Razorpay] Order created ${order.id} for ${order.currency} ${(order.amount / 100).toFixed(2)}` +
        (receipt ? ` (receipt ${receipt})` : '')
    );

    res.json({
      success: true,
      keyId: client.keyId,
      order: { id: order.id, amount: order.amount, currency: order.currency, receipt: order.receipt ?? null },
    });
  } catch (err: any) {
    // Log the FULL error server-side (stdout) — the client only gets the
    // message so the checkout can show something actionable.
    console.error('[Razorpay] Order creation failed:', err?.stack || err?.message || err);
    const timeout = err?.code === 'razorpay_timeout';
    const unreachable = err?.code === 'razorpay_unreachable';
    res.status(timeout ? 504 : unreachable ? 503 : 502).json({
      success: false,
      code: timeout ? 'request_timeout' : unreachable ? 'razorpay_unreachable' : 'razorpay_order_failed',
      retryable: true,
      error: timeout
        ? 'The payment gateway took too long to respond. No payment was charged — please try again.'
        : unreachable
          ? 'Online payment is temporarily unreachable from the server. You can still confirm your booking and pay at the salon.'
          : err?.message || 'Could not start the payment. Please try again.',
      details: err?.message,
    });
  }
}

/**
 * POST /api/payments/razorpay/verify
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * → 200 { success: true, verified: true } | 400 invalid | 503 not configured
 */
export function handleVerifyRazorpayPayment(req: any, res: any): void {
  try {
    const {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
    } = req.body ?? {};

    if (!orderId || !paymentId || !signature) {
      console.warn('[Razorpay] Verification called with missing fields', {
        orderId: !!orderId,
        paymentId: !!paymentId,
        signature: !!signature,
      });
      return void res.status(400).json({
        success: false,
        verified: false,
        error: 'razorpay_order_id, razorpay_payment_id and razorpay_signature are all required.',
      });
    }

    const { keySecret } = readRazorpayCredentials();
    if (!keySecret) {
      console.error('[Razorpay] Cannot verify payment — RAZORPAY_KEY_SECRET is not set.');
      return void res.status(503).json({
        success: false,
        verified: false,
        code: 'razorpay_not_configured',
        error: 'Payment verification is unavailable (RAZORPAY_KEY_SECRET is not configured on the server).',
      });
    }

    const verified = verifyRazorpaySignature({ orderId, paymentId, signature, keySecret });
    if (!verified) {
      console.error(`[Razorpay] Signature mismatch for order ${orderId} / payment ${paymentId}`);
      return void res.status(400).json({
        success: false,
        verified: false,
        error: 'Payment signature verification failed. The payment was not accepted.',
      });
    }

    console.log(`[Razorpay] Payment verified ${paymentId} for order ${orderId}`);
    res.json({ success: true, verified: true, paymentId, orderId });
  } catch (err: any) {
    console.error('[Razorpay] Verification error:', err?.stack || err?.message || err);
    res.status(500).json({ success: false, verified: false, error: err?.message || 'Payment verification failed.' });
  }
}
