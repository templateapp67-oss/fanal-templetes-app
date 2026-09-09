import { BackendError, ownerSalonIds, readDatabase, verifyBackendUser } from './backendContext.js';
import { findAuthorizedBooking, NORMALIZED_BOOKING_SELECT, presentBooking } from './normalizedBookingAccess.js';
// ============================================================================
// Owner check-in — POST /api/bookings/check-in
// ----------------------------------------------------------------------------
// The salon side of the customer salon pass: the receptionist pastes the
// customer's FANAL-… code (or picks the booking row) and this endpoint checks
// the customer in for today's visit and awards the visit bonuses the owner
// configured (birthday + referral, see LoyaltyManagement).
//
// Repo-native persistence decisions (no `user_qr_codes`, no `check_ins` table):
//   • the check-in event is appended to the booking's own `metadata.check_ins`;
//   • awarded bonus credits are snapshotted into `metadata.checkin_credits`, so
//     a repeated check-in of the same booking can never award twice;
//   • the actual points live in the existing ledger (`loyalty_point_transactions`
//     type 'bonus') and the existing wallet (`clients.points`), using the same
//     read/write conventions as the customer QR-payment flow in customerRoutes.
//
// Mock mode (no Supabase): the event + snapshot are persisted on the mock
// booking row so the demo dashboard shows the flow, but no points ledger exists
// to write — credits are reported as `planned`, never as fabricated `credited`.
// ============================================================================

import type { BookingRoutesDeps } from './bookingRoutes.js';
import {
  runDb,
  newRequestId,
  DEFAULT_DB_TIMEOUT_MS,
  LOOKUP_DB_TIMEOUT_MS,
  responseAlreadyEnded,
} from './dbGuard.js';
import { safeDatabaseError, sendSafeError } from './safeError.js';
import { isUuidLike } from './bookingOps.js';
import {
  normalizePassCode,
  passCodeUserId,
  checkinEligibility,
  isBirthdayVisit,
  planCheckInCredits,
} from '../src/lib/customer/checkin.js';
import { referralCodeFor, normalizeReferralCode } from '../src/lib/customer/schema.js';

type CheckinDeps = BookingRoutesDeps & { now?: () => number };

export interface CheckinCreditOutcome {
  kind: 'birthday' | 'referral';
  points: number;
  label: string;
  status: 'credited' | 'planned' | 'skipped';
  reason?: string;
}

/** Keep a booking's metadata as an object (JSONB rows can arrive as strings). */
function metadataObject(row: any): Record<string, any> {
  const raw = row?.metadata;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
    } catch {
      return {};
    }
  }
  return {};
}

function snapshots(row: any): { checkIns: Array<{ at?: string; via?: string }>; credits: Array<{ kind?: string; points?: number; date?: string }> } {
  const metadata = metadataObject(row);
  return {
    checkIns: Array.isArray(metadata.check_ins) ? metadata.check_ins.slice(0, 40) : [],
    credits: Array.isArray(metadata.checkin_credits) ? metadata.checkin_credits.slice(0, 40) : [],
  };
}

function checkedInToday(row: any, todayIso: string): boolean {
  return snapshots(row).checkIns.some((entry) => String(entry?.at ?? '').slice(0, 10) === todayIso);
}

function alreadyCredit(row: any, kind: string): boolean {
  return snapshots(row).credits.some((entry) => entry?.kind === kind);
}

function withEvent(row: any, event: { at: string; via: 'code' | 'booking' }, credited: CheckinCreditOutcome[]): Record<string, any> {
  const metadata = metadataObject(row);
  const before = snapshots(row);
  return {
    ...metadata,
    check_ins: [...before.checkIns, event],
    checkin_credits: [
      ...before.credits,
      ...credited
        .filter((credit) => credit.status === 'credited' || credit.status === 'planned')
        .map((credit) => ({ kind: credit.kind, points: credit.points, date: event.at.slice(0, 10) })),
    ],
  };
}

