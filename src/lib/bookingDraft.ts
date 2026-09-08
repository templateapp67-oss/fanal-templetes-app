// ============================================================================
// Booking draft — the single payload the checkout works from.
// ----------------------------------------------------------------------------
// When the customer taps "Confirm Appointment" the modal freezes everything it
// knows into ONE BookingDraft: salon, service + add-ons, specialist, slot,
// visit type, contact details and the exact deposit that was on the button.
//
// Every later action works from that snapshot rather than from live React
// state:
//   • "Retry Payment" re-runs order → checkout → verify with the same draft, so
//     a re-render, a changed default or a stale closure can never charge a
//     different amount or book a different slot than the customer saw.
//   • "Review Draft" lists the very fields the payment was attempted with.
//   • The draft is mirrored to sessionStorage so a reload in the middle of a
//     payment (mobile UPI hand-offs do this) does not lose the booking.
//
// Pure functions only — no React, no fetch — so the whole thing is unit-tested
// in tests/bookingDraft.test.ts.
// ============================================================================

import { computeAdvanceDeposit, DEFAULT_DEPOSIT_PERCENT } from './advanceDeposit';
import type { AdvancePaymentInput, PaymentGatewayMode } from './razorpayCheckout';

export const BOOKING_DRAFT_STORAGE_KEY = 'nexora_booking_draft_v1';
/** A draft older than this is stale: the held slot has long expired. */
export const BOOKING_DRAFT_TTL_MS = 30 * 60 * 1000;

export interface DraftService {
  id: string;
  name: string;
  price: number;
  durationMinutes?: number;
}

export type DraftPaymentStatus = 'unpaid' | 'failed' | 'dismissed' | 'unverified' | 'paid';

export interface BookingDraft {
  /** Booking reference (NX-BLR-12345). Doubles as the Razorpay receipt. */
  id: string;
  createdAt: string;
  updatedAt: string;
  salon: {
    /** Stable salon identifier: the owner/profile id when known, otherwise the subdomain. */
    id: string | null;
    /** Owner (auth user) id — what the booking row's owner_id resolves from. */
    ownerId: string | null;
    subdomain: string | null;
    name: string;
    city: string | null;
    email: string | null;
  };
  service: DraftService;
  upgrades: DraftService[];
  stylist: { id: string; name: string };
  slot: { date: string; time: string };
  bookingType: 'salon' | 'home';
  homeAddress: string | null;
  homePinCode: string | null;
  customer: { name: string; phone: string; email: string | null; notes: string | null };
  pricing: {
    currency: string;
    total: number;
    depositPercent: number;
    /** Whole rupees charged now — what the button showed. */
    depositAmount: number;
    /** The same amount in integer paise (what the Razorpay order carries). */
    depositPaise: number;
    balance: number;
  };
  payment: {
    method: 'pay_advance_token' | 'pay_at_salon';
    status: DraftPaymentStatus;
    /** Number of checkout attempts made with this draft. */
    attempts: number;
    lastError: string | null;
    lastOrderId: string | null;
    /** Filled once a payment verified. */
    orderId: string | null;
    paymentId: string | null;
    signature: string | null;
    mode: PaymentGatewayMode | null;
  };
}

export interface BuildBookingDraftInput {
  id: string;
  salon: { ownerId?: string | null; subdomain?: string | null; businessName: string; city?: string | null; email?: string | null; currency?: string | null };
  service: DraftService;
  upgrades?: DraftService[];
  stylist: { id: string; name: string };
  date: string;
  time: string;
  bookingType: 'salon' | 'home';
  homeAddress?: string | null;
  homePinCode?: string | null;
  homeServiceCharge?: number;
  customer: { name: string; phone: string; email?: string | null; notes?: string | null };
  paymentMethod: 'pay_advance_token' | 'pay_at_salon';
  depositPercent?: number;
  now?: Date;
}

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value).trim());

