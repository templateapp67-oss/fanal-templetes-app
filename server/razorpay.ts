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
// GATEWAY MODES (resolveRazorpayGatewayMode):
//   live      rzp_live_* credentials present            → real money
//   test      rzp_test_* credentials present            → Razorpay sandbox
//   mock      no credentials, NOT a production runtime  → simulated gateway
//   disabled  no credentials, production runtime        → 503 + pay-at-salon
//
// The MOCK gateway exists so a developer/preview/CI environment without keys
// still exercises the *entire* checkout — order → checkout → signature →
// verified booking — instead of dead-ending at "payment service is not
// configured". Mock orders are `order_mock_…`, mock payments `pay_mock_…`, and
// signatures are HMACs with a mock secret, so `/verify` and
// `/api/bookings/create` run the very same code they run for a real payment.
// It never activates on a production runtime unless RAZORPAY_MOCK_MODE=true is
// set explicitly (and then it is logged loudly).
//
// Environment variables (see .env.example):
//   RAZORPAY_KEY_ID       rzp_test_xxxxxxxxxxxxx  (public — safe in browser)
//   RAZORPAY_KEY_SECRET   xxxxxxxxxxxxxxxxxxxxxx  (SECRET — server only)
//   RAZORPAY_MOCK_MODE    true | false | (unset = auto, see above)
//   RAZORPAY_MOCK_SECRET  optional HMAC secret for the mock gateway
// ============================================================================

import crypto from 'node:crypto';
import { computeAdvanceDeposit, rupeesToPaise, DEFAULT_DEPOSIT_PERCENT } from '../src/lib/advanceDeposit';

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';
const REQUEST_TIMEOUT_MS = 20_000;

/** Public "key id" the browser sees while the mock gateway is active. */
export const MOCK_KEY_ID = 'rzp_mock_nexoraSandbox';
const DEFAULT_MOCK_SECRET = 'nexora_mock_gateway_secret_not_for_production';
const MOCK_ORDER_ID_RE = /^order_mock_[A-Za-z0-9]{6,40}$/;

