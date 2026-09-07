// ============================================================================
// POST /api/bookings/create — shared implementation for BOTH Express
// entrypoints (server.ts and api/index.ts).
//
// WHY THIS FILE EXISTS (the "Server error (HTTP 500)" on checkout):
// The old inline handler passed the client payload almost straight into
// `bookings.insert()`. Three things could blow up there, and every one of them
// surfaced to the customer as a bare HTTP 500:
//
//   1. `bookings.owner_id` is `uuid NOT NULL references auth.users(id)`, but a
//      guest booking made from a template/preview site has no owner id (the
//      public profile carries `ownerId: null`). `sanitizeBookingRow` then
//      nulls it and Postgres rejects the row with
//      `23502 null value in column "owner_id" violates not-null constraint`.
//   2. Nothing validated the payload, so an empty name, a malformed date or a
//      non-numeric amount reached Postgres and came back as a 22P02/23514
//      database error instead of a readable "please fill in …" message.
//   3. The catch-all only logged `console.warn(err)` — no context, no stack,
//      no payload — so the real cause was invisible in the server logs.
//
// The handler below resolves the owner (payload → subdomain → owner email →
// DEFAULT_OWNER_ID → single-tenant profile), validates every field up front,
// logs the exact failure to stdout, and maps known Postgres error codes to
// actionable 4xx responses. A 500 is now reserved for genuinely unexpected
// faults.
// ============================================================================

import { isUuidLike, sanitizeBookingRow } from './bookingOps';
import { isRazorpayConfigured, verifyRazorpaySignature } from './razorpay';
import { resolveTenantFromHost } from '../src/lib/tenant';
import {
  runDb,
  newRequestId,
  isTransientDbError,
  DEFAULT_DB_TIMEOUT_MS,
  LOOKUP_DB_TIMEOUT_MS,
  responseAlreadyEnded,
} from './dbGuard';

const ALLOWED_STATUS = new Set(['pending', 'confirmed', 'cancelled', 'completed', 'reschedule_proposed']);
const ALLOWED_PAYMENT_STATUS = new Set(['pending', 'paid_deposit', 'paid_full', 'pay_at_salon', 'refunded', 'failed']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Date.parse normalizes impossible dates (2026-02-31 → March), so compare
 * every UTC component after parsing instead of accepting a silently shifted
 * appointment date. */
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day
  );
}

export interface BookingValidationResult {
  valid: boolean;
  /** Human-readable problems, one per invalid field. */
  errors: string[];
  /** Field → message, so the UI can highlight inputs if it wants to. */
  fieldErrors: Record<string, string>;
  /** Normalized row (only present when valid). */
  value: Record<string, any>;
}

/**
 * Validate + normalize the incoming booking BEFORE it reaches Postgres or the
 * payment gateway. Returns readable errors instead of letting the database
 * raise a constraint violation.
 */