/** Freeze the current selections into a draft. */
export function buildBookingDraft(input: BuildBookingDraftInput): BookingDraft {
  const now = (input.now || new Date()).toISOString();
  const upgrades = (input.upgrades || []).map((u) => ({
    id: String(u.id),
    name: clean(u.name),
    price: Number(u.price) || 0,
    ...(u.durationMinutes !== undefined ? { durationMinutes: u.durationMinutes } : {}),
  }));
  const homeCharge = input.bookingType === 'home' ? Number(input.homeServiceCharge) || 0 : 0;
  const total = (Number(input.service.price) || 0) + upgrades.reduce((sum, u) => sum + u.price, 0) + homeCharge;
  const percent = input.depositPercent || DEFAULT_DEPOSIT_PERCENT;
  const deposit = computeAdvanceDeposit(total, percent);
  const payingAdvance = input.paymentMethod === 'pay_advance_token' && deposit.rupees > 0;

  return {
    id: input.id,
    createdAt: now,
    updatedAt: now,
    salon: {
      id: clean(input.salon.ownerId) || clean(input.salon.subdomain) || null,
      ownerId: clean(input.salon.ownerId) || null,
      subdomain: clean(input.salon.subdomain) || null,
      name: clean(input.salon.businessName),
      city: clean(input.salon.city) || null,
      email: clean(input.salon.email) || null,
    },
    service: {
      id: String(input.service.id),
      name: clean(input.service.name),
      price: Number(input.service.price) || 0,
      ...(input.service.durationMinutes !== undefined ? { durationMinutes: input.service.durationMinutes } : {}),
    },
    upgrades,
    stylist: { id: String(input.stylist.id), name: clean(input.stylist.name) },
    slot: { date: clean(input.date), time: clean(input.time) },
    bookingType: input.bookingType,
    homeAddress: input.bookingType === 'home' ? clean(input.homeAddress) || null : null,
    homePinCode: input.bookingType === 'home' ? clean(input.homePinCode) || null : null,
    customer: {
      name: clean(input.customer.name),
      phone: clean(input.customer.phone),
      email: clean(input.customer.email) || null,
      notes: clean(input.customer.notes) || null,
    },
    pricing: {
      currency: clean(input.salon.currency) || '₹',
      total,
      depositPercent: percent,
      depositAmount: payingAdvance ? deposit.rupees : 0,
      depositPaise: payingAdvance ? deposit.paise : 0,
      balance: total - (payingAdvance ? deposit.rupees : 0),
    },
    payment: {
      method: input.paymentMethod,
      status: 'unpaid',
      attempts: 0,
      lastError: null,
      lastOrderId: null,
      orderId: null,
      paymentId: null,
      signature: null,
      mode: null,
    },
  };
}

/** The exact payload handed to payAdvanceWithRazorpay — identical on every retry. */
export function toAdvancePaymentInput(
  draft: BookingDraft,
  options: { themeColor?: string; accountEmail?: string | null; mockOutcome?: 'success' | 'failure' } = {}
): AdvancePaymentInput {
  const upgradeNames = draft.upgrades.map((u) => u.name).filter(Boolean);
  return {
    totalAmount: draft.pricing.total,
    depositPercent: draft.pricing.depositPercent,
    amount: draft.pricing.depositAmount,
    receipt: draft.id,
    description: `${draft.pricing.depositPercent}% advance for ${draft.service.name} on ${draft.slot.date} at ${draft.slot.time}`,
    customer: {
      name: draft.customer.name || 'Guest Client',
      email: draft.customer.email || options.accountEmail || undefined,
      contact: draft.customer.phone,
    },
    salonName: draft.salon.name,
    themeColor: options.themeColor,
    notes: {
      booking_ref: draft.id,
      salon_id: draft.salon.id || '',
      service: draft.service.name,
      ...(upgradeNames.length ? { addons: upgradeNames.join(', ').slice(0, 250) } : {}),
      stylist: draft.stylist.name,
      slot: `${draft.slot.date} ${draft.slot.time}`,
      booking_type: draft.bookingType,
    },
    ...(options.mockOutcome ? { mockOutcome: options.mockOutcome } : {}),
  };
}

/** Record the result of a checkout attempt without mutating the original. */
export function recordPaymentAttempt(
  draft: BookingDraft,
  result:
    | { status: 'failed' | 'dismissed' | 'unverified'; error?: string | null; orderId?: string | null }
    | { status: 'paid'; orderId: string; paymentId: string; signature: string; mode: PaymentGatewayMode },
  now: Date = new Date()
): BookingDraft {
  const attempts = draft.payment.attempts + 1;
  if (result.status === 'paid') {
    return {
      ...draft,
      updatedAt: now.toISOString(),
      payment: {
        ...draft.payment,
        status: 'paid',
        attempts,
        lastError: null,
        lastOrderId: result.orderId,
        orderId: result.orderId,
        paymentId: result.paymentId,
        signature: result.signature,
        mode: result.mode,
      },
    };
  }
  return {
    ...draft,
    updatedAt: now.toISOString(),
    payment: {
      ...draft.payment,
      status: result.status,
      attempts,
      lastError: result.error || null,
      lastOrderId: result.orderId || draft.payment.lastOrderId,
    },
  };
}

/** The single string the `bookings.home_address` column stores. */
export function draftHomeAddress(draft: BookingDraft): string | undefined {
  if (draft.bookingType !== 'home') return undefined;
  const address = `${draft.homeAddress || ''}${draft.homePinCode ? ` (PIN: ${draft.homePinCode})` : ''}`.trim();
  return address || undefined;
}

const money = (value: number, currency: string) => `${currency}${Math.round(value).toLocaleString('en-IN')}`;

export interface DraftReviewRow {
  key: 'salon' | 'service' | 'stylist' | 'slot' | 'type' | 'customer' | 'deposit';
  label: string;
  value: string;
  /** Which step of the modal edits this row. */
  editStep?: 'service' | 'upgrades' | 'datetime' | 'guest';
}

