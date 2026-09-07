// ============================================================================
// Razorpay Checkout (browser side)
// ----------------------------------------------------------------------------
// The secret key NEVER reaches the browser. The flow is:
//
//   1. GET  /api/payments/razorpay/config  → is the gateway live? public key id
//   2. POST /api/payments/razorpay/order   → server creates the order (secret
//                                            stays server-side)
//   3. Razorpay Checkout opens with that order id
//   4. POST /api/payments/razorpay/verify  → server re-checks the HMAC
//                                            signature before we save anything
//
// Every failure mode returns a typed outcome instead of throwing, so the
// booking modal can show a real message and keep the customer's details.
// ============================================================================

const CHECKOUT_SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

export type RazorpayOutcome =
  | { status: 'paid'; paymentId: string; orderId: string; signature: string }
  /** Gateway not configured on the server — caller may continue without paying. */
  | { status: 'unavailable'; reason: string }
  /** Customer closed the payment window. */
  | { status: 'dismissed' }
  | { status: 'failed'; reason: string };

export interface RazorpayConfigResponse {
  configured: boolean;
  keyId: string | null;
  mode?: 'test' | 'live';
  issues?: string[];
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

export async function fetchRazorpayConfig(): Promise<RazorpayConfigResponse> {
  try {
    const res = await fetch('/api/payments/razorpay/config');
    if (!res.ok) return { configured: false, keyId: null, issues: [`Config endpoint returned HTTP ${res.status}`] };
    const json = await res.json();
    return { configured: !!json?.configured, keyId: json?.keyId ?? null, mode: json?.mode, issues: json?.issues };
  } catch (err: any) {
    return { configured: false, keyId: null, issues: [err?.message || 'Config request failed'] };
  }
}

export interface AdvancePaymentInput {
  /** Amount in ₹ (major unit). */
  amount: number;
  /** Short receipt/reference, e.g. the NX-BLR-12345 booking reference. */
  receipt: string;
  description: string;
  customer: { name: string; email?: string; contact: string };
  salonName: string;
  themeColor?: string;
  notes?: Record<string, string>;
}

/**
 * Run the full advance-token payment. Never throws.
 */
export async function payAdvanceWithRazorpay(input: AdvancePaymentInput): Promise<RazorpayOutcome> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { status: 'unavailable', reason: 'No advance amount is payable for this booking.' };
  }

  // 1 — is the gateway configured?
  const config = await fetchRazorpayConfig();
  if (!config.configured || !config.keyId) {
    return {
      status: 'unavailable',
      reason: config.issues?.join(' ') || 'Razorpay is not configured on the server.',
    };
  }

  // 2 — create the order server-side
  let order: { id: string; amount: number; currency: string };
  try {
    const res = await fetch('/api/payments/razorpay/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: input.amount,
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
      return degradable ? { status: 'unavailable', reason } : { status: 'failed', reason };
    }
    order = json.order;
  } catch (err: any) {
    return { status: 'failed', reason: err?.message || 'Could not reach the payment server.' };
  }

  // 3 — open Razorpay Checkout
  const loaded = await loadRazorpayCheckoutScript();
  if (!loaded || !window.Razorpay) {
    return { status: 'failed', reason: 'The Razorpay payment window could not be loaded. Check your connection.' };
  }

  const result = await new Promise<RazorpayOutcome>((resolve) => {
    let settled = false;
    const settle = (outcome: RazorpayOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    try {
      const rzp = new window.Razorpay!({
        key: config.keyId,
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
        modal: {
          ondismiss: () => settle({ status: 'dismissed' }),
        },
        handler: (response: any) => {
          settle({
            status: 'paid',
            paymentId: response?.razorpay_payment_id,
            orderId: response?.razorpay_order_id || order.id,
            signature: response?.razorpay_signature,
          });
        },
      });

      rzp.on('payment.failed', (event: any) => {
        const desc = event?.error?.description || 'The payment could not be completed.';
        settle({ status: 'failed', reason: desc });
      });

      rzp.open();
    } catch (err: any) {
      settle({ status: 'failed', reason: err?.message || 'The payment window could not be opened.' });
    }
  });

  if (result.status !== 'paid') return result;

  // 4 — server-side signature verification (the only proof we trust)
  try {
    const res = await fetch('/api/payments/razorpay/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpay_order_id: result.orderId,
        razorpay_payment_id: result.paymentId,
        razorpay_signature: result.signature,
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.verified) {
      return { status: 'failed', reason: json?.error || 'Payment verification failed. Please contact the salon.' };
    }
  } catch (err: any) {
    return { status: 'failed', reason: err?.message || 'Payment verification request failed.' };
  }

  return result;
}