/** Wallet rows a customer owns at a salon — resolved the way customerRoutes does. */
async function resolveWallets(
  deps: CheckinDeps,
  ownerId: string,
  emails: string[],
  phones: string[],
  deadlineAt: number | undefined
): Promise<any[]> {
  const cleanedEmails = [...new Set(emails.map((value) => String(value ?? '').trim().toLowerCase()).filter(Boolean))];
  const cleanedPhones = [...new Set(phones.map((value) => String(value ?? '').replace(/\D/g, '')).filter((value) => value.length >= 10))];
  if (!cleanedEmails.length && !cleanedPhones.length) return [];

  const rows: any[] = [];
  const emailHits = new Set<string>();
  const attempts: Array<() => any> = [];
  if (cleanedEmails.length) {
    attempts.push(() => deps.db.from('clients').select('*').eq('owner_id', ownerId).in('email', cleanedEmails).limit(20));
  }
  if (cleanedPhones.length) {
    attempts.push(() => deps.db.from('clients').select('*').eq('owner_id', ownerId).in('phone', cleanedPhones).limit(20));
  }
  for (const attempt of attempts) {
    const result = await runDb(attempt, { label: 'check-in: wallet lookup', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt });
    if (result.error) {
      console.warn('[Check-in] wallet lookup failed (bonus may be skipped):', result.error.message || result.error);
      continue;
    }
    for (const entry of Array.isArray(result.data) ? result.data : []) {
      rows.push(entry);
      if (cleanedEmails.includes(String(entry?.email ?? '').trim().toLowerCase())) emailHits.add(String(entry.id));
    }
  }
  // A person can own two rows (one matched by email, one by phone). Prefer the
  // email match, drop duplicate ids.
  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const entry of rows) {
    if (seen.has(String(entry.id))) continue;
    seen.add(String(entry.id));
    deduped.push(entry);
  }
  return [...deduped].sort((a, b) => Number(emailHits.has(String(b.id))) - Number(emailHits.has(String(a.id))));
}

/**
 * Who owns a referral code at this salon. Codes are derived from account ids
 * (src/lib/customer/schema.ts) and a salon only ever knows the members that
 * booked it, so the referrer is found by scanning the salon's own booking rows
 * — never by trusting a client-supplied identity.
 */
