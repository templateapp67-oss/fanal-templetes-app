import { supabase, isMockSupabase } from './supabaseClient';
import {
  STAFF_PERFORMANCE_ERROR_COPY,
  STAFF_RPC_TIMEOUT_MS,
  classifyStaffPerformanceError,
  type StaffPerformanceError,
} from './staffPerformance';
import {
  normalizeNotification,
  normalizeNotificationPrefs,
  normalizeWeeklyReport,
  type StaffNotificationPrefs,
  type StaffPerformanceNotification,
  type WeeklyStaffReport,
} from './staffNotifications';

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

function rpcError(err: unknown): StaffPerformanceError {
  return classifyStaffPerformanceError(err);
}

function unavailable(): StaffPerformanceError {
  return { code: 'rpc_unavailable', message: STAFF_PERFORMANCE_ERROR_COPY.rpc_unavailable, retryable: true };
}

export async function fetchOwnerStaffNotifications(
  salonId: string,
  unreadOnly = false
): Promise<{ ok: true; rows: StaffPerformanceNotification[] } | { ok: false; error: StaffPerformanceError }> {
  if (isMockSupabase) return { ok: false, error: unavailable() };
  const { data, error } = await withRpcTimeout(
    supabase.rpc('get_owner_staff_notifications', {
      target_salon_id: salonId,
      unread_only: unreadOnly,
    })
  );
  if (error) return { ok: false, error: rpcError(error) };
  const rows = Array.isArray(data)
    ? data.map((row) => normalizeNotification(row as Record<string, unknown>))
    : [];
  return { ok: true, rows };
}

export async function markStaffNotificationRead(
  salonId: string,
  notificationId: string
): Promise<{ ok: true } | { ok: false; error: StaffPerformanceError }> {
  if (isMockSupabase) return { ok: false, error: unavailable() };
  const { error } = await withRpcTimeout(
    supabase.rpc('mark_staff_notification_read', {
      target_salon_id: salonId,
      notification_id: notificationId,
    })
  );
  if (error) return { ok: false, error: rpcError(error) };
  return { ok: true };
}

export async function markAllStaffNotificationsRead(
  salonId: string
): Promise<{ ok: true; count: number } | { ok: false; error: StaffPerformanceError }> {
  if (isMockSupabase) return { ok: false, error: unavailable() };
  const { data, error } = await withRpcTimeout(
    supabase.rpc('mark_all_staff_notifications_read', {
      target_salon_id: salonId,
    })
  );
  if (error) return { ok: false, error: rpcError(error) };
  return { ok: true, count: Number(data) || 0 };
}

export async function fetchOwnerWeeklyStaffReport(
  salonId: string,
  periodEnd?: string | null
): Promise<{ ok: true; report: WeeklyStaffReport | null } | { ok: false; error: StaffPerformanceError }> {
  if (isMockSupabase) return { ok: false, error: unavailable() };
  const args: Record<string, unknown> = { target_salon_id: salonId };
  if (periodEnd) args.period_end = periodEnd;
  const { data, error } = await withRpcTimeout(supabase.rpc('get_owner_weekly_staff_report', args));
  if (error) return { ok: false, error: rpcError(error) };
  return { ok: true, report: normalizeWeeklyReport(data) };
}

export async function generateOwnerWeeklyStaffReport(
  salonId: string,
  periodEnd?: string | null
): Promise<{ ok: true; id: string } | { ok: false; error: StaffPerformanceError }> {
  if (isMockSupabase) return { ok: false, error: unavailable() };
  const args: Record<string, unknown> = { target_salon_id: salonId };
  if (periodEnd) args.period_end = periodEnd;
  const { data, error } = await withRpcTimeout(supabase.rpc('generate_staff_weekly_report', args));
  if (error) return { ok: false, error: rpcError(error) };
  return { ok: true, id: String(data || '') };
}

export async function fetchStaffNotificationPreferences(
  salonId: string
): Promise<{ ok: true; prefs: StaffNotificationPrefs } | { ok: false; error: StaffPerformanceError }> {
  if (isMockSupabase) return { ok: false, error: unavailable() };
  const { data, error } = await withRpcTimeout(
    supabase.rpc('update_staff_notification_preferences', {
      target_salon_id: salonId,
      p_alerts: null,
    })
  );
  if (error) return { ok: false, error: rpcError(error) };
  return { ok: true, prefs: normalizeNotificationPrefs(data) };
}

export async function saveStaffNotificationPreferences(
  salonId: string,
  prefs: StaffNotificationPrefs
): Promise<{ ok: true; prefs: StaffNotificationPrefs } | { ok: false; error: StaffPerformanceError }> {
  if (isMockSupabase) return { ok: false, error: unavailable() };
  const { data, error } = await withRpcTimeout(
    supabase.rpc('update_staff_notification_preferences', {
      target_salon_id: salonId,
      p_alerts: prefs,
    })
  );
  if (error) return { ok: false, error: rpcError(error) };
  return { ok: true, prefs: normalizeNotificationPrefs(data) };
}