export function validateBookingPayload(input: any): BookingValidationResult {
  const errors: string[] = [];
  const fieldErrors: Record<string, string> = {};
  const fail = (field: string, message: string) => {
    if (!fieldErrors[field]) {
      fieldErrors[field] = message;
      errors.push(message);
    }
  };

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      valid: false,
      errors: ['A booking object is required.'],
      fieldErrors: { booking: 'A booking object is required.' },
      value: {},
    };
  }

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim());

  // --- customer -------------------------------------------------------------
  const customerName = str(input.customer_name);
  if (!customerName) fail('customer_name', 'Customer name is required.');
  else if (customerName.length > 120) fail('customer_name', 'Customer name must be 120 characters or fewer.');

  const rawPhone = str(input.customer_phone);
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits) fail('customer_phone', 'A contact phone number is required.');
  else if (digits.length < 10 || digits.length > 15) {
    fail('customer_phone', 'Phone number looks invalid — enter a 10-digit mobile number.');
  }

  const customerEmail = str(input.customer_email);
  if (customerEmail && !EMAIL_RE.test(customerEmail)) fail('customer_email', 'Email address looks invalid.');

  // --- service --------------------------------------------------------------
  const serviceName = str(input.service_name);
  if (!serviceName) fail('service_name', 'A service must be selected.');

  // --- slot -----------------------------------------------------------------
  const bookingDate = str(input.booking_date);
  if (!bookingDate) fail('booking_date', 'A booking date is required.');
  else if (!isValidIsoDate(bookingDate)) {
    fail('booking_date', `Booking date "${bookingDate}" is not a valid YYYY-MM-DD date.`);
  }

  const timeSlot = str(input.time_slot);
  if (!timeSlot) fail('time_slot', 'A time slot is required.');

  // --- money ----------------------------------------------------------------
  const totalAmount = input.total_amount === undefined || input.total_amount === null ? 0 : Number(input.total_amount);
  if (!Number.isFinite(totalAmount) || totalAmount < 0) fail('total_amount', 'Total amount must be a positive number.');

  const advanceRaw = input.advance_paid_amount;
  const advanceAmount = advanceRaw === undefined || advanceRaw === null || advanceRaw === '' ? 0 : Number(advanceRaw);
  if (!Number.isFinite(advanceAmount) || advanceAmount < 0) {
    fail('advance_paid_amount', 'Advance amount must be a positive number.');
  } else if (Number.isFinite(totalAmount) && advanceAmount > totalAmount + 0.001) {
    fail('advance_paid_amount', 'Advance amount cannot be greater than the total amount.');
  }

  // --- enums (never reject; fall back to the schema default) ----------------
  const status = ALLOWED_STATUS.has(str(input.status)) ? str(input.status) : 'pending';
  const paymentStatus = ALLOWED_PAYMENT_STATUS.has(str(input.payment_status)) ? str(input.payment_status) : 'pending';
  const bookingType = ['salon', 'home'].includes(str(input.booking_type)) ? str(input.booking_type) : undefined;

  if (errors.length > 0) return { valid: false, errors, fieldErrors, value: {} };

  const value: Record<string, any> = {
    customer_name: customerName,
    customer_phone: digits.length === 10 ? `+91${digits}` : rawPhone,
    customer_email: customerEmail || null,
    service_id: input.service_id ?? null,
    service_name: serviceName,
    booking_date: bookingDate,
    time_slot: timeSlot,
    total_amount: Number(totalAmount.toFixed(2)),
    advance_paid_amount: Number(advanceAmount.toFixed(2)),
    status,
    payment_status: paymentStatus,
    payment_id: str(input.payment_id) || null,
  };
  if (bookingType) value.booking_type = bookingType;
  if (str(input.home_address)) value.home_address = str(input.home_address);
  if (str(input.notes)) value.notes = str(input.notes);

  return { valid: true, errors: [], fieldErrors: {}, value };
}

// ---------------------------------------------------------------------------
// Owner resolution
// ---------------------------------------------------------------------------

export interface OwnerResolution {
  ownerId: string | null;
  /** Where the id came from — logged so misconfiguration is diagnosable. */
  source: 'payload' | 'subdomain' | 'owner-email' | 'env' | 'sole-profile' | 'mock' | 'unresolved';
}