async function resolveReferrer(
  deps: CheckinDeps,
  ownerId: string,
  code: string,
  currentUserId: string,
  deadlineAt: number | undefined
): Promise<{ userId: string; emails: string[]; phones: string[] } | null> {
  const result = await runDb(
    () => deps.db.from('bookings').select('user_id, customer_email, customer_phone').eq('owner_id', ownerId).limit(1500),
    { label: 'check-in: referrer scan', timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
  );
  if (result.error) {
    console.warn('[Check-in] referrer scan failed:', result.error.message || result.error);
    return null;
  }
  for (const booking of Array.isArray(result.data) ? result.data : []) {
    const userId = String(booking?.user_id ?? '').trim();
    if (!userId || userId === currentUserId) continue;
    if (referralCodeFor(userId) !== code) continue;
    return { userId, emails: [String(booking?.customer_email ?? '')], phones: [String(booking?.customer_phone ?? '')] };
  }
  return null;
}

async function findTarget(
  deps: CheckinDeps,
  bookingId: string,
  code: string,
  ownerId: string,
  todayIso: string,
  deadlineAt: number | undefined,
  requestId: string
): Promise<{ target: { row: any; via: 'code' | 'booking' } | null; status?: number; code?: string; error?: string }> {
  if (deps.isMock) {
    const rows = deps.getMockBookings();
    const bookings = Array.isArray(rows) ? rows : [];
    if (bookingId) {
      const row = bookings.find((entry) => String(entry?.id) === String(bookingId));
      if (!row) return { target: null, status: 404, code: 'not_found', error: 'Booking not found' };
      return { target: { row, via: 'booking' } };
    }
    const userId = passCodeUserId(code);
    if (!userId) return { target: null, status: 400, code: 'invalid_code', error: 'That does not look like a salon pass code.' };
    const row = bookings
      .filter((entry) => String(entry?.user_id ?? '') === userId)
      .sort(
        (a, b) =>
          String(a?.booking_date ?? '').localeCompare(String(b?.booking_date ?? '')) ||
          String(a?.time_slot ?? '').localeCompare(String(b?.time_slot ?? ''))
      )
      .find((entry) => checkinEligibility(entry, todayIso).ok);
    if (!row) return { target: null, status: 404, code: 'no_visit_today', error: 'No open booking for today matches this salon pass.' };
    return { target: { row, via: 'code' } };
  }

  if (!isUuidLike(ownerId)) {
    return { target: null, status: 400, code: 'owner_scope_required', error: 'Check-in needs your salon scope (owner_id/subdomain/email).' };
  }

  if (bookingId) {
    if (!isUuidLike(bookingId)) {
      return { target: null, status: 400, code: 'invalid_id', error: 'The booking id must be a valid UUID.' };
    }
    const result = await runDb(
      () => deps.db.from('bookings').select('*').eq('id', bookingId).eq('owner_id', ownerId).maybeSingle(),
      { label: `check-in: booking read (${requestId})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
    );
    if (result.error) {
      console.error(`[Check-in] (${requestId}) booking read failed:`, result.error);
      const safe = safeDatabaseError(result.error, 'The booking could not be loaded for check-in.');
      return { target: null, status: safe.status, code: safe.code, error: safe.message };
    }
    if (!result.data) return { target: null, status: 404, code: 'not_found', error: 'Booking not found at your salon' };
    return { target: { row: result.data, via: 'booking' } };
  }

  const userId = passCodeUserId(code);
  if (!userId) return { target: null, status: 400, code: 'invalid_code', error: 'That does not look like a salon pass code.' };
  const result = await runDb(
    () => deps.db.from('bookings').select('*').eq('owner_id', ownerId).eq('user_id', userId).limit(100),
    { label: `check-in: code lookup (${requestId})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
  );
  if (result.error) {
    console.error(`[Check-in] (${requestId}) code lookup failed:`, result.error);
    const safe = safeDatabaseError(result.error, 'The pass could not be looked up right now.');
    return { target: null, status: safe.status, code: safe.code, error: safe.message };
  }
  const rows = Array.isArray(result.data) ? result.data : [];
  const openToday = rows
    .filter((entry: any) => checkinEligibility(entry, todayIso).ok)
    .sort((a: any, b: any) => String(a?.time_slot ?? '').localeCompare(String(b?.time_slot ?? '')));
  const row = openToday[0];
  if (!row) {
    const hasTodayVisit = rows.some((entry: any) => String(entry?.booking_date ?? '') === todayIso);
    return hasTodayVisit
      ? { target: null, status: 409, code: 'not_checkinable', error: 'The customer has a visit booked today, but it is not open for check-in.' }
      : { target: null, status: 404, code: 'no_visit_today', error: 'No open booking for today matches this salon pass at your salon.' };
  }
  return { target: { row, via: 'code' } };
}

export function createBookingCheckinHandler(deps: CheckinDeps) {
  return async function checkInBooking(req: any, res: any): Promise<void> {
    const requestId = newRequestId('bkcin');
    const deadlineAt = res.locals?.requestDeadlineAt;
    try {
      if (!deps.isMock && deps.hasAdminClient === false) {
        if (!responseAlreadyEnded(res)) {
          res.status(503).json({
            success: false,
            code: 'supabase_not_configured',
            requestId,
            retryable: true,
            error: 'The check-in service is not connected to its database yet. Please try again later.',
          });
        }
        return;
      }

      if (!deps.isMock && deps.normalizedBookings) {
        const { user } = await verifyBackendUser(deps.db, req);
        const now = new Date(deps.now ? deps.now() : Date.now());
        const localDay = (row: any) => new Intl.DateTimeFormat('en-CA', { timeZone: row.salon?.timezone || 'Asia/Kolkata' }).format(now);
        let row: any;
        if (req.body?.booking_id) {
          row = (await findAuthorizedBooking(deps.db, user.id, String(req.body.booking_id), true)).row;
        } else {
          const customerId = passCodeUserId(req.body?.code);
          if (!isUuidLike(customerId || '')) throw new BackendError(400, 'A valid salon pass or booking id is required.');
          const salons = await ownerSalonIds(deps.db, user.id);
          if (!salons.length) throw new BackendError(403, 'No active salon membership was found.');
          const candidates = await readDatabase(() => deps.db.from('bookings').select(NORMALIZED_BOOKING_SELECT)
            .in('salon_id', salons).eq('customer_user_id', customerId)
            .gte('appointment_start', new Date(now.getTime()-86400000).toISOString())
            .lte('appointment_start', new Date(now.getTime()+86400000).toISOString()));
          const today = (candidates || []).filter((r: any) => presentBooking(r).booking_date === localDay(r) && ['pending','confirmed','checked_in'].includes(r.status));
          if (today.length !== 1) throw new BackendError(409, today.length ? 'Multiple visits found. Select the booking to check in.' : 'No open visit was found for today.');
          row = today[0];
        }
        if (presentBooking(row).booking_date !== localDay(row)) throw new BackendError(409, 'Check-in is available on the appointment date.');
        const duplicate = row.status === 'checked_in';
        if (!duplicate) {
          if (!['pending','confirmed'].includes(row.status)) throw new BackendError(409, 'This booking is not open for check-in.');
          const updated = await readDatabase(() => deps.db.from('bookings').update({ status: 'checked_in', checked_in_at: now.toISOString(), updated_at: now.toISOString() })
            .eq('id', row.id).eq('salon_id', row.salon_id).eq('status', row.status).select('id').maybeSingle());
          if (!updated) throw new BackendError(409, 'Booking changed. Refresh and try again.');
          row = { ...row, status: 'checked_in', checked_in_at: now.toISOString() };
        }
        return void res.json({ success: true, requestId, duplicate, data: { booking: presentBooking(row, true), credits: [] },
          notice: 'Check-in recorded. Automatic birthday and referral credits are not connected to this booking service yet.' });
      }

      const nowMs = deps.now ? deps.now() : Date.now();
      const todayIso = new Date(nowMs).toISOString().slice(0, 10);
      const eventAt = new Date(nowMs).toISOString();
      const body = req?.body ?? {};
      const bookingId = String(body.booking_id ?? '').trim();
      const rawCode = String(body.code ?? '').trim();
      const code = normalizePassCode(rawCode);
      if (rawCode && !code) {
        if (responseAlreadyEnded(res)) return;
        return void res.status(400).json({
          success: false,
          code: 'invalid_code',
          requestId,
          error: 'That does not look like a salon pass code.',
        });
      }
      if (!bookingId && !code) {
        if (responseAlreadyEnded(res)) return;
        return void res.status(400).json({
          success: false,
          code: 'invalid_request',
          requestId,
          error: 'Provide the booking id or the customer salon-pass code.',
        });
      }
      const via: 'code' | 'booking' = code && !bookingId ? 'code' : 'booking';

      // Same scope resolution the booking list/update handlers use.
      let ownerId = '';
      const queryOwnerId = String(req.query?.owner_id ?? '').trim();
      if (isUuidLike(queryOwnerId)) {
        ownerId = queryOwnerId;
      } else if (!deps.isMock) {
        const subdomain = String(req.query?.subdomain ?? '').trim().toLowerCase();
        if (subdomain) {
          const subResult = await runDb(
            () => deps.db.from('profiles').select('id').eq('subdomain', subdomain).maybeSingle(),
            { label: 'check-in: scope by subdomain', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
          );
          if (!subResult.error && isUuidLike((subResult.data as any)?.id)) ownerId = (subResult.data as any).id;
        }
        if (!ownerId) {
          const email = String(req.query?.email ?? '').trim();
          if (email) {
            const emailResult = await runDb(
              () => deps.db.from('profiles').select('id').eq('email', email).maybeSingle(),
              { label: 'check-in: scope by email', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
            );
            if (!emailResult.error && isUuidLike((emailResult.data as any)?.id)) ownerId = (emailResult.data as any).id;
          }
        }
      }

      const found = await findTarget(deps, bookingId, code, ownerId, todayIso, deadlineAt, requestId);
      if (!found.target) {
        if (responseAlreadyEnded(res)) return;
        return void res.status(found.status || 400).json({
          success: false,
          code: found.code || 'invalid_request',
          requestId,
          error: found.error || 'The booking could not be found.',
        });
      }
      const { row, via: viaUsed } = found.target;

      const eligibility = checkinEligibility(row, todayIso);
      if (!eligibility.ok) {
        if (responseAlreadyEnded(res)) return;
        return void res.status(409).json({
          success: false,
          code: 'not_checkinable',
          requestId,
          error: eligibility.reason || 'This booking is not open for check-in.',
        });
      }

      const duplicate = checkedInToday(row, todayIso);
      const credits: CheckinCreditOutcome[] = [];
      const ownerIdOfRow = String(row.owner_id ?? ownerId ?? '');
      const notice: string[] = [];

      // ================= Mock mode: no ledger exists ========================
      if (deps.isMock) {
        if (!duplicate) {
          const metadata = metadataObject(row);
          const dob = String(row?.customer_date_of_birth || metadata?.customer_date_of_birth || '').trim();
          const planned = planCheckInCredits({
            config: {},
            isBirthdayVisit: dob ? isBirthdayVisit(todayIso, dob) : false,
            birthdayNotYetCredited: !alreadyCredit(row, 'birthday'),
            hasReferralCode: !!normalizeReferralCode(metadata.referral_code),
            referrerWalletResolved: false, // demo has no wallet rows to resolve
            referralNotYetCredited: true,
          });
          // The demo store cannot hold DOB/profile facts for real customers, so
          // only a DOB that the demo flow placed on the row itself fires here.
          const outcomes: CheckinCreditOutcome[] = planned
            .filter((credit) => credit.kind === 'birthday')
            .map((credit) => ({ ...credit, status: 'planned' as const, points: credit.points }));
          const next = withEvent(row, { at: eventAt, via: viaUsed }, outcomes);
          const rows = deps.getMockBookings();
          const idx = Array.isArray(rows) ? rows.findIndex((entry) => String(entry?.id) === String(row.id)) : -1;
          if (idx !== -1) rows[idx] = { ...rows[idx], metadata: next };
          credits.push(...outcomes);
          if (outcomes.length) {
            notice.push('Demo mode: the check-in is recorded, but no points ledger exists without Supabase — the birthday bonus is planned, not credited.');
          }
        } else {
          notice.push('This customer was already checked in today — nothing was changed.');
        }
        if (responseAlreadyEnded(res)) return;
        return void res.json({
          success: true,
          requestId,
          mode: 'mock',
          duplicate,
          data: {
            booking: duplicate ? row : { ...row, metadata: withEvent(row, { at: eventAt, via: viaUsed }, credits.filter((c) => c.status === 'planned')) },
            checkedInAt: eventAt,
            credits,
          },
          notice: notice.length ? notice.join(' ') : undefined,
        });
      }

      // ================= Live: resolve the reward facts ======================
      let birthday = false;
      if (isUuidLike(String(row?.user_id ?? ''))) {
        const profileResult = await runDb(
          () => deps.db.from('profiles').select('date_of_birth').eq('id', row.user_id).maybeSingle(),
          { label: 'check-in: customer profile', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
        );
        if (!profileResult.error && profileResult.data) {
          birthday = isBirthdayVisit(todayIso, profileResult.data.date_of_birth);
        }
      }
      const configResult = await runDb(
        () => deps.db.from('loyalty_config').select('*').eq('owner_id', ownerIdOfRow).maybeSingle(),
        { label: 'check-in: loyalty config', timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt }
      );
      const config = configResult.error ? null : (configResult.data as any) || null;

      const customerWallets = await resolveWallets(deps, ownerIdOfRow, [row?.customer_email], [row?.customer_phone], deadlineAt);
      const customerWallet = customerWallets[0] || null;

      const metadata = metadataObject(row);
      const referralCode = normalizeReferralCode(metadata.referral_code);
      const currentUserId = String(row?.user_id ?? '').trim();
      let referrerWallet: any = null;
      if (referralCode) {
        if (currentUserId && referralCodeFor(currentUserId) === referralCode) {
          credits.push({ kind: 'referral', points: 0, label: 'Referral bonus', status: 'skipped', reason: "The booking carries the customer's own referral code." });
        } else {
          const referrer = await resolveReferrer(deps, ownerIdOfRow, referralCode, currentUserId, deadlineAt);
          if (referrer) {
            const wallets = await resolveWallets(deps, ownerIdOfRow, referrer.emails, referrer.phones, deadlineAt);
            referrerWallet = wallets[0] || null;
          }
        }
      }

      const programPaused = config?.program_enabled === false;
      // Every successfully applied credit, so a later failure can compensate
      // both the ledger row AND the wallet balance (a retry must be a no-op).
      const applied: Array<{ txId: string; clientId: string; points: number; walletPointsAfter: number; walletLifetimeAfter: number }> = [];
      const compensate = async () => {
        for (const entry of applied) {
          const zero = await runDb(
            () => deps.db.from('loyalty_point_transactions').update({ points_change: 0 }).eq('id', entry.txId),
            { label: `check-in: rollback ledger (${requestId})`, timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt, retry: false }
          );
          if (zero.error) console.error(`[Check-in] (${requestId}) ROLLBACK FAILED for ledger ${entry.txId}:`, zero.error);
          // Restore exactly what this request added (the update above returned
          // the wallet's new totals, so the subtraction is ours, not the client's).
          const restore = await runDb(
            () =>
              deps.db
                .from('clients')
                .update({
                  points: Math.max(0, entry.walletPointsAfter - entry.points),
                  lifetime_points: Math.max(0, entry.walletLifetimeAfter - entry.points),
                })
                .eq('id', entry.clientId),
            { label: `check-in: rollback wallet (${requestId})`, timeoutMs: LOOKUP_DB_TIMEOUT_MS, deadlineAt, retry: false }
          );
          if (restore.error) console.error(`[Check-in] (${requestId}) ROLLBACK FAILED for wallet ${entry.clientId}:`, restore.error);
        }
      };

      if (!duplicate) {
        const plan = programPaused
          ? []
          : planCheckInCredits({
              config: config || {},
              isBirthdayVisit: birthday,
              birthdayNotYetCredited: !alreadyCredit(row, 'birthday'),
              hasReferralCode: !!referralCode,
              referrerWalletResolved: !!referrerWallet,
              referralNotYetCredited: !alreadyCredit(row, 'referral'),
            });

        if (programPaused) {
          credits.push(
            { kind: 'birthday', points: 0, label: 'Birthday bonus', status: 'skipped', reason: 'The rewards program is paused at this salon.' },
            ...(referralCode
              ? [{ kind: 'referral' as const, points: 0, label: 'Referral bonus', status: 'skipped' as const, reason: 'The rewards program is paused at this salon.' }]
              : [])
          );
        }

        for (const credit of plan) {
          const wallet = credit.kind === 'birthday' ? customerWallet : referrerWallet;
          const walletPresent = credit.kind === 'birthday' ? !!customerWallet : !!referrerWallet;
          if (!walletPresent) {
            credits.push({
              kind: credit.kind,
              points: 0,
              label: credit.label,
              status: 'skipped',
              reason:
                credit.kind === 'birthday'
                  ? 'The customer has no rewards wallet at your salon yet.'
                  : 'No rewards wallet found for the member who referred this booking.',
            });
            continue;
          }

          // Ledger row first (mirrors the QR-payment write path), wallet credit
          // second, and a rollback to zero if the wallet write fails.
          const description = `${credit.label} — visit on ${todayIso}${row.customer_name ? ` (${row.customer_name})` : ''}`.slice(0, 200);
          const txResult = await runDb(
            () =>
              deps.db
                .from('loyalty_point_transactions')
                .insert({ owner_id: ownerIdOfRow, client_id: wallet.id, date: todayIso, points_change: credit.points, description, type: 'bonus' })
                .select()
                .single(),
            { label: `check-in: ${credit.kind} ledger row`, timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
          );
          if (txResult.error || !txResult.data) {
            console.error(`[Check-in] (${requestId}) ${credit.kind} ledger insert failed:`, txResult.error);
            await compensate();
            if (responseAlreadyEnded(res)) return;
            return void res.status(503).json({
              success: false,
              code: 'credit_failed',
              requestId,
              retryable: true,
              error: 'Check-in could not record its bonuses. Nothing was credited — please try again.',
            });
          }
          const txId = String(txResult.data.id);
          const balanceResult = await runDb(
            () =>
              deps.db
                .from('clients')
                .update({
                  points: Number(wallet?.points ?? 0) + credit.points,
                  lifetime_points: Number(wallet?.lifetime_points ?? wallet?.points ?? 0) + credit.points,
                  last_visit: todayIso,
                  updated_at: new Date(nowMs).toISOString(),
                })
                .eq('id', wallet.id)
                .select()
                .single(),
            { label: `check-in: ${credit.kind} wallet credit`, timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
          );
          if (balanceResult.error || !balanceResult.data) {
            console.error(`[Check-in] (${requestId}) ${credit.kind} wallet credit failed:`, balanceResult.error);
            await compensate();
            if (responseAlreadyEnded(res)) return;
            return void res.status(503).json({
              success: false,
              code: 'credit_failed',
              requestId,
              retryable: true,
              error: 'Check-in could not record its bonuses. Nothing was credited — please try again.',
            });
          }
          applied.push({
            txId,
            clientId: String(wallet.id),
            points: credit.points,
            walletPointsAfter: Number(balanceResult.data?.points ?? 0),
            walletLifetimeAfter: Number(balanceResult.data?.lifetime_points ?? balanceResult.data?.points ?? 0),
          });
          credits.push({ ...credit, status: 'credited' });
        }
      }

      // Persist the event + credit snapshot on the booking row (the only write
      // that makes a retry a no-op — so it happens last, after every ledger row
      // is safely in place).
      if (!duplicate) {
        const next = withEvent(row, { at: eventAt, via: viaUsed }, credits);
        const metaResult = await runDb(
          () => deps.db.from('bookings').update({ metadata: next }).eq('id', row.id).eq('owner_id', ownerIdOfRow).select().maybeSingle(),
          { label: `check-in: booking metadata (${requestId})`, timeoutMs: DEFAULT_DB_TIMEOUT_MS, deadlineAt }
        );
        if (metaResult.error) {
          console.error(`[Check-in] (${requestId}) metadata write failed:`, metaResult.error);
          await compensate();
          if (responseAlreadyEnded(res)) return;
          return void res.status(503).json({
            success: false,
            code: 'credit_failed',
            requestId,
            retryable: true,
            error: 'The check-in event could not be saved. Points were rolled back — please try again.',
          });
        }
      }

      if (responseAlreadyEnded(res)) return;
      return void res.json({
        success: true,
        requestId,
        mode: 'live',
        duplicate,
        data: {
          booking: { ...row, metadata: duplicate ? metadataObject(row) : withEvent(row, { at: eventAt, via: viaUsed }, credits) },
          checkedInAt: eventAt,
          credits,
        },
        notice: duplicate ? 'This customer was already checked in today — nothing was changed.' : undefined,
      });
    } catch (err: any) {
      console.error(`[Bookings] (${requestId}) Check-in threw:`, err?.stack || err);
      if (responseAlreadyEnded(res)) return;
      if (err instanceof BackendError) return void res.status(err.status).json({ success: false, requestId, code: err.code, error: err.message });
      sendSafeError(res, err, { requestId, context: 'database', fallbackMessage: 'Check-in failed.' });
    }
  };
}
