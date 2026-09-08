// ============================================================================
// Razorpay Checkout (browser side)
// ----------------------------------------------------------------------------
// The secret key NEVER reaches the browser. The flow is:
//
//   1. GET  /api/payments/razorpay/config  → which gateway is live? public key
//   2. POST /api/payments/razorpay/order   → server derives the 25 % advance in
//                                            integer paise and creates the
//                                            order (secret stays server-side)
//   3. Razorpay Checkout opens with that order id
//        — or, in MOCK mode, POST /api/payments/razorpay/mock-pay stands in
//          for the popup and returns a signed payment triple
//   4. POST /api/payments/razorpay/verify  → server re-checks the HMAC
//                                            signature before we save anything
//
// Every failure mode returns a typed outcome instead of throwing, so the
// booking modal can show a real message and keep the customer's draft.
// ============================================================================

import { computeAdvanceDeposit, DEFAULT_DEPOSIT_PERCENT } from './advanceDeposit';

const CHECKOUT_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

export type PaymentGatewayMode = 'live' | 'test' | 'mock' | 'disabled';

/**
 * One flat outcome shape (this project compiles without strictNullChecks,
 * where TypeScript cannot narrow a discriminated union):
 *
 *   paid         → paymentId / orderId / signature / amount / mode are set
 *   unavailable  → gateway disabled on the server; caller may continue
 *                  without paying (`reason` says why)
 *   dismissed    → the customer closed the payment window
 *   failed       → declined / network / verification failure (`reason`)
 */
export interface RazorpayOutcome {
  status: 'paid' | 'unavailable' | 'dismissed' | 'failed';
  /** Why it did not succeed (empty when paid). */
  reason: string;
  /** Machine-readable code from the server / gateway, when known. */
  code?: string;
  /** Whether tapping "Retry Payment" can reasonably succeed. */
  retryable: boolean;
  /** Razorpay order this attempt used (also set for failed/dismissed attempts). */
  orderId?: string;
  paymentId?: string;
  signature?: string;
  /** ₹ actually charged (whole rupees). 0 unless paid. */
  amount: number;
  /** 'mock' means the advance was simulated — no money moved. */
  mode: PaymentGatewayMode;
}

const unavailableOutcome = (reason: string, code?: string): RazorpayOutcome => ({
  status: 'unavailable',
  reason,
  code,
  retryable: true,
  amount: 0,
  mode: 'disabled',
});

const failedOutcome = (
  reason: string,
  extra: { code?: string; retryable?: boolean; orderId?: string; mode?: PaymentGatewayMode } = {}
): RazorpayOutcome => ({
  status: 'failed',
  reason,
  code: extra.code,
  retryable: extra.retryable !== false,
  orderId: extra.orderId,
  amount: 0,
  mode: extra.mode || 'disabled',
});

export interface RazorpayConfigResponse {
  configured: boolean;
  keyId: string | null;
  mode: PaymentGatewayMode;
  mock: boolean;
  depositPercent: number;
  issues?: string[];
  notice?: string;
}

export interface RazorpayOrderResponse {
  id: string;
  /** Integer paise. */
  amount: number;
  currency: string;
  receipt?: string | null;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, any>) => { open: () => void; on: (event: string, cb: (e: any) => void) => void };
  }
}

let scriptPromise: Promise<boolean> | null = null;

/** Inject checkout.js once; resolves false when it can't be loaded (offline/blocked). */
export function loadRazorpayCheckoutScript(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SCRIPT_URL}"]`);
    const script = existing ?? document.createElement('script');
    script.src = CHECKOUT_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve(!!window.Razorpay);
    script.onerror = () => {
      scriptPromise = null; // allow a retry on the next attempt
      resolve(false);
    };
    if (!existing) document.body.appendChild(script);
  });

  return scriptPromise;
}

