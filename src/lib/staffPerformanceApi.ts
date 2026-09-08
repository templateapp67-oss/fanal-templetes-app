import { supabase, isMockSupabase } from './supabaseClient';
import {
  STAFF_PERFORMANCE_ERROR_COPY,
  STAFF_RPC_TIMEOUT_MS,
  classifyStaffPerformanceError,
  csvFromExportRows,
  normalizeDailyRow,
  normalizeExportRow,
  normalizeLast7Row,
  normalizeSummaryRow,
  type StaffDailyPerformanceRow,
  type StaffDetailPayload,
  type StaffExportRow,
  type StaffLast7DaysRow,
  type StaffPerformanceError,
  type StaffPerformanceSummaryRow,
  type StaffRecentAppointment,
  type StaffServiceSummary,
  asFiniteNumber,
} from './staffPerformance';

async function withRpcTimeout(
  work: any,
  ms = STAFF_RPC_TIMEOUT_MS
): Promise<{ data: any; error: any }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject({ code: '57014', message: 'Staff performance query timed out' });
    }, ms);
  });
  try {
    return (await Promise.race([Promise.resolve(work), timeout])) as { data: any; error: any };
  } catch (err) {
    return { data: null, error: err };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface OwnerSalonContext {
  salonId: string;
  userId: string;
}

export type RpcOk<T> = { ok: true } & T;
export type RpcFail = { ok: false; error: StaffPerformanceError };
export type RpcResult<T> = RpcOk<T> | RpcFail;

export function isRpcFail(result: { ok: boolean }): result is RpcFail {
  return result.ok === false;
}

function rpcError(err: unknown): StaffPerformanceError {
  return classifyStaffPerformanceError(err);
}

/**
 * Resolve the owner salon from the live session.
 * salon_id is profiles.id = auth.uid(). Never taken from the URL or a prop.
 */
export async function resolveOwnerSalon(): Promise<
  { ok: true; context: OwnerSalonContext } | { ok: false; error: StaffPerformanceError }
> {
  if (isMockSupabase) {
    return { ok: false, error: { code: 'rpc_unavailable', message: STAFF_PERFORMANCE_ERROR_COPY.rpc_unavailable, retryable: true } };
  }

  const { data: sessionData, error: sessionError } = await withRpcTimeout(supabase.auth.getSession());
  if (sessionError) {
    return { ok: false, error: rpcError(sessionError) };
  }
  const user = sessionData?.session?.user;
  if (!user?.id) {
    return {
      ok: false,
      error: { code: 'session_expired', message: STAFF_PERFORMANCE_ERROR_COPY.session_expired, retryable: false },
    };
  }

  const { data: profile, error: profileError } = await withRpcTimeout(
    supabase.from('profiles').select('id').eq('id', user.id).maybeSingle()
  );

  if (profileError) {
    const classified = rpcError(profileError);
    if (classified.code === 'owner_access_denied') {
      return { ok: false, error: classified };
    }
    return { ok: false, error: classified.code === 'unknown' ? { code: 'database_error', message: STAFF_PERFORMANCE_ERROR_COPY.database_error, retryable: true } : classified };
  }
  if (!profile?.id) {
    return {
      ok: false,
      error: { code: 'salon_not_found', message: STAFF_PERFORMANCE_ERROR_COPY.salon_not_found, retryable: false },
    };
  }

  const { data: isOwner, error: ownerError } = await withRpcTimeout(
    supabase.rpc('is_staff_dashboard_owner', {
      target_salon_id: profile.id,
    })
  );
  if (ownerError) {
    return { ok: false, error: rpcError(ownerError) };
  }
  if (isOwner !== true) {
    return {
      ok: false,
      error: { code: 'owner_access_denied', message: STAFF_PERFORMANCE_ERROR_COPY.owner_access_denied, retryable: false },
    };
  }

  return { ok: true, context: { salonId: String(profile.id), userId: user.id } };
}

export async function fetchStaffPerformance(
  salonId: string,
  from: string,
  to: string,
  staffId?: string | null
): Promise<{ ok: true; rows: StaffPerformanceSummaryRow[] } | { ok: false; error: StaffPerformanceError }> {
  const { data, error } = await withRpcTimeout(
    supabase.rpc('get_owner_staff_performance', {
      target_salon_id: salonId,
      from_date: from,
      to_date: to,
      target_staff_id: staffId || null,
    })
  );
  if (error) return { ok: false, error: rpcError(error) };
  const rows = Array.isArray(data) ? data.map((row) => normalizeSummaryRow(row as Record<string, unknown>)) : [];
  return { ok: true, rows };
}

export async function fetchStaffLast7Days(
  salonId: string
): Promise<{ ok: true; rows: StaffLast7DaysRow[] } | { ok: false; error: StaffPerformanceError }> {
  const { data, error } = await withRpcTimeout(
    supabase.rpc('get_owner_staff_last_7_days', {
      target_salon_id: salonId,
    })
  );
  if (error) return { ok: false, error: rpcError(error) };
  const rows = Array.isArray(data) ? data.map((row) => normalizeLast7Row(row as Record<string, unknown>)) : [];
  return { ok: true, rows };
}

export async function fetchStaffDailyPerformance(
  salonId: string,
  from: string,
  to: string,
  staffId?: string | null
): Promise<{ ok: true; rows: StaffDailyPerformanceRow[] } | { ok: false; error: StaffPerformanceError }> {
  const { data, error } = await withRpcTimeout(
    supabase.rpc('get_owner_staff_daily_performance', {
      target_salon_id: salonId,
      from_date: from,
      to_date: to,
      target_staff_id: staffId || null,
    })
  );
  if (error) return { ok: false, error: rpcError(error) };
  const rows = Array.isArray(data) ? data.map((row) => normalizeDailyRow(row as Record<string, unknown>)) : [];
  return { ok: true, rows };
}

function asService(row: Record<string, unknown>): StaffServiceSummary {
  return {
    service_id: row.service_id ? String(row.service_id) : undefined,
    service_name: String(row.service_name || 'Unknown service'),
    bookings: asFiniteNumber(row.bookings),
    completed_bookings: asFiniteNumber(row.completed_bookings),
    gross_amount: asFiniteNumber(row.gross_amount),
  };
}

function asAppointment(row: Record<string, unknown>): StaffRecentAppointment {
  return {
    booking_id: String(row.booking_id || ''),
    performance_date: String(row.performance_date || '').slice(0, 10),
    time_slot: row.time_slot == null ? null : String(row.time_slot),
    status: String(row.status || ''),
    payment_status: String(row.payment_status || ''),
    service_name: row.service_name == null ? null : String(row.service_name),
    customer_name: row.customer_name == null ? null : String(row.customer_name),
    gross_amount: asFiniteNumber(row.gross_amount),
    paid_amount: asFiniteNumber(row.paid_amount),
  };
}

export function parseStaffDetail(payload: unknown): StaffDetailPayload {
  const raw = (payload && typeof payload === 'object' ? payload : {}) as Record<string, any>;
  const profile = raw.staff_profile || {};
  const bookings = raw.booking_status_summary || {};
  const payment = raw.payment_summary || {};
  const discount = raw.discount_summary || {};
  const commission = raw.commission_calculation || {};
  const salon = raw.salon_share || {};
  const review = raw.review_summary || {};
  const dist = raw.rating_distribution || {};
  return {
    staff_profile: {
      staff_id: String(profile.staff_id || ''),
      staff_name: String(profile.staff_name || 'Staff'),
      staff_photo: profile.staff_photo ?? null,
      staff_role: String(profile.staff_role || ''),
    },
    booking_status_summary: {
      total_bookings: asFiniteNumber(bookings.total_bookings),
      pending_bookings: asFiniteNumber(bookings.pending_bookings),
      confirmed_bookings: asFiniteNumber(bookings.confirmed_bookings),
      completed_bookings: asFiniteNumber(bookings.completed_bookings),
      cancelled_bookings: asFiniteNumber(bookings.cancelled_bookings),
    },
    payment_summary: {
      gross_amount: asFiniteNumber(payment.gross_amount),
      paid_amount: asFiniteNumber(payment.paid_amount),
      outstanding_amount: asFiniteNumber(payment.outstanding_amount),
    },
    discount_summary: {
      discount_amount: asFiniteNumber(discount.discount_amount),
      net_amount: asFiniteNumber(discount.net_amount),
    },
    commission_calculation: {
      commission_rate: asFiniteNumber(commission.commission_rate),
      commission_amount: asFiniteNumber(commission.commission_amount),
    },
    salon_share: {
      salon_amount: asFiniteNumber(salon.salon_amount),
    },
    review_summary: {
      review_count: asFiniteNumber(review.review_count),
      average_rating: asFiniteNumber(review.average_rating),
    },
    rating_distribution: {
      five_star_reviews: asFiniteNumber(dist.five_star_reviews),
      four_star_reviews: asFiniteNumber(dist.four_star_reviews),
      three_star_reviews: asFiniteNumber(dist.three_star_reviews),
      two_star_reviews: asFiniteNumber(dist.two_star_reviews),
      one_star_reviews: asFiniteNumber(dist.one_star_reviews),
    },
    service_wise_booking_summary: Array.isArray(raw.service_wise_booking_summary)
      ? raw.service_wise_booking_summary.map((row: Record<string, unknown>) => asService(row))
      : [],
    top_services: Array.isArray(raw.top_services)
      ? raw.top_services.map((row: Record<string, unknown>) => asService(row))
      : [],
    recent_appointments: Array.isArray(raw.recent_appointments)
      ? raw.recent_appointments.map((row: Record<string, unknown>) => asAppointment(row))
      : [],
    last_7_days: raw.last_7_days && typeof raw.last_7_days === 'object' ? raw.last_7_days : {},
  };
}

export async function fetchStaffDetail(
  salonId: string,
  staffId: string,
  from: string,
  to: string
): Promise<{ ok: true; detail: StaffDetailPayload } | { ok: false; error: StaffPerformanceError }> {
  const { data, error } = await withRpcTimeout(
    supabase.rpc('get_owner_staff_detail', {
      target_salon_id: salonId,
      target_staff_id: staffId,
      from_date: from,
      to_date: to,
    })
  );
  if (error) return { ok: false, error: rpcError(error) };
  return { ok: true, detail: parseStaffDetail(data) };
}

export async function fetchStaffExport(
  salonId: string,
  from: string,
  to: string,
  staffId?: string | null
): Promise<{ ok: true; rows: StaffExportRow[]; csv: string } | { ok: false; error: StaffPerformanceError }> {
  const { data, error } = await withRpcTimeout(
    supabase.rpc('get_owner_staff_export', {
      target_salon_id: salonId,
      from_date: from,
      to_date: to,
      target_staff_id: staffId || null,
    })
  );
  if (error) {
    const classified = rpcError(error);
    return {
      ok: false,
      error: { ...classified, code: classified.code === 'unknown' ? 'export_failed' : classified.code, message: STAFF_PERFORMANCE_ERROR_COPY.export_failed },
    };
  }
  const rows = Array.isArray(data) ? data.map((row) => normalizeExportRow(row as Record<string, unknown>)) : [];
  return { ok: true, rows, csv: csvFromExportRows(rows) };
}

export async function refreshStaffDaily(
  salonId: string,
  targetDate?: string
): Promise<{ ok: true; rows: number } | { ok: false; error: StaffPerformanceError }> {
  const args: Record<string, unknown> = { target_salon_id: salonId };
  if (targetDate) args.target_date = targetDate;
  const { data, error } = await supabase.rpc('refresh_staff_performance_daily', args);
  if (error) return { ok: false, error: rpcError(error) };
  return { ok: true, rows: asFiniteNumber(data) };
}

export function triggerCsvDownload(filename: string, csv: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