/** Rows for the "Review Draft" panel — every parameter the payment used. */
export function describeBookingDraft(draft: BookingDraft): DraftReviewRow[] {
  const cur = draft.pricing.currency;
  const serviceLine =
    `${draft.service.name} (${money(draft.service.price, cur)})` +
    (draft.upgrades.length
      ? ` + ${draft.upgrades.map((u) => `${u.name} (${money(u.price, cur)})`).join(', ')}`
      : '');
  const depositLine =
    draft.pricing.depositAmount > 0
      ? `${money(draft.pricing.depositAmount, cur)} now (${draft.pricing.depositPercent}% of ${money(draft.pricing.total, cur)}) · ${money(draft.pricing.balance, cur)} at the salon`
      : `Nothing now · ${money(draft.pricing.total, cur)} at the salon`;

  return [
    {
      key: 'salon',
      label: 'Salon',
      value: `${draft.salon.name}${draft.salon.subdomain ? ` · ${draft.salon.subdomain}` : ''}${draft.salon.city ? ` · ${draft.salon.city}` : ''}`,
    },
    { key: 'service', label: 'Services', value: serviceLine, editStep: 'service' },
    { key: 'stylist', label: 'Specialist', value: draft.stylist.name, editStep: 'service' },
    { key: 'slot', label: 'Time slot', value: `${draft.slot.date} at ${draft.slot.time} IST`, editStep: 'datetime' },
    {
      key: 'type',
      label: 'Visit',
      value:
        draft.bookingType === 'home'
          ? `Home service${draft.homeAddress ? ` — ${draft.homeAddress}` : ''}${draft.homePinCode ? ` (PIN ${draft.homePinCode})` : ''}`
          : 'In-salon',
      editStep: 'service',
    },
    {
      key: 'customer',
      label: 'Guest',
      value: `${draft.customer.name} · +91 ${draft.customer.phone}${draft.customer.email ? ` · ${draft.customer.email}` : ''}`,
      editStep: 'guest',
    },
    { key: 'deposit', label: 'Deposit', value: depositLine },
  ];
}

// ----------------------------------------------------------------------------
// sessionStorage mirror (per tab, so two salons in two tabs never collide)
// ----------------------------------------------------------------------------

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveBookingDraft(draft: BookingDraft, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(BOOKING_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Quota / private mode — the in-memory draft still works.
  }
}

export function clearBookingDraft(storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(BOOKING_DRAFT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Load a draft that is still worth resuming: same salon, not paid, not stale.
 * Anything else is discarded so a customer never resumes another salon's slot.
 */
export interface DraftSalonRef {
  ownerId?: string | null;
  subdomain?: string | null;
  name?: string | null;
}

/** Does this draft belong to the salon the modal is open for? */
export function draftMatchesSalon(draft: BookingDraft, salon: DraftSalonRef): boolean {
  const ownerId = clean(salon.ownerId);
  const subdomain = clean(salon.subdomain);
  const name = clean(salon.name);
  if (ownerId && draft.salon.ownerId) return draft.salon.ownerId === ownerId;
  if (subdomain && draft.salon.subdomain) return draft.salon.subdomain === subdomain;
  if (name) return draft.salon.name === name;
  return false;
}

export function loadBookingDraft(
  options: { salon?: DraftSalonRef; now?: Date; storage?: StorageLike | null } = {}
): BookingDraft | null {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  if (!storage) return null;
  let parsed: any;
  try {
    const raw = storage.getItem(BOOKING_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isBookingDraft(parsed)) {
    clearBookingDraft(storage);
    return null;
  }
  const now = options.now || new Date();
  const age = now.getTime() - Date.parse(parsed.updatedAt || parsed.createdAt);
  if (!Number.isFinite(age) || age < 0 || age > BOOKING_DRAFT_TTL_MS || parsed.payment.status === 'paid') {
    clearBookingDraft(storage);
    return null;
  }
  if (options.salon && !draftMatchesSalon(parsed, options.salon)) return null;
  return parsed;
}

export function isBookingDraft(value: unknown): value is BookingDraft {
  if (!value || typeof value !== 'object') return false;
  const d = value as any;
  return (
    typeof d.id === 'string' &&
    d.salon && typeof d.salon === 'object' &&
    d.service && typeof d.service.name === 'string' &&
    Array.isArray(d.upgrades) &&
    d.stylist && typeof d.stylist.name === 'string' &&
    d.slot && typeof d.slot.date === 'string' && typeof d.slot.time === 'string' &&
    d.customer && typeof d.customer.phone === 'string' &&
    d.pricing && typeof d.pricing.total === 'number' && typeof d.pricing.depositAmount === 'number' &&
    d.payment && typeof d.payment.status === 'string' && typeof d.payment.attempts === 'number'
  );
}