export type RazorpayGatewayMode = 'live' | 'test' | 'mock' | 'disabled';

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

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** Strip accidental quotes/whitespace copied from a .env file. */
function cleanEnvValue(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^['"]/, '').replace(/['"]$/, '').trim();
}

/** 14 URL-safe alphanumerics — the same shape Razorpay uses after the prefix. */
function randomId(length = 14): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/**
 * Read the credentials from the environment. Several aliases are accepted so
 * a deployment that already used a different variable name keeps working.
 */
export function readRazorpayCredentials(env: EnvLike = process.env): RazorpayCredentials {
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
 * Empty array === real credentials are ready. Placeholder values from
 * `.env.example` ("YOUR_RAZORPAY_KEY_ID", "") are treated as *not configured*
 * so the app degrades (mock gateway / pay-at-salon) instead of failing the
 * checkout with a 500.
 */
export function getRazorpayConfigIssues(env: EnvLike = process.env): string[] {
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

/** True when REAL Razorpay credentials (test or live) are present and well-formed. */
export function isRazorpayConfigured(env: EnvLike = process.env): boolean {
  return getRazorpayConfigIssues(env).length === 0;
}

/**
 * "Production" for the purpose of the mock fallback: an explicit
 * NODE_ENV=production (how server.ts is run after `npm run build`) or a Vercel
 * production deployment. Everything else — local `npm run dev`, sandboxes,
 * CI, `node --test` — counts as development/test.
 */
export function isProductionEnvironment(env: EnvLike = process.env): boolean {
  return cleanEnvValue(env.NODE_ENV).toLowerCase() === 'production' ||
    cleanEnvValue(env.VERCEL_ENV).toLowerCase() === 'production';
}

/** Parse RAZORPAY_MOCK_MODE: true / false / undefined (= auto). */
export function readMockModeFlag(env: EnvLike = process.env): boolean | undefined {
  const raw = cleanEnvValue(env.RAZORPAY_MOCK_MODE).toLowerCase();
  if (!raw || raw === 'auto') return undefined;
  if (['1', 'true', 'yes', 'on', 'mock'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return undefined;
}

/**
 * Decide which gateway serves this process. Precedence:
 *   1. RAZORPAY_MOCK_MODE=true   → mock (even when real keys exist — handy when
 *                                  checkout.js / api.razorpay.com is blocked)
 *   2. real credentials present  → live / test (by key prefix)
 *   3. RAZORPAY_MOCK_MODE=false  → disabled
 *   4. auto                      → mock outside production, disabled in production
 */
export function resolveRazorpayGatewayMode(env: EnvLike = process.env): RazorpayGatewayMode {
  const flag = readMockModeFlag(env);
  if (flag === true) return 'mock';
  if (isRazorpayConfigured(env)) {
    return readRazorpayCredentials(env).keyId.startsWith('rzp_live_') ? 'live' : 'test';
  }
  if (flag === false) return 'disabled';
  return isProductionEnvironment(env) ? 'disabled' : 'mock';
}

/** Convenience alias for the process environment. */
export function getRazorpayGatewayMode(): RazorpayGatewayMode {
  return resolveRazorpayGatewayMode(process.env);
}

/** True when an order can be created right now (real or mock gateway). */
export function isRazorpayGatewayAvailable(env: EnvLike = process.env): boolean {
  return resolveRazorpayGatewayMode(env) !== 'disabled';
}

/** Secret used to sign/verify MOCK payments. Never a real Razorpay secret. */
export function readMockSecret(env: EnvLike = process.env): string {
  return cleanEnvValue(env.RAZORPAY_MOCK_SECRET) || DEFAULT_MOCK_SECRET;
}

/**
 * The secret that verifies `razorpay_signature` for the active gateway mode.
 * Empty when the gateway is disabled — callers must then treat any payment
 * claim as unverified.
 */
export function resolveSignatureSecret(env: EnvLike = process.env): { secret: string; mode: RazorpayGatewayMode } {
  const mode = resolveRazorpayGatewayMode(env);
  if (mode === 'mock') return { secret: readMockSecret(env), mode };
  if (mode === 'disabled') return { secret: '', mode };
  return { secret: readRazorpayCredentials(env).keySecret, mode };
}

export function isMockOrderId(orderId: unknown): boolean {
  return typeof orderId === 'string' && MOCK_ORDER_ID_RE.test(orderId);
}

/** ₹ (rupees, possibly fractional) → integer paise, as Razorpay expects. */
export const toPaise = rupeesToPaise;

/** `${order_id}|${payment_id}` signed with HMAC-SHA256 — Razorpay's checkout signature. */
export function computeRazorpaySignature(orderId: string, paymentId: string, keySecret: string): string {
  return crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
}

/**
 * HMAC-SHA256 signature check for the checkout callback.
 * Razorpay signs `${order_id}|${payment_id}` with the key secret. When no
 * secret is passed the one for the ACTIVE gateway mode is used (real secret in
 * test/live, the mock secret in mock mode).
 */
export function verifyRazorpaySignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
  keySecret?: string;
}): boolean {
  const keySecret = input.keySecret || resolveSignatureSecret().secret;
  if (!keySecret || !input.orderId || !input.paymentId || !input.signature) return false;
  const expected = computeRazorpaySignature(input.orderId, input.paymentId, keySecret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(input.signature), 'utf8');
  // Constant-time compare — lengths must match first, timingSafeEqual throws otherwise.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface RazorpayClient {
  keyId: string;
  mode: RazorpayGatewayMode;
  createOrder(input: CreateOrderInput, deadlineAt?: number): Promise<RazorpayOrder>;
  verifyPaymentSignature(input: { orderId: string; paymentId: string; signature: string }): boolean;
}

/** Shared by the real and the mock client: Razorpay refuses anything below ₹1.00. */
function paiseForOrder(amountInRupees: number): number {
  const paise = toPaise(amountInRupees);
  if (!Number.isFinite(paise) || paise < 100) {
    throw new Error('Order amount must be at least ₹1.00.');
  }
  return paise;
}

function normalizeNotes(notes?: Record<string, unknown>): Record<string, string> | undefined {
  if (!notes) return undefined;
  return Object.fromEntries(
    Object.entries(notes)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, String(v).slice(0, 250)])
  );
}

/** Build a mock order that looks exactly like Razorpay's response shape. */
export function createMockOrder(input: CreateOrderInput): RazorpayOrder {
  const paise = paiseForOrder(input.amount);
  return {
    id: `order_mock_${randomId()}`,
    entity: 'order',
    amount: paise,
    amount_paid: 0,
    amount_due: paise,
    currency: input.currency || 'INR',
    receipt: input.receipt ? String(input.receipt).slice(0, 40) : null,
    status: 'created',
    notes: normalizeNotes(input.notes),
    created_at: Math.floor(Date.now() / 1000),
  };
}

/**
 * Produce the {order, payment, signature} triple the browser would receive
 * from Razorpay Checkout after a successful MOCK payment.
 */
export function signMockPayment(
  orderId: string,
  env: EnvLike = process.env
): { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string } {
  const paymentId = `pay_mock_${randomId()}`;
  return {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: computeRazorpaySignature(orderId, paymentId, readMockSecret(env)),
  };
}

function createMockRazorpayClient(env: EnvLike): RazorpayClient {
  const secret = readMockSecret(env);
  return {
    keyId: MOCK_KEY_ID,
    mode: 'mock',
    async createOrder(input) {
      return createMockOrder(input);
    },
    verifyPaymentSignature({ orderId, paymentId, signature }) {
      return verifyRazorpaySignature({ orderId, paymentId, signature, keySecret: secret });
    },
  };
}

/**
 * The Razorpay "instance initializer". Returns the real client in test/live
 * mode, the simulated client in mock mode, and null (never throws) when the
 * gateway is disabled so callers can answer with a precise 503 instead of an
 * unhandled 500.
 */
export function createRazorpayClient(env: EnvLike = process.env): RazorpayClient | null {
  const mode = resolveRazorpayGatewayMode(env);
  if (mode === 'disabled') return null;
  if (mode === 'mock') return createMockRazorpayClient(env);

  const { keyId, keySecret } = readRazorpayCredentials(env);
  const authHeader = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

  return {
    keyId,
    mode,

    async createOrder(
      { amount, currency = 'INR', receipt, notes }: CreateOrderInput,
      deadlineAt?: number
    ): Promise<RazorpayOrder> {
      // Razorpay rejects anything below ₹1.00 — catch it here with a clear
      // message instead of relaying a cryptic gateway error.
      const paise = paiseForOrder(amount);

      const body = {
        amount: paise,
        currency,
        receipt: receipt ? String(receipt).slice(0, 40) : undefined,
        payment_capture: 1,
        notes: normalizeNotes(notes),
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
// Diagnostics — one description used by startup logs and /api/health
// ============================================================================

export interface RazorpayGatewayReport {
  mode: RazorpayGatewayMode;
  /** True when an order can be created (real or mock). */
  ready: boolean;
  /** One-line human summary. */
  summary: string;
  /** Things an operator should know (mock in production, missing keys, …). */
  warnings: string[];
  issues: string[];
}

export function describeRazorpayGateway(env: EnvLike = process.env): RazorpayGatewayReport {
  const mode = resolveRazorpayGatewayMode(env);
  const issues = getRazorpayConfigIssues(env);
  const { keyId } = readRazorpayCredentials(env);
  const warnings: string[] = [];

  if (mode === 'live' || mode === 'test') {
    return {
      mode,
      ready: true,
      summary: `Gateway ready (${mode.toUpperCase()} key ${keyId.slice(0, 12)}…).`,
      warnings,
      issues,
    };
  }

  if (mode === 'mock') {
    const forced = readMockModeFlag(env) === true;
    if (isProductionEnvironment(env)) {
      warnings.push(
        'RAZORPAY_MOCK_MODE=true is set on a PRODUCTION runtime — every "payment" is simulated and no money is collected. Unset it and configure RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.'
      );
    }
    return {
      mode,
      ready: true,
      summary:
        `MOCK payment gateway active (${forced ? 'RAZORPAY_MOCK_MODE=true' : 'no Razorpay credentials and not a production runtime'}). ` +
        'Payments are simulated end-to-end — no money moves. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET for real (test-mode) payments.',
      warnings,
      issues,
    };
  }

  return {
    mode,
    ready: false,
    summary:
      `Online payments are DISABLED — ${issues.join(' ')} ` +
      'Checkout falls back to pay-at-salon. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to enable it.',
    warnings,
    issues,
  };
}

// ============================================================================
// Express handlers
// ============================================================================

/**
 * GET /api/payments/razorpay/config
 * Lets the browser learn the PUBLIC key id (never the secret) and which
 * gateway mode is active. In mock mode the browser opens the simulated
 * checkout; when disabled, the booking flow falls back to "pay at salon".
 */
export function handleRazorpayConfig(_req: any, res: any): void {
  try {
    const mode = getRazorpayGatewayMode();
    if (mode === 'disabled') {
      const issues = getRazorpayConfigIssues();
      console.warn('[Razorpay] Not configured:', issues.join(' '));
      return void res.json({ success: true, configured: false, mock: false, mode, keyId: null, issues });
    }
    if (mode === 'mock') {
      return void res.json({
        success: true,
        configured: true,
        mock: true,
        mode,
        keyId: MOCK_KEY_ID,
        depositPercent: DEFAULT_DEPOSIT_PERCENT,
        notice: 'Mock payment gateway — payments are simulated and no money moves. Set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET to use Razorpay.',
      });
    }
    const { keyId } = readRazorpayCredentials();
    res.json({ success: true, configured: true, mock: false, mode, keyId, depositPercent: DEFAULT_DEPOSIT_PERCENT });
  } catch (err: any) {
    console.error('[Razorpay] config endpoint error:', err?.stack || err?.message || err);
    res.status(500).json({ success: false, configured: false, code: 'razorpay_config_error', error: 'Razorpay configuration is unavailable.' });
  }
}

/**
 * Work out how many rupees to charge from the request body.
 *
 * Preferred contract: `{ totalAmount, depositPercent? }` — the server derives
 * the advance itself (25 % by default) with the SAME rounding the browser
 * uses, so the amount on the button and the amount in the order can never
 * disagree. When the browser also sends its displayed `amount`, a mismatch is
 * refused instead of silently charging something the customer did not see.
 *
 * Legacy contract: `{ amount }` in ₹ (still accepted).
 */
export interface ResolvedOrderAmount {
  ok: boolean;
  /** Whole rupees to charge (0 when !ok). */
  rupees: number;
  /** Integer paise (0 when !ok). */
  paise: number;
  /** Deposit percentage applied, or null for the legacy `{ amount }` contract. */
  percent: number | null;
  /** Service total the deposit was derived from, or null for the legacy contract. */
  total: number | null;
  /** HTTP status / code / message when !ok. */
  status?: number;
  code?: string;
  error?: string;
}

const invalidAmount = (status: number, code: string, error: string): ResolvedOrderAmount => ({
  ok: false,
  rupees: 0,
  paise: 0,
  percent: null,
  total: null,
  status,
  code,
  error,
});

/**
 * This project compiles without strictNullChecks, where TypeScript cannot
 * narrow a discriminated union — hence one flat result shape.
 */
export function resolveOrderAmount(body: any): ResolvedOrderAmount {
  const hasTotal = body?.totalAmount !== undefined && body?.totalAmount !== null && body?.totalAmount !== '';
  const hasAmount = body?.amount !== undefined && body?.amount !== null && body?.amount !== '';

  if (hasTotal) {
    const total = Number(body.totalAmount);
    const percent = body.depositPercent === undefined || body.depositPercent === null || body.depositPercent === ''
      ? DEFAULT_DEPOSIT_PERCENT
      : Number(body.depositPercent);
    if (!Number.isFinite(total) || total <= 0) {
      return invalidAmount(400, 'invalid_amount', 'A positive service total (in ₹) is required to compute the advance.');
    }
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      return invalidAmount(400, 'invalid_amount', 'depositPercent must be between 1 and 100.');
    }
    const deposit = computeAdvanceDeposit(total, percent);
    if (hasAmount) {
      const shown = Number(body.amount);
      if (!Number.isFinite(shown) || Math.abs(shown - deposit.rupees) > 0.5) {
        return invalidAmount(
          400,
          'amount_mismatch',
          `The advance shown (₹${body.amount}) does not match ${percent}% of ₹${total} (₹${deposit.rupees}). Refresh the page and try again.`
        );
      }
    }
    return { ok: true, rupees: deposit.rupees, paise: deposit.paise, percent: deposit.percent, total };
  }

  const rupees = Number(body?.amount);
  if (!Number.isFinite(rupees) || rupees <= 0) {
    return invalidAmount(400, 'invalid_amount', 'A positive payment amount (in ₹) is required to start a Razorpay order.');
  }
  return { ok: true, rupees, paise: toPaise(rupees), percent: null, total: null };
}

/**
 * POST /api/payments/razorpay/order
 * Body: { totalAmount, depositPercent?, amount?, currency?, receipt?, notes? }
 * → 200 { success, mode, mock, keyId, order: { id, amount (paise), currency, receipt }, deposit }
 *   | 400 invalid amount / mismatch | 503 disabled | 502 gateway error | 504 timeout
 */
export async function handleCreateRazorpayOrder(req: any, res: any): Promise<void> {
  try {
    const body = req.body ?? {};
    const { currency = 'INR', receipt, notes } = body;

    const amount = resolveOrderAmount(body);
    if (!amount.ok) {
      console.warn('[Razorpay] Rejected order —', amount.code, { amount: body.amount, totalAmount: body.totalAmount, depositPercent: body.depositPercent });
      return void res.status(amount.status || 400).json({ success: false, code: amount.code, error: amount.error });
    }

    const client = createRazorpayClient();
    if (!client) {
      const issues = getRazorpayConfigIssues();
      console.error('[Razorpay] Order requested but the gateway is disabled:', issues.join(' '));
      return void res.status(503).json({
        success: false,
        code: 'razorpay_not_configured',
        error:
          'Online payment is temporarily unavailable (payment gateway not configured). You can still confirm your booking and pay at the salon.',
        issues,
      });
    }

    const order = await client.createOrder(
      {
        amount: amount.rupees,
        currency,
        receipt,
        notes: {
          ...(notes && typeof notes === 'object' ? notes : {}),
          ...(amount.total !== null ? { total_amount: amount.total } : {}),
          ...(amount.percent !== null ? { deposit_percent: amount.percent } : {}),
          advance_amount: amount.rupees,
        },
      },
      res.locals?.requestDeadlineAt
    );
    console.log(
      `[Razorpay] ${client.mode === 'mock' ? 'MOCK order' : 'Order'} created ${order.id} for ${order.currency} ${(order.amount / 100).toFixed(2)}` +
        (amount.percent !== null ? ` (${amount.percent}% of ₹${amount.total})` : '') +
        (receipt ? ` (receipt ${receipt})` : '')
    );

    res.json({
      success: true,
      mode: client.mode,
      mock: client.mode === 'mock',
      keyId: client.keyId,
      order: { id: order.id, amount: order.amount, currency: order.currency, receipt: order.receipt ?? null },
      deposit: { rupees: amount.rupees, paise: order.amount, percent: amount.percent },
    });
  } catch (err: any) {
    // Log the FULL error server-side (stdout) — the client only gets the
    // message so the checkout can show something actionable.
    console.error('[Razorpay] Order creation failed:', err?.stack || err?.message || err);
    const timeout = err?.code === 'razorpay_timeout';
    const unreachable = err?.code === 'razorpay_unreachable';
    const tooSmall = /at least ₹1/.test(String(err?.message || ''));
    if (tooSmall) {
      return void res.status(400).json({ success: false, code: 'invalid_amount', error: err.message });
    }
    res.status(timeout ? 504 : unreachable ? 503 : 502).json({
      success: false,
      code: timeout ? 'request_timeout' : unreachable ? 'razorpay_unreachable' : 'razorpay_order_failed',
      retryable: true,
      error: timeout
        ? 'The payment gateway took too long to respond. No payment was charged — please try again.'
        : unreachable
          ? 'Online payment is temporarily unreachable from the server. You can still confirm your booking and pay at the salon.'
          : 'The payment gateway could not start the order. No payment was charged — please try again.',
    });
  }
}

/**
 * POST /api/payments/razorpay/mock-pay          (mock gateway ONLY)
 * Body: { order_id, outcome?: 'success' | 'failure' }
 * Stands in for Razorpay Checkout: returns the signed
 * { razorpay_order_id, razorpay_payment_id, razorpay_signature } triple the
 * real popup would hand to the browser, so /verify and /bookings/create run
 * unchanged. Answers 404 whenever the mock gateway is not the active mode.
 */
export function handleMockRazorpayPayment(req: any, res: any): void {
  try {
    if (getRazorpayGatewayMode() !== 'mock') {
      return void res.status(404).json({
        success: false,
        code: 'mock_gateway_disabled',
        error: 'The mock payment gateway is not active on this server.',
      });
    }
    const orderId = req.body?.order_id ?? req.body?.razorpay_order_id;
    if (!isMockOrderId(orderId)) {
      return void res.status(400).json({
        success: false,
        code: 'invalid_mock_order',
        error: 'order_id must be a mock order id (order_mock_…) created by /api/payments/razorpay/order.',
      });
    }
    const outcome = String(req.body?.outcome || 'success').toLowerCase();
    if (outcome === 'failure' || outcome === 'failed' || outcome === 'fail') {
      console.warn(`[Razorpay] MOCK payment FAILED (simulated) for ${orderId}`);
      return void res.status(402).json({
        success: false,
        mock: true,
        code: 'payment_failed',
        error: { code: 'BAD_REQUEST_ERROR', description: 'Simulated payment failure (mock gateway).', reason: 'payment_failed' },
      });
    }
    const signed = signMockPayment(orderId);
    console.log(`[Razorpay] MOCK payment ${signed.razorpay_payment_id} issued for ${orderId}`);
    res.json({ success: true, mock: true, mode: 'mock', ...signed });
  } catch (err: any) {
    console.error('[Razorpay] mock-pay error:', err?.stack || err?.message || err);
    res.status(500).json({ success: false, code: 'mock_payment_error', error: 'The mock payment could not be issued.' });
  }
}

/**
 * POST /api/payments/razorpay/verify
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * → 200 { success: true, verified: true, mode } | 400 invalid | 503 disabled
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

    const { secret, mode } = resolveSignatureSecret();
    if (!secret) {
      console.error('[Razorpay] Cannot verify payment — the gateway is disabled (RAZORPAY_KEY_SECRET is not set).');
      return void res.status(503).json({
        success: false,
        verified: false,
        code: 'razorpay_not_configured',
        error: 'Payment verification is unavailable (RAZORPAY_KEY_SECRET is not configured on the server).',
      });
    }

    // A mock-signed triple must never verify against a real gateway and vice
    // versa: mock ids only exist while the mock gateway is the active mode.
    if (mode !== 'mock' && isMockOrderId(orderId)) {
      console.error(`[Razorpay] Refused mock order ${orderId} while the ${mode} gateway is active.`);
      return void res.status(400).json({
        success: false,
        verified: false,
        error: 'Payment signature verification failed. The payment was not accepted.',
      });
    }

    const verified = verifyRazorpaySignature({ orderId, paymentId, signature, keySecret: secret });
    if (!verified) {
      console.error(`[Razorpay] Signature mismatch for order ${orderId} / payment ${paymentId}`);
      return void res.status(400).json({
        success: false,
        verified: false,
        error: 'Payment signature verification failed. The payment was not accepted.',
      });
    }

    console.log(`[Razorpay] ${mode === 'mock' ? 'MOCK payment' : 'Payment'} verified ${paymentId} for order ${orderId}`);
    res.json({ success: true, verified: true, paymentId, orderId, mode, mock: mode === 'mock' });
  } catch (err: any) {
    console.error('[Razorpay] Verification error:', err?.stack || err?.message || err);
    res.status(500).json({
      success: false,
      verified: false,
      code: 'payment_verification_error',
      error: 'Payment verification could not be completed. Please try again.',
    });
  }
}