export interface ResolveOwnerOptions {
  db: any;
  isMock: boolean;
  explicitOwnerId?: unknown;
  subdomain?: string | null;
  customDomain?: string | null;
  ownerEmail?: string | null;
  /** Request deadline propagated by the Express timeout middleware. */
  deadlineAt?: number;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

/**
 * `bookings.owner_id` is NOT NULL, so a guest booking MUST be attached to a
 * salon owner. Tries, in order:
 *   1. a uuid supplied by the client,
 *   2. the profile that owns the salon subdomain the booking came from,
 *   3. the profile matching the owner email in the notification payload,
 *   4. DEFAULT_OWNER_ID / SUPABASE_DEMO_OWNER_ID from the environment,
 *   5. the only profile in the database (single-salon deployments).
 */
export async function resolveBookingOwnerId(opts: ResolveOwnerOptions): Promise<OwnerResolution> {
  const { db, isMock, explicitOwnerId, subdomain, customDomain, ownerEmail, deadlineAt, env = process.env } = opts;

  if (isUuidLike(explicitOwnerId)) return { ownerId: String(explicitOwnerId), source: 'payload' };

  const envOwner = [env.DEFAULT_OWNER_ID, env.SUPABASE_DEMO_OWNER_ID]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .find((v) => isUuidLike(v));

  if (isMock) {
    return envOwner ? { ownerId: envOwner, source: 'env' } : { ownerId: null, source: 'mock' };
  }

  // Every lookup below is time-boxed: a hanging profiles query must not eat the
  // whole serverless invocation budget (that is what turned a slow database
  // into an un-parseable platform 500 at checkout).
  for (const [column, value] of [
    ['subdomain', subdomain],
    ['custom_domain', customDomain],
  ] as const) {
    if (!value) continue;
    const { data, error } = await runDb(
      () => db.from('profiles').select('id').eq(column, value).maybeSingle(),
      { label: `owner lookup by ${column}`, timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
    );
    if (error) console.warn(`[Bookings] Owner lookup by ${column} failed:`, error.message || error);
    if (isUuidLike((data as any)?.id)) return { ownerId: (data as any).id, source: 'subdomain' };
  }

  if (ownerEmail && EMAIL_RE.test(ownerEmail)) {
    const { data, error } = await runDb(
      () => db.from('profiles').select('id').eq('email', ownerEmail).maybeSingle(),
      { label: 'owner lookup by email', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
    );
    if (error) console.warn('[Bookings] Owner lookup by email failed:', error.message || error);
    if (isUuidLike((data as any)?.id)) return { ownerId: (data as any).id, source: 'owner-email' };
  }

  if (envOwner) return { ownerId: envOwner, source: 'env' };

  {
    const { data, error } = await runDb(() => db.from('profiles').select('id').limit(2), {
      label: 'sole-owner lookup',
      timeoutMs: LOOKUP_DB_TIMEOUT_MS,
      deadlineAt,
    });
    if (error) console.warn('[Bookings] Sole-owner lookup failed:', error.message || error);
    if (Array.isArray(data) && data.length === 1 && isUuidLike((data as any)[0]?.id)) {
      return { ownerId: (data as any)[0].id, source: 'sole-profile' };
    }
  }

  return { ownerId: null, source: 'unresolved' };
}

// ---------------------------------------------------------------------------
// Postgres error → readable HTTP answer
// ---------------------------------------------------------------------------

export function describeDbError(error: any): { status: number; message: string } {
  const code = error?.code ? String(error.code) : '';
  const raw = error?.message || 'Unknown database error';
  // A transport-level fault (connection reset, DNS, gateway 502/503) arrives
  // without a Postgres code — e.g. `TypeError: fetch failed`. It is temporary
  // and retryable, so answer 503 with a human sentence rather than a raw 500.
  if (!code || code === 'db_unreachable' || code === 'db_timeout') {
    if (isTransientDbError(error) || code === 'db_unreachable') {
      return {
        status: 503,
        message:
          code === 'db_timeout'
            ? 'The booking database is not responding right now. Nothing was charged — please try again in a minute.'
            : `The booking database could not be reached (${raw}). Nothing was charged — please try again in a minute.`,
      };
    }
  }
  switch (code) {
    case 'db_timeout':
      // The database never answered inside our budget. 503 + Retry-After is the
      // honest answer; previously the request simply hung until the hosting
      // platform killed it and returned an un-parseable HTML 500.
      return {
        status: 503,
        message:
          'The booking database is not responding right now. Nothing was charged — please try again in a minute.',
      };
    case 'db_unreachable':
      return {
        status: 503,
        message: `The booking database could not be reached (${raw}). Nothing was charged — please try again in a minute.`,
      };
    case '23502':
      return { status: 422, message: `A required booking field was empty (${raw}).` };
    case '23503':
      return {
        status: 422,
        message: 'This salon is not linked to a valid owner account yet, so the booking could not be stored.',
      };
    case '23505':
      // unique_violation — e.g. a guest double-submitted a booking that shares a
      // unique token, or retried a paid booking. The existing booking stands, so
      // tell the client it is a duplicate (409) rather than a server fault (500).
      return {
        status: 409,
        message: 'A booking with these details already exists — it may have been created just now. Please refresh to see it, or retry once.',
      };
    case '23514':
      return { status: 400, message: `The booking details were rejected by a database rule (${raw}).` };
    case '22P02':
      return { status: 400, message: `One of the booking values has the wrong type (${raw}).` };
    case '42703':
      return { status: 500, message: `The bookings table is missing a column used by this build (${raw}).` };
    case 'PGRST204':
      // PostgREST schema cache doesn't know a column we sent (migration not
      // applied yet). The handler retries without it first; reaching here means
      // even the reduced row failed.
      return {
        status: 500,
        message: `The bookings table is out of date for this build (${raw}). Run the Supabase migrations.`,
      };
    case 'PGRST301':
    case '401':
      return {
        status: 500,
        message: 'The server could not authenticate with the database. Check SUPABASE_SERVICE_ROLE_KEY.',
      };
    case '42P01':
      return { status: 500, message: 'The bookings table does not exist — run the Supabase migrations.' };
    case '42501':
      return {
        status: 500,
        message: 'The server is not allowed to write bookings (Row Level Security). Set SUPABASE_SERVICE_ROLE_KEY.',
      };
    default:
      return { status: 500, message: raw };
  }
}

// ---------------------------------------------------------------------------
// Insert with schema-drift recovery
// ---------------------------------------------------------------------------

/** `Could not find the 'foo' column of 'bookings' in the schema cache` → `foo` */
export function missingColumnFromError(error: any): string | null {
  const message = String(error?.message || '');
  const code = String(error?.code || '');
  if (code !== 'PGRST204' && code !== '42703' && !/column/i.test(message)) return null;
  const quoted = message.match(/'([^']+)' column/) || message.match(/column "([^"]+)"/) || message.match(/column ([a-z_]+)/i);
  const column = quoted?.[1];
  if (!column) return null;
  // Never drop a column the booking cannot exist without.
  if (['customer_name', 'owner_id', 'booking_date', 'time_slot', 'service_name'].includes(column)) return null;
  return column;
}

/**
 * Insert the booking, and if the deployed database is a migration behind (it
 * does not know `booking_type` / `home_address` / `notes` yet), drop the
 * offending column and retry instead of failing the customer's checkout.
 * A booking without its optional metadata is infinitely better than a lost one.
 */
export async function insertBookingRow(
  db: any,
  row: Record<string, any>,
  requestId: string,
  deadlineAt?: number
): Promise<{ data: any; error: any; droppedColumns: string[] }> {
  const droppedColumns: string[] = [];
  let attemptRow = { ...row };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await runDb(() => db.from('bookings').insert([attemptRow]).select().single(), {
      label: `booking insert (${requestId})`,
      timeoutMs: DEFAULT_DB_TIMEOUT_MS,
      deadlineAt,
    });
    if (!error) return { data, error: null, droppedColumns };

    const missing = missingColumnFromError(error);
    if (missing && missing in attemptRow) {
      console.warn(
        `[Bookings] (${requestId}) Database does not know the "${missing}" column — retrying without it. ` +
          'Run the pending Supabase migrations to keep this data.'
      );
      const { [missing]: _dropped, ...rest } = attemptRow;
      attemptRow = rest;
      droppedColumns.push(missing);
      continue;
    }
    return { data: null, error, droppedColumns };
  }

  return {
    data: null,
    error: { code: 'schema_mismatch', message: 'The bookings table schema is too far out of date for this build.' },
    droppedColumns,
  };
}


/**
 * Look for a booking already stored under this idempotency key
 * (owner + payment_id). Any lookup failure is ignored: it is better to risk a
 * duplicate than to reject a real booking because a read timed out.
 */
async function findExistingBooking(
  deps: BookingCreateDeps,
  row: Record<string, any>,
  requestId: string,
  deadlineAt?: number
): Promise<any | null> {
  if (!row.payment_id) return null;
  if (deps.isMock) {
    const existing = deps.getMockBookings?.().find(
      (b: any) => b && b.payment_id === row.payment_id && (!row.owner_id || b.owner_id === row.owner_id)
    );
    return existing || null;
  }
  try {
    const { data, error } = await runDb(
      () => {
        let query = deps.db.from('bookings').select('*').eq('payment_id', row.payment_id);
        if (row.owner_id) query = query.eq('owner_id', row.owner_id);
        return query.maybeSingle();
      },
      {
        label: `duplicate check (${requestId})`,
        timeoutMs: LOOKUP_DB_TIMEOUT_MS,
        deadlineAt,
        retry: false,
      }
    );
    if (error) {
      console.warn(`[Bookings] (${requestId}) Duplicate check failed (continuing):`, error.message || error);
      return null;
    }
    return data || null;
  } catch (err: any) {
    console.warn(`[Bookings] (${requestId}) Duplicate check threw (continuing):`, err?.message || err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------

export interface BookingCreateDeps {
  /** Supabase client (service-role preferred). */
  db: any;
  isMock: boolean;
  /** Explicitly supplied by the entrypoint so missing server credentials fail
   * as a useful 503 instead of falling through to an RLS-shaped 500. */
  hasAdminClient?: boolean;
  addMockBooking: (row: any) => void;
  /** Mock-mode duplicate detection (optional; live mode queries the DB). */
  getMockBookings?: () => any[];
  addMockNotifications: (rows: any[]) => void;
  resolveOwnerEmail: (ownerId: string | null | undefined, deadlineAt?: number) => Promise<string>;
}

export function createBookingHandler(deps: BookingCreateDeps) {
  return async function handleBookingCreate(req: any, res: any): Promise<void> {
    const startedAt = Date.now();
    // Correlates the customer-visible error with the exact server log line.
    const requestId = newRequestId('bk');
    if (res.locals) res.locals.requestId = requestId;
    const deadlineAt = res.locals?.requestDeadlineAt;
    /** Every answer carries the id + a machine-readable code. */
    const fail = (status: number, code: string, error: string, extra: Record<string, any> = {}) => {
      if (responseAlreadyEnded(res)) return;
      res.status(status).json({ success: false, code, requestId, error, ...extra });
    };
    try {
      const body = readJsonBody(req);
      const { booking, notifications, payment } = body;

      // ---- 1. Validate BEFORE touching the DB or the payment gateway -------
      const validation = validateBookingPayload(booking);
      if (!validation.valid) {
        console.warn('[Bookings] Rejected invalid booking payload:', validation.errors.join(' | '), {
          received: safeSummary(booking),
        });
        return void fail(400, 'invalid_booking', validation.errors.join(' '), {
          fieldErrors: validation.fieldErrors,
        });
      }

      // A live guest booking must be written with the service-role client. Do
      // this check before verifying/accepting payment so a misconfigured
      // Vercel function never charges a customer and then discovers it cannot
      // persist the booking.
      if (!deps.isMock && deps.hasAdminClient === false) {
        return void fail(
          503,
          'supabase_not_configured',
          'The booking service is not connected to its database yet. Nothing was charged — please try again later.',
          { retryable: true }
        );
      }

      // ---- 2. Re-verify any claimed Razorpay payment server-side -----------
      // Never trust "I paid" from the browser: the signature is checked with
      // the key secret before the booking is marked as paid.
      let verifiedPaymentId: string | null = null;
      if (payment && typeof payment === 'object' && payment.razorpay_payment_id) {
        if (!isRazorpayConfigured()) {
          console.warn('[Bookings] Payment reference received but Razorpay is not configured — storing as unverified.');
        } else {
          const ok = verifyRazorpaySignature({
            orderId: String(payment.razorpay_order_id || ''),
            paymentId: String(payment.razorpay_payment_id || ''),
            signature: String(payment.razorpay_signature || ''),
          });
          if (!ok) {
            console.error('[Bookings] Razorpay signature verification FAILED', {
              order: payment.razorpay_order_id,
              payment: payment.razorpay_payment_id,
            });
            return void fail(
              400,
              'payment_unverified',
              'We could not verify your payment with Razorpay. The booking was not saved — no amount was captured.'
            );
          }
          verifiedPaymentId = String(payment.razorpay_payment_id);
          console.log(`[Bookings] Verified Razorpay payment ${verifiedPaymentId} (order ${payment.razorpay_order_id})`);
        }
      }

      // ---- 3. Resolve the (NOT NULL) owner_id ------------------------------
      const ownerEmailHint =
        (Array.isArray(notifications) && notifications.find((n: any) => n?.user_email)?.user_email) ||
        body.owner_email ||
        null;
      const tenantFromHost = tenantFromRequest(req);
      const subdomainHint =
        normalizeSubdomain(body.subdomain) || normalizeSubdomain(booking?.subdomain) || tenantFromHost.subdomain;
      const customDomainHint = tenantFromHost.customDomain;

      const { ownerId, source } = await resolveBookingOwnerId({
        db: deps.db,
        isMock: deps.isMock,
        explicitOwnerId: body.owner_id ?? booking?.owner_id,
        subdomain: subdomainHint,
        customDomain: customDomainHint,
        ownerEmail: ownerEmailHint,
        deadlineAt,
      });

      if (!deps.isMock && !ownerId) {
        console.error(
          '[Bookings] Could not resolve owner_id for a guest booking. ' +
            'bookings.owner_id is NOT NULL, so the insert would fail. ' +
            'Set DEFAULT_OWNER_ID in the environment, or publish the salon so its subdomain maps to a profile.',
          { subdomain: subdomainHint, customDomain: customDomainHint, ownerEmail: ownerEmailHint }
        );
        return void fail(
          422,
          'owner_unresolved',
          'This salon is not linked to an owner account yet, so bookings cannot be stored. Please contact the salon directly (or set DEFAULT_OWNER_ID on the server).'
        );
      }

      // Payment fields are untrusted browser input. A public caller must not be
      // able to set `payment_status: paid_deposit` or an advance amount without
      // a signature that this server verified with Razorpay. Keep the booking
      // reference for idempotency, but reset all unverified money claims.
      const paymentWasVerified = !!verifiedPaymentId;
      const bookingRow = sanitizeBookingRow({
        ...validation.value,
        owner_id: ownerId,
        advance_paid_amount: paymentWasVerified ? validation.value.advance_paid_amount : 0,
        payment_id: verifiedPaymentId || validation.value.payment_id,
        payment_status: paymentWasVerified ? 'paid_deposit' : 'pending',
      });

      const notifRows = Array.isArray(notifications)
        ? notifications
            .filter((n: any) => n && typeof n === 'object')
            .map((n: any) => ({
              user_email: n.user_email || null,
              title: n.title || null,
              message: n.message || null,
            }))
        : [];

      let bookingData: any;

      // ---- 4. Idempotency --------------------------------------------------
      // The browser retries a failed save and `runDb` retries a transient
      // fault, so the same booking can legitimately be POSTed twice (classic
      // case: the row WAS written but the answer was lost to a timeout).
      // `payment_id` carries the booking reference (NX-…) or the Razorpay
      // payment id, both unique per attempt, so it is a natural idempotency
      // key. If a row already exists, return it instead of double-booking.
      if (bookingRow.payment_id) {
        const existing = await findExistingBooking(deps, bookingRow, requestId, deadlineAt);
        if (existing) {
          console.log(
            `[Bookings] (${requestId}) Duplicate submission for payment_id ${bookingRow.payment_id} — returning the existing booking ${existing.id}.`
          );
          if (responseAlreadyEnded(res)) return;
          return void res.json({
            success: true,
            requestId,
            duplicate: true,
            data: existing,
            paymentVerified: !!verifiedPaymentId,
          });
        }
      }

      // ---- 5. Persist ------------------------------------------------------
      if (deps.isMock) {
        bookingData = {
          ...bookingRow,
          id: `mock-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          created_at: new Date().toISOString(),
        };
        deps.addMockBooking(bookingData);
        deps.addMockNotifications(
          notifRows.map((n: any) => ({
            ...n,
            id: `mock-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
            created_at: new Date().toISOString(),
          }))
        );
        console.log(`[Bookings] (mock mode) stored booking ${bookingData.id} for ${bookingRow.customer_name}`);
      } else {
        // Time-boxed insert with schema-drift recovery. `runDb` inside
        // `insertBookingRow` retries transient network faults once and turns a
        // hung database into a catchable `db_timeout` instead of letting the
        // hosting platform kill the invocation with an un-parseable HTML 500.
        const { data: dbData, error: bookingError, droppedColumns } = await insertBookingRow(
          deps.db,
          bookingRow,
          requestId,
          deadlineAt
        );

        if (bookingError) {
          // Log EVERYTHING server-side: code, details, hint and the row we
          // tried to insert. This is what was missing when the checkout began
          // answering an opaque 500.
          console.error(`[Bookings] (${requestId}) Insert failed`, {
            code: bookingError.code,
            message: bookingError.message,
            details: bookingError.details,
            hint: bookingError.hint,
            ownerSource: source,
            row: safeSummary(bookingRow),
          });
          const { status, message } = describeDbError(bookingError);
          return void fail(status, bookingError.code || 'db_error', message, {
            ...(status === 503 ? { retryable: true } : {}),
          });
        }

        bookingData = dbData;
        console.log(
          `[Bookings] (${requestId}) Stored booking ${bookingData?.id} (owner ${bookingRow.owner_id} via ${source}) in ${Date.now() - startedAt}ms` +
            (droppedColumns.length ? ` — dropped unknown columns: ${droppedColumns.join(', ')}` : '')
        );

        if (notifRows.length > 0) {
          // Notifications are best-effort: never fail (or delay) a paid booking
          // because the owner's bell could not be updated.
          try {
            const fallbackOwnerEmail = await deps.resolveOwnerEmail(bookingData?.owner_id, deadlineAt);
            const withOwnerEmail = notifRows.map((n: any) => ({
              ...n,
              user_email: n.user_email || fallbackOwnerEmail,
            }));
            const { error: notifError } = await runDb(
              () => deps.db.from('in_app_notifications').insert(withOwnerEmail),
              { label: `booking notification (${requestId})`, timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt, retry: false }
            );
            if (notifError) console.warn('[Bookings] Notification insert error:', notifError.message || notifError);
          } catch (notifErr: any) {
            console.warn('[Bookings] Notification insert threw:', notifErr?.message || notifErr);
          }
        }
      }

      if (responseAlreadyEnded(res)) {
        // The request-timeout guard already answered; don't double-send, but do
        // record that the booking actually landed.
        console.warn(`[Bookings] (${requestId}) Booking ${bookingData?.id} saved after the response was already sent.`);
        return;
      }
      res.json({
        success: true,
        requestId,
        data: bookingData,
        paymentVerified: !!verifiedPaymentId,
      });
    } catch (err: any) {
      // Absolute last resort — an unexpected fault. Log the stack so the real
      // cause is visible in the server logs instead of just "HTTP 500".
      console.error(
        `[Bookings] (${requestId}) Unhandled error while creating a booking:`,
        err?.stack || err?.message || err
      );
      fail(
        500,
        'unexpected_error',
        err?.message
          ? `The booking could not be saved (${err.message}).`
          : 'The booking could not be saved due to an unexpected server error.'
      );
    }
  };
}

function normalizeSubdomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

/**
 * A booking POSTed from a published salon site carries the tenant in the Host
 * header (`<subdomain>.nexora.in` or a custom domain). Use it to find the
 * owner when the client didn't send one.
 */
function tenantFromRequest(req: any): { subdomain: string | null; customDomain: string | null } {
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  if (typeof host !== 'string' || !host) return { subdomain: null, customDomain: null };
  try {
    const tenant = resolveTenantFromHost(host);
    return { subdomain: tenant?.subdomain || null, customDomain: tenant?.customDomain || null };
  } catch {
    return { subdomain: null, customDomain: null };
  }
}

/** Compact, PII-light snapshot of a payload for log lines. */function safeSummary(input: any): Record<string, any> {
  if (!input || typeof input !== 'object') return { value: String(input) };
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === 'customer_phone' || k === 'customer_email') {
      out[k] = typeof v === 'string' && v.length > 4 ? `${v.slice(0, 3)}***${v.slice(-2)}` : '***';
    } else if (typeof v === 'string' && v.length > 60) {
      out[k] = `${v.slice(0, 57)}…`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Read the JSON body regardless of who parsed it.
 *
 * `express.json()` gives us an object, but some serverless runtimes hand the
 * handler a raw string/Buffer (or pre-parse the stream themselves so
 * body-parser sees nothing). Treating that as "no body" produced a confusing
 * "Customer name is required" 400 on a payload that was actually complete.
 */
export function readJsonBody(req: any): Record<string, any> {
  const body = req?.body;
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) {
    try {
      const parsed = JSON.parse(body.toString('utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof body === 'object' ? body : {};
}
