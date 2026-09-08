import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_STAFF_NOTIFICATION_PREFS,
  STAFF_ALERT_LABELS,
  STAFF_ALERT_TYPES,
  formatNotificationTime,
  leaderValueLabel,
  topPerformerName,
  unreadCountFromNotifications,
  type StaffAlertType,
  type StaffNotificationPrefs,
  type StaffPerformanceNotification,
  type WeeklyStaffReport,
} from '../lib/staffNotifications';
import {
  fetchOwnerStaffNotifications,
  fetchOwnerWeeklyStaffReport,
  fetchStaffNotificationPreferences,
  markAllStaffNotificationsRead,
  markStaffNotificationRead,
  saveStaffNotificationPreferences,
} from '../lib/staffNotificationsApi';
import { isRpcFail } from '../lib/staffPerformanceApi';

interface StaffPerformanceAlertsProps {
  salonId: string | null;
  currencySymbol?: string;
}

export const StaffPerformanceAlerts: React.FC<StaffPerformanceAlertsProps> = ({
  salonId,
  currencySymbol = '₹',
}) => {
  const [open, setOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [fullOpen, setFullOpen] = useState(false);
  const [rows, setRows] = useState<StaffPerformanceNotification[]>([]);
  const [report, setReport] = useState<WeeklyStaffReport | null>(null);
  const [prefs, setPrefs] = useState<StaffNotificationPrefs>(DEFAULT_STAFF_NOTIFICATION_PREFS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(0);

  const load = useCallback(async () => {
    if (!salonId) {
      setRows([]);
      setReport(null);
      return;
    }
    const ticket = ++inflight.current;
    setLoading(true);
    setError(null);
    const [notes, weekly, prefResult] = await Promise.all([
      fetchOwnerStaffNotifications(salonId, false),
      fetchOwnerWeeklyStaffReport(salonId),
      fetchStaffNotificationPreferences(salonId),
    ]);
    if (ticket !== inflight.current) return;
    if (isRpcFail(notes)) {
      setError(notes.error.message);
      setLoading(false);
      return;
    }
    setRows(notes.rows);
    if (!isRpcFail(weekly)) setReport(weekly.report);
    if (!isRpcFail(prefResult)) setPrefs(prefResult.prefs);
    setLoading(false);
  }, [salonId]);

  useEffect(() => {
    void load();
    return () => {
      inflight.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (!open && !fullOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setFullOpen(false);
        setPrefsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, fullOpen]);

  const unread = useMemo(() => unreadCountFromNotifications(rows), [rows]);
  const topName = topPerformerName(report);
  const data = report?.report_data;

  const handleRead = async (id: string) => {
    if (!salonId) return;
    const result = await markStaffNotificationRead(salonId, id);
    if (isRpcFail(result)) {
      setError(result.error.message);
      return;
    }
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, is_read: true, unread_count: Math.max(0, row.unread_count - 1) } : row))
    );
  };

  const handleReadAll = async () => {
    if (!salonId) return;
    const result = await markAllStaffNotificationsRead(salonId);
    if (isRpcFail(result)) {
      setError(result.error.message);
      return;
    }
    setRows((prev) => prev.map((row) => ({ ...row, is_read: true, unread_count: 0 })));
  };

  const handlePref = async (key: StaffAlertType, enabled: boolean) => {
    if (!salonId) return;
    const next = { ...prefs, [key]: enabled };
    setPrefs(next);
    const result = await saveStaffNotificationPreferences(salonId, next);
    if (isRpcFail(result)) {
      setError(result.error.message);
      return;
    }
    setPrefs(result.prefs);
  };

  if (!salonId) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 p-4 sm:p-6 rounded-2xl shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="relative p-2 rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 cursor-pointer"
            aria-label="Staff performance notifications"
            id="staff-performance-alerts-bell"
          >
            <span className="material-symbols-outlined text-xl text-slate-700 dark:text-slate-200">notifications</span>
            {unread > 0 && (
              <span
                className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-[#C20E5A] text-white text-[10px] font-bold flex items-center justify-center"
                data-testid="staff-alert-unread"
              >
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>
          <div>
            <div className="text-sm font-bold text-gray-900 dark:text-slate-100">Staff alerts</div>
            <p className="text-[11px] text-gray-500 dark:text-slate-400">
              Owner-only. Separate from booking email notifications.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPrefsOpen((v) => !v)}
          className="text-xs font-bold px-3 py-2 rounded-xl border border-gray-300 dark:border-slate-600 text-gray-800 dark:text-slate-200 cursor-pointer"
        >
          Alert preferences
        </button>
      </div>

      {open && (
        <div
          className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-2xl p-4 shadow-xs"
          data-testid="staff-alert-panel"
        >
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="font-display font-bold text-base text-gray-900 dark:text-slate-100">Notifications</h3>
            <button
              type="button"
              onClick={() => void handleReadAll()}
              className="text-[11px] font-bold text-[#C20E5A] cursor-pointer"
              disabled={unread === 0}
            >
              Mark all read
            </button>
          </div>
          {error && <p className="text-xs text-rose-700 mb-2">{error}</p>}
          {loading && rows.length === 0 ? (
            <div className="h-24 bg-gray-50 dark:bg-slate-800 animate-pulse rounded-xl" />
          ) : rows.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-slate-400">No staff alerts yet.</p>
          ) : (
            <ul className="flex flex-col gap-2 max-h-80 overflow-y-auto">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className={`border rounded-xl p-3 ${
                    row.is_read
                      ? 'border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/60'
                      : 'border-pink-200 dark:border-pink-900 bg-pink-50/60 dark:bg-pink-950/30'
                  }`}
                >
                  <div className="flex justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-gray-900 dark:text-slate-100 truncate">{row.title}</div>
                      <p className="text-[11px] text-gray-600 dark:text-slate-300 mt-0.5">{row.message}</p>
                      <div className="text-[10px] text-gray-400 mt-1">
                        {row.staff_name} · {formatNotificationTime(row.created_at)}
                      </div>
                    </div>
                    {!row.is_read && (
                      <button
                        type="button"
                        onClick={() => void handleRead(row.id)}
                        className="text-[10px] font-bold shrink-0 cursor-pointer"
                      >
                        Mark read
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {prefsOpen && (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-2xl p-4 shadow-xs">
          <h3 className="font-display font-bold text-base mb-3 text-gray-900 dark:text-slate-100">Alert preferences</h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {STAFF_ALERT_TYPES.map((key) => (
              <li key={key} className="flex items-center justify-between gap-2 text-xs border border-gray-100 dark:border-slate-800 rounded-lg px-3 py-2">
                <span className="text-gray-800 dark:text-slate-200">{STAFF_ALERT_LABELS[key]}</span>
                <input
                  type="checkbox"
                  checked={prefs[key]}
                  onChange={(e) => void handlePref(key, e.target.checked)}
                  aria-label={STAFF_ALERT_LABELS[key]}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-2xl p-5 shadow-xs"
        data-testid="staff-weekly-report-card"
      >
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="font-display font-bold text-lg text-gray-900 dark:text-slate-100">Weekly staff report</h3>
            <p className="text-[11px] text-gray-500 dark:text-slate-400">
              {report
                ? `${report.report_period_start} → ${report.report_period_end} · vs previous week ${data?.previous_period_start || '—'} → ${data?.previous_period_end || '—'}`
                : 'Last 7 civil days from stored booking dates (UTC if no salon timezone).'}
            </p>
          </div>
          {topName && data?.has_activity && (
            <span className="text-[10px] font-mono font-bold px-2 py-1 rounded-full border bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-700">
              Top performer · {topName}
            </span>
          )}
        </div>

        {loading && !report ? (
          <div className="h-28 bg-gray-50 dark:bg-slate-800 animate-pulse rounded-xl" />
        ) : !data || !data.has_activity ? (
          <p className="text-xs text-gray-500 dark:text-slate-400">No staff activity in this week.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
            <LeaderChip label="Bookings" value={leaderValueLabel('booking', data.leaders.booking, currencySymbol)} />
            <LeaderChip label="Payments" value={leaderValueLabel('payment', data.leaders.payment, currencySymbol)} />
            <LeaderChip label="Reviews" value={leaderValueLabel('review', data.leaders.review, currencySymbol)} />
            <LeaderChip label="Highest rated" value={leaderValueLabel('highest_rated', data.leaders.highest_rated, currencySymbol)} />
            <LeaderChip label="Most improved" value={leaderValueLabel('most_improved', data.leaders.most_improved, currencySymbol)} />
            <LeaderChip label="Commission" value={leaderValueLabel('commission', data.leaders.commission, currencySymbol)} />
            <LeaderChip label="Discount" value={leaderValueLabel('discount', data.leaders.discount, currencySymbol)} />
            <LeaderChip label="Overall" value={leaderValueLabel('overall', data.leaders.overall, currencySymbol)} />
          </div>
        )}

        <button
          type="button"
          onClick={() => setFullOpen(true)}
          className="mt-4 text-xs font-bold px-3 py-2 rounded-xl border border-gray-300 dark:border-slate-600 cursor-pointer text-gray-800 dark:text-slate-200"
          disabled={!report}
        >
          View full report
        </button>
      </div>

      {fullOpen && report && (
        <div className="fixed inset-0 z-[85] flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-label="Weekly staff report">
          <button type="button" className="flex-1 cursor-pointer" aria-label="Close report" onClick={() => setFullOpen(false)} />
          <div className="w-full max-w-md h-full bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 shadow-2xl overflow-y-auto p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-display font-bold text-lg">Weekly report</h2>
              <button type="button" onClick={() => setFullOpen(false)} className="p-1 rounded cursor-pointer" aria-label="Close">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-3">
              {report.report_period_start} → {report.report_period_end}. Staff metrics only — no customer contact details.
            </p>
            {data?.staff.length === 0 ? (
              <p className="text-xs text-gray-500">Empty week.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-xs">
                {(data?.staff || []).map((row) => (
                  <li key={row.staff_id} className="border border-gray-100 dark:border-slate-800 rounded-xl p-3">
                    <div className="font-bold">
                      #{row.overall_rank} {row.staff_name}
                    </div>
                    <div className="font-mono text-[11px] text-gray-600 dark:text-slate-300 mt-1">
                      Completed {row.completed_bookings} ({row.completed_delta >= 0 ? '+' : ''}
                      {row.completed_delta} vs prior week) · Paid {currencySymbol}
                      {row.paid_amount.toLocaleString('en-IN')} · Reviews {row.review_count}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

function LeaderChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-gray-100 dark:border-slate-800 rounded-xl p-3 bg-gray-50 dark:bg-slate-800/70">
      <div className="text-[10px] font-mono-caps text-gray-500 dark:text-slate-400">{label}</div>
      <div className="font-bold text-gray-900 dark:text-slate-100 truncate" title={value}>
        {value}
      </div>
    </div>
  );
}

export default StaffPerformanceAlerts;