export async function fetchRazorpayConfig(fetchImpl: typeof fetch = fetch): Promise<RazorpayConfigResponse> {
  const unavailable = (issues: string[]): RazorpayConfigResponse => ({
    configured: false,
    keyId: null,
    mode: 'disabled',
    mock: false,
    depositPercent: DEFAULT_DEPOSIT_PERCENT,
    issues,
  });
  try {
    const res = await fetchImpl('/api/payments/razorpay/config');
    if (!res.ok) return unavailable([`Config endpoint returned HTTP ${res.status}`]);
    const json = await res.json();
    const configured = !!json?.configured;
    const mode: PaymentGatewayMode =
      json?.mode === 'live' || json?.mode === 'test' || json?.mode === 'mock' ? json.mode : configured ? 'test' : 'disabled';
    return {
      configured,
      keyId: json?.keyId ?? null,
      mode,
      mock: mode === 'mock' || !!json?.mock,
      depositPercent: Number.isFinite(Number(json?.depositPercent)) && Number(json?.depositPercent) > 0
        ? Number(json.depositPercent)
        : DEFAULT_DEPOSIT_PERCENT,
      issues: json?.issues,
      notice: json?.notice,
    };
  } catch (err: any) {
    return unavailable([err?.message || 'Config request failed']);
  }
}

/**
 * Everything needed to (re)open the payment window. The booking modal keeps
 * one of these as its "active draft" so **Retry Payment** re-runs the very
 * same order → checkout → verify sequence with the very same salon, slot,
 * stylist, services and deposit — nothing is re-derived from mutable UI state.
 */
