import { supabase, isMockSupabase } from './supabaseClient';
import {
  STAFF_PERFORMANCE_ERROR_COPY,
  STAFF_RPC_TIMEOUT_MS,
  classifyStaffPerformanceError,
  type StaffPerformanceError,
} from './staffPerformance';
import {
  STAFF_COMMISSION_ERROR_COPY,
  csvFromPayoutHistory,
  csvFromPayoutSummary,
  normalizePayoutHistoryRow,
  normalizePayoutSummaryRow,
  normalizeSettingRow,
  type StaffCommissionSettingInput,
  type StaffCommissionSettingRow,
  type StaffPayoutHistoryRow,
  type StaffPayoutSummaryRow,
} from './staffCommission';
import { resolveOwnerSalon, type OwnerSalonContext } from './staffPerformanceApi';

export type { OwnerSalonContext };

async function withRpcTimeout(
  work: any,
  ms = STAFF_RPC_TIMEOUT_MS
): Promise<{ data: any; error: any }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject({ code: '57014', message: 'Staff commission query timed out' });
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

export type RpcOk<T> = { ok: true } & T;
export type RpcFail = { ok: false; error: StaffPerformanceError };
export type RpcResult<T> = RpcOk<T> | RpcFail;

export function isRpcFail(result: { ok: boolean }): result is RpcFail {
  return result.ok === false;
}

function rpcError(err: unknown): StaffPerformanceError {
  const classified = classifyStaffPerformanceError(err);
  if (classified.code === 'rpc_unavailable') {
    return { ...classified, message: STAFF_COMMISSION_ERROR_COPY.rpc_unavailable };
  }
  if (classified.code === 'owner_access_denied') {
    return { ...classified, message: STAFF_COMMISSION_ERROR_COPY.owner_access_denied };
  }
  if (classified.code === 'session_expired') {
    return { ...classified, message: STAFF_COMMISSION_ERROR_COPY.session_expired };
  }
  return classified;
}

function failFromMessage(err: unknown): StaffPerformanceError {
  const classified = rpcError(err);
  const raw = err as { message?: string } | null;
  if (raw?.message && classified.code === 'unknown') {
    return { code: 'database_error', message: raw.message, retryable: true };
  }
  return classified;
}

export async function resolveCommissionSalon(): Promise<
  { ok: true; context: OwnerSalonContext } | { ok: false; error: StaffPerformanceError }
> {
  if (isMockSupabase) {
    return {
      ok: false,
      error: { code: 'rpc_unavailable', message: STAFF_COMMISSION_ERROR_COPY.rpc_unavailable, retryable: true },
    };
  }
  const owner = await resolveOwnerSalon();
  if (owner.ok === false) {
    const mapped = rpcError(owner.error);
    return { ok: false, error: { ...owner.error, message: mapped.message } };
  }
  return owner;
}

export async function fetchCommissionSettings(
  salonId: string,
  staffId?: string | null
): Promise<{ ok: true; rows: StaffCommissionSettingRow[] } | { ok: false; error: StaffPerformanceError }> {
  const { data, error } = await withRpcTimeout(
    supabase.rpc('get_staff_commission_settings', {
      target_salon_id: salonId,
      target_staff_id: staffId || null,
    })
  );
  if (error) return { ok: false, error: rpcError(error) };
  const rows = Array.isArray(data) ? data.map((row) => normalizeSettingRow(row as Record<string, unknown>)) : [];
  return { ok: true, rows };
}

export async function saveCommissionSetting(
  salonId: string,
  input: StaffCommissionSettingInput
): Promise<{ ok: true; id: string } | { ok: false; error: StaffPerformanceError }> {
  const { data, error } = await withRpcTimeout(
    supabase.rpc('upsert_staff_commission_setting', {
      target_salon_id: salonId,
      target_staff_id: input.staff_id,
      p_commission_type: input.commission_type,
      p_commission_rate: input.commission_rate,
      p_fixed_amount: input.fixed_amount,
      p_is_enabled: input.is_enabled,
      p_effective_from: input.effective_from,
      p_notes: input.notes || '',
    })
  );
  if (error) return { ok: false, error: failFromMessage(error) };
  return { ok: true, id: String(data || '') };
}

export async function fetchPayoutSummary(
  salonId: string,
  from: string,
  to: string,
  staffId?: string | null
): Promise<{ ok: true; rows: StaffPayoutSummaryRow[]; csv: string } | { ok: false; error: StaffPerformanceError }> {
  const { data, error } = await withRpcTimeout(
    supabase.rpc('get_staff_payout_summary', {
      target_salon_id: salonId,
      from_date: from,
      to_date: to,
      target_staff_id: staffId || null,
    })
  );
  if (error) return { ok: false, error: rpcError(error) };
  const rows = Array.isArray(data) ? data.map((row) => normalizePayoutSummaryRow(row as Record<string, unknown>)) : [];
  return { ok: true, rows, csv: csvFromPayoutSummary(rows) };
}

export async function approvePayout(
  salonId: string,
  staffId: string,
  from: string,
  to: string,
  notes = ''
): Promise<{ ok: true; id: string } | { ok: false; error: StaffPerformanceError }> {
  const { data, error } = await withRpcTimeout(
    supabase.rpc('approve_staff_payout', {
      target_salon_id: salonId,
      target_staff_id: staffId,
      from_date: from,
      to_date: to,
      p_notes: notes,
    })
  );
  if (error) return { ok: false, error: failFromMessage(error) };
  return { ok: true, id: String(data || '') };
}

export async function markPayoutPaid(
  salonId: string,
  payoutId: string,
  reference = '',
  notes = ''
): Promise<{ ok: true; id: string } | { ok: false; error: StaffPerformanceError }> {
  const { data, error } = await withRpcTimeout(
    supabase.rpc('mark_staff_payout_paid', {
      target_salon_id: salonId,
      payout_id: payoutId,
      p_reference: reference,
      p_notes: notes,
    })
  );
  if (error) return { ok: false, error: failFromMessage(error) };
  return { ok: true, id: String(data || payoutId) };
}

export async function cancelPayout(
  salonId: string,
  payoutId: string,
  notes = ''
): Promise<{ ok: true; id: string } | { ok: false; error: StaffPerformanceError }> {
  const { data, error } = await withRpcTimeout(
    supabase.rpc('cancel_staff_payout', {
      target_salon_id: salonId,
      payout_id: payoutId,
      p_notes: notes,
    })
  );
  if (error) return { ok: false, error: failFromMessage(error) };
  return { ok: true, id: String(data || payoutId) };
}

export async function fetchPayoutHistory(
  salonId: string,
  from?: string | null,
  to?: string | null,
  staffId?: string | null,
  status?: string | null
): Promise<{ ok: true; rows: StaffPayoutHistoryRow[]; csv: string } | { ok: false; error: StaffPerformanceError }> {
  const { data, error } = await withRpcTimeout(
    supabase.rpc('get_staff_payout_history', {
      target_salon_id: salonId,
      from_date: from || null,
      to_date: to || null,
      target_staff_id: staffId || null,
      p_status: status || null,
    })
  );
  if (error) {
    const classified = rpcError(error);
    return {
      ok: false,
      error: {
        ...classified,
        code: classified.code === 'unknown' ? 'export_failed' : classified.code,
        message: classified.code === 'unknown' ? STAFF_PERFORMANCE_ERROR_COPY.export_failed : classified.message,
      },
    };
  }
  const rows = Array.isArray(data) ? data.map((row) => normalizePayoutHistoryRow(row as Record<string, unknown>)) : [];
  return { ok: true, rows, csv: csvFromPayoutHistory(rows) };
}