export interface AdvancePaymentInput {
  /** Full service total in ₹ — the server derives the advance from this. */
  totalAmount: number;
  /** Percentage charged now (default 25). */
  depositPercent?: number;
  /**
   * The advance the customer was shown, in ₹. Sent alongside `totalAmount` so
   * the server can refuse an order whose amount differs from what was on the
   * button. Optional — computed from totalAmount when omitted.
   */
  amount?: number;
  /** Short receipt/reference, e.g. the NX-BLR-12345 booking reference. */
  receipt: string;
  description: string;
  customer: { name: string; email?: string; contact: string };
  salonName: string;
  themeColor?: string;
  notes?: Record<string, string>;
  /**
   * Mock gateway only — force a simulated decline so the failure/retry path
   * can be exercised without a card. Ignored by the real gateway.
   */
  mockOutcome?: 'success' | 'failure';
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

export interface CreateAdvanceOrderResult {
  ok: boolean;
  /** Set when ok. */
  order?: RazorpayOrderResponse;
  keyId?: string;
  mode: PaymentGatewayMode;
  mock: boolean;
  /** Whole rupees the order carries (0 when !ok). */
  rupees: number;
  /** Set when !ok — an 'unavailable' or 'failed' outcome to hand back. */
  outcome?: RazorpayOutcome;
}

/** Start the order on the server. Exposed for the retry button + tests. */
export async function createAdvanceOrder(
  input: AdvancePaymentInput,
  fetchImpl: typeof fetch = input.fetchImpl || fetch
): Promise<CreateAdvanceOrderResult> {
  const percent = input.depositPercent || DEFAULT_DEPOSIT_PERCENT;
  const expected = computeAdvanceDeposit(input.totalAmount, percent);
  const shown = Number.isFinite(input.amount) && (input.amount as number) > 0 ? (input.amount as number) : expected.rupees;
  try {
    const res = await fetchImpl('/api/payments/razorpay/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalAmount: input.totalAmount,
        depositPercent: percent,
        amount: shown,
        currency: 'INR',
        receipt: input.receipt,
        notes: { ...(input.notes || {}), salon: input.salonName, customer: input.customer.name },
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success || !json?.order?.id) {
      const reason = json?.error || `Order request failed (HTTP ${res.status}).`;
      // "not configured" / "unreachable" are salon-side gaps, not customer
      // errors: the caller may continue as pay-at-salon.
      const degradable = json?.code === 'razorpay_not_configured' || json?.code === 'razorpay_unreachable';
      return {
        ok: false,
        mode: 'disabled',
        mock: false,
        rupees: 0,
        outcome: degradable
          ? unavailableOutcome(reason, json?.code)
          : failedOutcome(reason, { code: json?.code, retryable: json?.retryable !== false && res.status !== 400 }),
      };
    }
    const mode: PaymentGatewayMode = json.mode === 'live' || json.mode === 'test' || json.mode === 'mock' ? json.mode : 'test';
    return {
      ok: true,
      order: json.order,
      keyId: String(json.keyId || ''),
      mode,
      mock: mode === 'mock' || !!json.mock,
      rupees: Number(json?.deposit?.rupees) || Math.round(Number(json.order.amount) / 100),
    };
  } catch (err: any) {
    return {
      ok: false,
      mode: 'disabled',
      mock: false,
      rupees: 0,
      outcome: failedOutcome(err?.message || 'Could not reach the payment server.', { retryable: true }),
    };
  }
}

export interface VerifyAdvancePaymentResult {
  verified: boolean;
  mode: PaymentGatewayMode;
  /** Set when !verified. */
  reason: string;
}

/** Ask the server to confirm the signature. Exposed for tests. */
export async function verifyAdvancePayment(
  triple: { orderId: string; paymentId: string; signature: string },
  fetchImpl: typeof fetch = fetch
): Promise<VerifyAdvancePaymentResult> {
  try {
    const res = await fetchImpl('/api/payments/razorpay/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpay_order_id: triple.orderId,
        razorpay_payment_id: triple.paymentId,
        razorpay_signature: triple.signature,
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.verified) {
      return { verified: false, mode: 'disabled', reason: json?.error || 'Payment verification failed. Please contact the salon.' };
    }
    const mode: PaymentGatewayMode = json.mode === 'live' || json.mode === 'test' || json.mode === 'mock' ? json.mode : 'test';
    return { verified: true, mode, reason: '' };
  } catch (err: any) {
    return { verified: false, mode: 'disabled', reason: err?.message || 'Payment verification request failed.' };
  }
}

/** MOCK gateway: the server signs a simulated payment instead of a popup. */
async function payWithMockGateway(
  orderId: string,
  outcome: 'success' | 'failure' | undefined,
  fetchImpl: typeof fetch
): Promise<RazorpayOutcome> {
  try {
    const res = await fetchImpl('/api/payments/razorpay/mock-pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, outcome: outcome || 'success' }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.razorpay_payment_id || !json?.razorpay_signature) {
      const description = json?.error?.description || json?.error || 'The simulated payment was declined.';
      return failedOutcome(String(description), { code: json?.code || 'payment_failed', retryable: true, orderId, mode: 'mock' });
    }
    return {
      status: 'paid',
      reason: '',
      retryable: false,
      paymentId: json.razorpay_payment_id,
      orderId: json.razorpay_order_id || orderId,
      signature: json.razorpay_signature,
      amount: 0, // filled in by the caller from the order
      mode: 'mock',
    };
  } catch (err: any) {
    return failedOutcome(err?.message || 'The mock payment request failed.', { retryable: true, orderId, mode: 'mock' });
  }
}

/** Real gateway: open checkout.js and wait for the customer. */
async function payWithCheckoutPopup(
  input: AdvancePaymentInput,
  keyId: string,
  order: RazorpayOrderResponse,
  mode: PaymentGatewayMode
): Promise<RazorpayOutcome> {
  const loaded = await loadRazorpayCheckoutScript();
  if (!loaded || !window.Razorpay) {
    return failedOutcome('The Razorpay payment window could not be loaded. Check your connection and tap Retry Payment.', {
      code: 'checkout_script_blocked',
      retryable: true,
      orderId: order.id,
      mode,
    });
  }

  return new Promise<RazorpayOutcome>((resolve) => {
    let settled = false;
    const settle = (outcome: RazorpayOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    try {
      const rzp = new window.Razorpay!({
        key: keyId,
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        name: input.salonName,
        description: input.description,
        prefill: {
          name: input.customer.name,
          email: input.customer.email || undefined,
          contact: input.customer.contact,
        },
        notes: input.notes,
        theme: { color: input.themeColor || '#0f172a' },
        // Razorpay's own "retry" keeps the popup open after a declined
        // attempt; we handle retries ourselves so the modal can show the
        // reason and the customer keeps their draft.
        retry: { enabled: false },
        modal: {
          ondismiss: () =>
            settle({
              status: 'dismissed',
              reason: 'Payment window closed before the advance was paid.',
              retryable: true,
              orderId: order.id,
              amount: 0,
              mode,
            }),
        },
        handler: (response: any) => {
          settle({
            status: 'paid',
            reason: '',
            retryable: false,
            paymentId: response?.razorpay_payment_id,
            orderId: response?.razorpay_order_id || order.id,
            signature: response?.razorpay_signature,
            amount: Math.round(order.amount / 100),
            mode,
          });
        },
      });

      rzp.on('payment.failed', (event: any) => {
        const desc = event?.error?.description || 'The payment could not be completed.';
        settle(failedOutcome(desc, { code: event?.error?.code, retryable: true, orderId: order.id, mode }));
      });

      rzp.open();
    } catch (err: any) {
      settle(failedOutcome(err?.message || 'The payment window could not be opened.', { retryable: true, orderId: order.id, mode }));
    }
  });
}

/**
 * Run the full advance-token payment. Never throws. Safe to call again with
 * the same input — that is exactly what "Retry Payment" does: a NEW order is
 * created for the same draft (Razorpay orders are single-use once a payment
 * attempt has failed or the window was closed).
 */
export async function payAdvanceWithRazorpay(input: AdvancePaymentInput): Promise<RazorpayOutcome> {
  const fetchImpl = input.fetchImpl || fetch;
  const percent = input.depositPercent || DEFAULT_DEPOSIT_PERCENT;
  const deposit = computeAdvanceDeposit(input.totalAmount, percent);
  if (deposit.rupees <= 0) {
    return unavailableOutcome('No advance amount is payable for this booking.');
  }

  // 1 — which gateway is live?
  const config = await fetchRazorpayConfig(fetchImpl);
  if (!config.configured || !config.keyId) {
    return unavailableOutcome(config.issues?.join(' ') || 'Razorpay is not configured on the server.', 'razorpay_not_configured');
  }

  // 2 — create the order server-side (integer paise, computed by the server)
  const created = await createAdvanceOrder({ ...input, depositPercent: percent, amount: input.amount ?? deposit.rupees }, fetchImpl);
  if (!created.ok || !created.order) {
    return created.outcome || failedOutcome('The payment order could not be created.', { retryable: true });
  }
  const order = created.order;
  const mode = created.mode;
  const keyId = created.keyId || config.keyId;
  const chargedRupees = created.rupees;

  // 3 — collect the payment (popup, or the simulated gateway)
  const result =
    mode === 'mock' || created.mock
      ? await payWithMockGateway(order.id, input.mockOutcome, fetchImpl)
      : await payWithCheckoutPopup(input, keyId, order, mode);

  if (result.status !== 'paid' || !result.paymentId || !result.signature) {
    return result.status === 'paid'
      ? failedOutcome('The payment window returned no payment reference.', { code: 'payment_unverified', retryable: true, orderId: order.id, mode })
      : result;
  }

  // 4 — server-side signature verification (the only proof we trust)
  const verification = await verifyAdvancePayment(
    { orderId: result.orderId || order.id, paymentId: result.paymentId, signature: result.signature },
    fetchImpl
  );
  if (!verification.verified) {
    return failedOutcome(verification.reason, { code: 'payment_unverified', retryable: true, orderId: order.id, mode });
  }

  return { ...result, orderId: result.orderId || order.id, amount: chargedRupees, mode: verification.mode };
}
