import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  STAFF_FILTER_DEBOUNCE_MS,
  formatInr,
  resolveDateRange,
  staffInitials,
  toIsoDate,
  type DateRange,
  type StaffCommissionType,
  type StaffDatePreset,
  type StaffPerformanceError,
} from '../lib/staffPerformance';
import {
  STAFF_COMMISSION_ERROR_COPY,
  aggregatePayoutTotals,
  commissionErrorMessage,
  currentSettingsOnly,
  payoutStatusLabel,
  settingLabel,
  validateCommissionSettingInput,
  type StaffCommissionSettingInput,
  type StaffCommissionSettingRow,
  type StaffCommissionTab,
  type StaffPayoutHistoryRow,
  type StaffPayoutSummaryRow,
} from '../lib/staffCommission';
import {
  approvePayout,
  cancelPayout,
  fetchCommissionSettings,
  fetchPayoutHistory,
  fetchPayoutSummary,
  isRpcFail,
  markPayoutPaid,
  resolveCommissionSalon,
  saveCommissionSetting,
} from '../lib/staffCommissionApi';
import { triggerCsvDownload } from '../lib/staffPerformanceApi';

const PRESETS: Array<{ id: StaffDatePreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'last_7', label: 'Last 7 Days' },
  { id: 'last_30', label: 'Last 30 Days' },
  { id: 'this_month', label: 'This Month' },
  { id: 'custom', label: 'Custom Range' },
];

export interface StaffCommissionDashboardProps {
  user: { id?: string } | null;
  onRequireAuth?: (mode?: 'login' | 'signup') => void;
  onBackToDashboard?: () => void;
  onOpenStaffPerformance?: () => void;
  primaryAccentColor?: string;
  currencySymbol?: string;
  salonName?: string;
}

type ConfirmAction = 'approve' | 'pay' | 'cancel' | 'save';

function AccessDenied({
  error,
  onRequireAuth,
  onBack,
}: {
  error: StaffPerformanceError;
  onRequireAuth?: (mode?: 'login' | 'signup') => void;
  onBack?: () => void;
}) {
  const needsSignIn = error.code === 'session_expired';
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4" data-testid="staff-commission-access-denied">
      <div className="max-w-md w-full bg-white border border-gray-200 rounded-2xl p-8 shadow-xs text-center">
        <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center mx-auto mb-4">
          <span className="material-symbols-outlined text-2xl">lock</span>
        </div>
        <h1 className="font-display font-bold text-xl text-gray-900 mb-2">Access denied</h1>
        <p className="text-sm text-gray-600 mb-6">{error.message}</p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          {needsSignIn && onRequireAuth && (
            <button
              type="button"
              onClick={() => onRequireAuth('login')}
              className="px-4 py-2.5 rounded-xl bg-[#C20E5A] text-white text-xs font-bold cursor-pointer"
            >
              Sign in
            </button>
          )}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="px-4 py-2.5 rounded-xl border border-gray-300 text-gray-800 text-xs font-bold cursor-pointer"
            >
              Back to dashboard
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-6 text-center text-xs text-gray-500 border border-dashed border-gray-200 rounded-xl bg-gray-50" role="status">
      <div className="font-bold text-gray-700 mb-1">{title}</div>
      <p>{body}</p>
    </div>
  );
}

function ErrorBlock({ error, onRetry }: { error: StaffPerformanceError; onRetry?: () => void }) {
  return (
    <div className="p-5 rounded-2xl border border-rose-200 bg-rose-50 text-rose-900" role="alert" data-error-code={error.code}>
      <div className="font-bold text-sm mb-1">{commissionErrorMessage(error)}</div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 px-3.5 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold cursor-pointer"
        >
          Retry
        </button>
      )}
    </div>
  );
}

function Photo({ name }: { name: string }) {
  return (
    <span className="w-9 h-9 rounded-full bg-slate-800 text-white font-bold flex items-center justify-center shrink-0 text-xs">
      {staffInitials(name)}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'paid'
      ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
      : status === 'approved'
        ? 'bg-blue-100 text-blue-800 border-blue-300'
        : status === 'cancelled'
          ? 'bg-gray-100 text-gray-600 border-gray-300'
          : 'bg-amber-100 text-amber-900 border-amber-300';
  return (
    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${tone}`}>
      {payoutStatusLabel(status as never)}
    </span>
  );
}

export const StaffCommissionDashboard: React.FC<StaffCommissionDashboardProps> = ({
  user,
  onRequireAuth,
  onBackToDashboard,
  onOpenStaffPerformance,
  primaryAccentColor = '#C20E5A',
  currencySymbol = '₹',
  salonName,
}) => {
  const [tab, setTab] = useState<StaffCommissionTab>('settings');
  const [preset, setPreset] = useState<StaffDatePreset>('this_month');
  const [customFrom, setCustomFrom] = useState(toIsoDate(new Date()));
  const [customTo, setCustomTo] = useState(toIsoDate(new Date()));
  const range: DateRange = useMemo(
    () => resolveDateRange(preset, { customFrom, customTo }),
    [preset, customFrom, customTo]
  );
  const [debouncedRange, setDebouncedRange] = useState<DateRange>(range);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedRange(range), STAFF_FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [range.from, range.to, range.preset]);

  const [staffFilter, setStaffFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fatal, setFatal] = useState<StaffPerformanceError | null>(
    user ? null : { code: 'session_expired', message: STAFF_COMMISSION_ERROR_COPY.session_expired, retryable: false }
  );
  const [loadError, setLoadError] = useState<StaffPerformanceError | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [settings, setSettings] = useState<StaffCommissionSettingRow[]>([]);
  const [summary, setSummary] = useState<StaffPayoutSummaryRow[]>([]);
  const [history, setHistory] = useState<StaffPayoutHistoryRow[]>([]);

  const [form, setForm] = useState<StaffCommissionSettingInput>({
    staff_id: '',
    commission_type: 'percentage',
    commission_rate: 0,
    fixed_amount: 0,
    is_enabled: true,
    effective_from: toIsoDate(new Date()),
    notes: '',
  });

  const [confirm, setConfirm] = useState<{
    action: ConfirmAction;
    staffId?: string;
    payoutId?: string;
    title: string;
    body: string;
  } | null>(null);
  const [payRef, setPayRef] = useState('');
  const [actionNotes, setActionNotes] = useState('');

  const inflight = useRef(0);
  const salonIdRef = useRef<string | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3200);
  };

  const clearData = useCallback(() => {
    setSettings([]);
    setSummary([]);
    setHistory([]);
    salonIdRef.current = null;
  }, []);

  const load = useCallback(async () => {
    if (!user) {
      clearData();
      setFatal({ code: 'session_expired', message: STAFF_COMMISSION_ERROR_COPY.session_expired, retryable: false });
      setLoading(false);
      return;
    }
    const ticket = ++inflight.current;
    setLoading(true);
    setLoadError(null);
    setFatal(null);

    const owner = await resolveCommissionSalon();
    if (ticket !== inflight.current) return;
    if (isRpcFail(owner)) {
      clearData();
      if (
        owner.error.code === 'session_expired' ||
        owner.error.code === 'owner_access_denied' ||
        owner.error.code === 'salon_not_found'
      ) {
        setFatal(owner.error);
      } else {
        setLoadError(owner.error);
      }
      setLoading(false);
      return;
    }

    salonIdRef.current = owner.context.salonId;
    const staffId = staffFilter === 'all' ? null : staffFilter;
    const [setRes, sumRes, histRes] = await Promise.all([
      fetchCommissionSettings(owner.context.salonId, null),
      fetchPayoutSummary(owner.context.salonId, debouncedRange.from, debouncedRange.to, staffId),
      fetchPayoutHistory(owner.context.salonId, debouncedRange.from, debouncedRange.to, staffId, tab === 'paid' ? 'paid' : null),
    ]);
    if (ticket !== inflight.current) return;

    const firstFail = [setRes, sumRes, histRes].find(isRpcFail);
    if (firstFail) {
      if (firstFail.error.code === 'session_expired' || firstFail.error.code === 'owner_access_denied') {
        clearData();
        setFatal(firstFail.error);
      } else {
        setLoadError(firstFail.error);
      }
      setLoading(false);
      return;
    }

    setSettings(setRes.ok ? setRes.rows : []);
    setSummary(sumRes.ok ? sumRes.rows : []);
    setHistory(histRes.ok ? histRes.rows : []);
    setLoading(false);
  }, [user, debouncedRange.from, debouncedRange.to, staffFilter, tab, clearData]);

  useEffect(() => {
    void load();
    return () => {
      inflight.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (!user) {
      clearData();
      setFatal({ code: 'session_expired', message: STAFF_COMMISSION_ERROR_COPY.session_expired, retryable: false });
      setLoading(false);
    }
  }, [user, clearData]);

  useEffect(() => {
    if (!confirm) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirm(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm]);

  const current = useMemo(() => currentSettingsOnly(settings), [settings]);
  const staffOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of current) map.set(row.staff_id, row.staff_name);
    for (const row of summary) map.set(row.staff_id, row.staff_name);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [current, summary]);

  const totals = aggregatePayoutTotals(summary);
  const money = (n: number) => formatInr(n, currencySymbol);
  const today = toIsoDate(new Date());

  const fillForm = (row: StaffCommissionSettingRow) => {
    setForm({
      staff_id: row.staff_id,
      commission_type: row.commission_type,
      commission_rate: row.commission_rate,
      fixed_amount: row.fixed_amount,
      is_enabled: row.is_enabled,
      effective_from: today,
      notes: row.notes,
    });
    setTab('settings');
  };

  const requestSave = () => {
    const check = validateCommissionSettingInput(form, today);
    if (check.ok === false) {
      showToast(check.message, 'error');
      return;
    }
    setConfirm({
      action: 'save',
      staffId: form.staff_id,
      title: 'Save commission setting?',
      body: 'A new version is inserted. Previous rates stay on record and are never rewritten.',
    });
  };

  const runConfirm = async () => {
    if (!confirm || !salonIdRef.current || saving) return;
    setSaving(true);
    const salonId = salonIdRef.current;
    let result: { ok: true } | { ok: false; error: StaffPerformanceError };
    if (confirm.action === 'save') {
      result = await saveCommissionSetting(salonId, form);
    } else if (confirm.action === 'approve' && confirm.staffId) {
      result = await approvePayout(salonId, confirm.staffId, range.from, range.to, actionNotes);
    } else if (confirm.action === 'pay' && confirm.payoutId) {
      result = await markPayoutPaid(salonId, confirm.payoutId, payRef, actionNotes);
    } else if (confirm.action === 'cancel' && confirm.payoutId) {
      result = await cancelPayout(salonId, confirm.payoutId, actionNotes);
    } else {
      result = { ok: false, error: { code: 'unknown', message: STAFF_COMMISSION_ERROR_COPY.unknown, retryable: true } };
    }
    setSaving(false);
    setConfirm(null);
    setActionNotes('');
    setPayRef('');
    if (isRpcFail(result)) {
      showToast(commissionErrorMessage(result.error), 'error');
      return;
    }
    showToast(
      confirm.action === 'save'
        ? 'Commission setting saved'
        : confirm.action === 'approve'
          ? 'Payout approved'
          : confirm.action === 'pay'
            ? 'Payout marked paid'
            : 'Payout cancelled',
      'success'
    );
    await load();
  };

  const handleExport = async () => {
    if (!salonIdRef.current || exporting) return;
    setExporting(true);
    const staffId = staffFilter === 'all' ? null : staffFilter;
    if (tab === 'paid') {
      const result = await fetchPayoutHistory(salonIdRef.current, range.from, range.to, staffId, 'paid');
      setExporting(false);
      if (isRpcFail(result)) {
        showToast(result.error.message, 'error');
        return;
      }
      triggerCsvDownload(`staff-payout-history_${range.from}_${range.to}.csv`, result.csv);
      return;
    }
    const result = await fetchPayoutSummary(salonIdRef.current, range.from, range.to, staffId);
    setExporting(false);
    if (isRpcFail(result)) {
      showToast(result.error.message, 'error');
      return;
    }
    triggerCsvDownload(`staff-payout-summary_${range.from}_${range.to}.csv`, result.csv);
  };

  if (fatal) {
    return (
      <div className="min-h-screen pt-24 pb-16 bg-[#f9f9ff]">
        <AccessDenied error={fatal} onRequireAuth={onRequireAuth} onBack={onBackToDashboard} />
      </div>
    );
  }

  const pendingRows = summary.filter((row) => row.payout_status !== 'paid' && row.payout_status !== 'cancelled');

  return (
    <div className="min-h-screen pt-24 pb-16 flex flex-col items-center bg-[#f9f9ff] text-[#151c27]">
      <div className="max-w-[1240px] w-full px-4 sm:px-6 flex flex-col gap-6">
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs flex flex-col gap-4">
          <div className="flex flex-col lg:flex-row justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                {onBackToDashboard && (
                  <button
                    type="button"
                    onClick={onBackToDashboard}
                    className="text-xs font-bold text-gray-500 hover:text-gray-800 flex items-center gap-1 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">arrow_back</span>
                    Dashboard
                  </button>
                )}
                <h1 className="font-display text-2xl font-bold">Staff Commission</h1>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                  Owner only
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {salonName ? `${salonName} · ` : ''}
                {range.from} → {range.to} · settings are versioned · payouts via RPC only
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {onOpenStaffPerformance && (
                <button
                  type="button"
                  onClick={onOpenStaffPerformance}
                  className="px-3.5 py-2 text-xs font-bold rounded-xl border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer"
                >
                  Performance
                </button>
              )}
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="px-3.5 py-2 text-xs font-bold rounded-xl border border-slate-300 bg-white hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-sm">refresh</span>
                Refresh
              </button>
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={exporting || loading}
                className="px-3.5 py-2 text-xs font-bold rounded-xl text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                style={{ backgroundColor: primaryAccentColor }}
                id="staff-commission-export"
              >
                <span className="material-symbols-outlined text-sm">download</span>
                {exporting ? 'Exporting…' : 'CSV Export'}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1 bg-gray-100 p-1 rounded-xl w-fit" role="tablist" aria-label="Commission tabs">
            {([
              { id: 'settings', label: 'Settings' },
              { id: 'pending', label: 'Pending' },
              { id: 'paid', label: 'Paid History' },
            ] as const).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                  tab === item.id ? 'bg-white shadow-xs text-gray-900' : 'text-gray-600'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex flex-wrap gap-1 bg-gray-100 p-1 rounded-xl" role="tablist" aria-label="Date filter">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                    preset === p.id ? 'bg-white shadow-xs text-gray-900' : 'text-gray-600'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="flex items-center gap-2 text-xs">
                <label className="font-bold text-gray-600">
                  From
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="ml-1 border border-gray-300 rounded-lg px-2 py-1"
                  />
                </label>
                <label className="font-bold text-gray-600">
                  To
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="ml-1 border border-gray-300 rounded-lg px-2 py-1"
                  />
                </label>
              </div>
            )}
            <label className="text-xs font-bold text-gray-600 flex items-center gap-2">
              Staff
              <select
                value={staffFilter}
                onChange={(e) => setStaffFilter(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1.5 bg-white"
                aria-label="Staff filter"
              >
                <option value="all">All Staff</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {loadError && <ErrorBlock error={loadError} onRetry={() => void load()} />}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white border border-gray-200 p-5 rounded-2xl animate-pulse" data-testid="kpi-skeleton">
                  <div className="h-3 w-24 bg-gray-200 rounded mb-3" />
                  <div className="h-7 w-20 bg-gray-100 rounded" />
                </div>
              ))
            : [
                { key: 'commission', label: 'Earned commission', value: money(totals.commission_amount) },
                { key: 'pending', label: 'Pending payout', value: money(totals.pending_commission) },
                { key: 'paid', label: 'Already paid', value: money(totals.already_paid_commission) },
                { key: 'bookings', label: 'Completed bookings', value: String(totals.completed_bookings) },
              ].map((card) => (
                <div key={card.key} className="bg-white border border-gray-200 p-5 rounded-2xl shadow-xs" data-kpi={card.key}>
                  <div className="text-xs font-bold font-mono-caps text-gray-500 mb-2">{card.label}</div>
                  <div className="font-display font-extrabold text-2xl">{card.value}</div>
                </div>
              ))}
        </div>

        {tab === 'settings' && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-2 bg-white border border-gray-200 rounded-2xl p-5 shadow-xs">
              <h2 className="font-display font-bold text-lg mb-3">New setting version</h2>
              <p className="text-[11px] text-gray-500 mb-4">
                Changing a rate inserts a new row. Old commission records stay as they were.
              </p>
              <div className="flex flex-col gap-3 text-xs">
                <label className="font-bold text-gray-600">
                  Staff
                  <select
                    value={form.staff_id}
                    onChange={(e) => setForm((f) => ({ ...f, staff_id: e.target.value }))}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2 bg-white"
                  >
                    <option value="">Select staff</option>
                    {staffOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="font-bold text-gray-600">
                  Type
                  <select
                    value={form.commission_type}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, commission_type: e.target.value as StaffCommissionType }))
                    }
                    className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2 bg-white"
                  >
                    <option value="percentage">Percentage of net</option>
                    <option value="fixed">Fixed per completed booking</option>
                    <option value="none">None</option>
                  </select>
                </label>
                {form.commission_type === 'percentage' && (
                  <label className="font-bold text-gray-600">
                    Rate (0–100)
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={form.commission_rate}
                      onChange={(e) => setForm((f) => ({ ...f, commission_rate: Number(e.target.value) }))}
                      className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2"
                    />
                  </label>
                )}
                {form.commission_type === 'fixed' && (
                  <label className="font-bold text-gray-600">
                    Fixed amount
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.fixed_amount}
                      onChange={(e) => setForm((f) => ({ ...f, fixed_amount: Number(e.target.value) }))}
                      className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2"
                    />
                  </label>
                )}
                <label className="font-bold text-gray-600 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.is_enabled && form.commission_type !== 'none'}
                    onChange={(e) => setForm((f) => ({ ...f, is_enabled: e.target.checked }))}
                  />
                  Enabled
                </label>
                <label className="font-bold text-gray-600">
                  Effective from
                  <input
                    type="date"
                    min={today}
                    value={form.effective_from}
                    onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2"
                  />
                </label>
                <label className="font-bold text-gray-600">
                  Notes
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2"
                    rows={2}
                  />
                </label>
                <button
                  type="button"
                  onClick={requestSave}
                  disabled={saving || loading}
                  className="px-3.5 py-2 rounded-xl text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                  style={{ backgroundColor: primaryAccentColor }}
                >
                  Save setting
                </button>
              </div>
            </div>
            <div className="lg:col-span-3 bg-white border border-gray-200 rounded-2xl p-5 shadow-xs">
              <h2 className="font-display font-bold text-lg mb-3">Current settings</h2>
              {loading ? (
                <div className="h-40 bg-gray-50 rounded-xl animate-pulse" data-testid="table-skeleton" />
              ) : current.length === 0 ? (
                <EmptyBlock title={STAFF_COMMISSION_ERROR_COPY.no_staff} body="Save a setting for a staff member to get started." />
              ) : (
                <div className="flex flex-col gap-2">
                  {current
                    .filter((row) => staffFilter === 'all' || row.staff_id === staffFilter)
                    .map((row) => (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => fillForm(row)}
                        className="text-left border border-gray-200 rounded-xl p-3 hover:bg-gray-50 cursor-pointer flex items-center gap-3"
                      >
                        <Photo name={row.staff_name} />
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-sm truncate">{row.staff_name}</div>
                          <div className="text-[11px] text-gray-500 font-mono">
                            {settingLabel(row, currencySymbol)} · from {row.effective_from}
                          </div>
                        </div>
                      </button>
                    ))}
                </div>
              )}
              {settings.some((row) => !row.is_current) && (
                <div className="mt-4">
                  <h3 className="text-xs font-bold font-mono-caps text-gray-500 mb-2">History (read only)</h3>
                  <ul className="text-[11px] font-mono text-gray-600 flex flex-col gap-1">
                    {settings
                      .filter((row) => !row.is_current)
                      .slice(0, 12)
                      .map((row) => (
                        <li key={row.id}>
                          {row.staff_name}: {settingLabel(row, currencySymbol)} · {row.effective_from} → {row.effective_to}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'pending' && (
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-xs">
            <h2 className="font-display font-bold text-lg mb-3">Pending payouts</h2>
            {loading ? (
              <div className="h-40 bg-gray-50 rounded-xl animate-pulse" />
            ) : pendingRows.length === 0 ? (
              <EmptyBlock title={STAFF_COMMISSION_ERROR_COPY.no_payment_data} body="Approve a period after completed bookings earn commission." />
            ) : (
              <>
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 text-gray-500 font-mono-caps">
                        <th className="py-3 px-2">Staff</th>
                        <th className="py-3 px-2">Bookings</th>
                        <th className="py-3 px-2">Gross</th>
                        <th className="py-3 px-2">Discount</th>
                        <th className="py-3 px-2">Net</th>
                        <th className="py-3 px-2">Commission</th>
                        <th className="py-3 px-2">Paid</th>
                        <th className="py-3 px-2">Pending</th>
                        <th className="py-3 px-2">Status</th>
                        <th className="py-3 px-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingRows.map((row) => (
                        <tr key={row.staff_id} className="border-b border-gray-100">
                          <td className="py-3 px-2 font-bold">{row.staff_name}</td>
                          <td className="py-3 px-2 font-mono">{row.completed_bookings}</td>
                          <td className="py-3 px-2 font-mono">{money(row.gross_amount)}</td>
                          <td className="py-3 px-2 font-mono">{money(row.discount_amount)}</td>
                          <td className="py-3 px-2 font-mono">{money(row.net_amount)}</td>
                          <td className="py-3 px-2 font-mono">{money(row.commission_amount)}</td>
                          <td className="py-3 px-2 font-mono">{money(row.already_paid_commission)}</td>
                          <td className="py-3 px-2 font-mono">{money(row.pending_commission)}</td>
                          <td className="py-3 px-2">
                            <StatusPill status={row.payout_status} />
                          </td>
                          <td className="py-3 px-2 text-right">
                            <div className="flex justify-end gap-1">
                              {row.payout_status !== 'approved' && row.payout_status !== 'paid' && (
                                <button
                                  type="button"
                                  className="px-2 py-1 rounded-lg border text-[11px] font-bold cursor-pointer"
                                  onClick={() =>
                                    setConfirm({
                                      action: 'approve',
                                      staffId: row.staff_id,
                                      title: `Approve payout for ${row.staff_name}?`,
                                      body: `${money(row.commission_amount)} for ${range.from} → ${range.to}. Cancelled, failed, and refunded bookings are excluded.`,
                                    })
                                  }
                                >
                                  Approve
                                </button>
                              )}
                              {row.payout_status === 'approved' && row.open_payout_id && (
                                <button
                                  type="button"
                                  className="px-2 py-1 rounded-lg border text-[11px] font-bold cursor-pointer"
                                  onClick={() =>
                                    setConfirm({
                                      action: 'pay',
                                      payoutId: row.open_payout_id || undefined,
                                      title: `Mark paid for ${row.staff_name}?`,
                                      body: 'A paid payout cannot be paid again.',
                                    })
                                  }
                                >
                                  Mark paid
                                </button>
                              )}
                              {row.open_payout_id && row.payout_status !== 'paid' && (
                                <button
                                  type="button"
                                  className="px-2 py-1 rounded-lg border text-[11px] font-bold text-rose-700 cursor-pointer"
                                  onClick={() =>
                                    setConfirm({
                                      action: 'cancel',
                                      payoutId: row.open_payout_id || undefined,
                                      title: `Cancel payout for ${row.staff_name}?`,
                                      body: 'Paid payouts cannot be cancelled.',
                                    })
                                  }
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="lg:hidden flex flex-col gap-3">
                  {pendingRows.map((row) => (
                    <div key={row.staff_id} className="border border-gray-200 rounded-xl p-4">
                      <div className="flex justify-between items-center mb-2">
                        <div className="font-bold text-sm">{row.staff_name}</div>
                        <StatusPill status={row.payout_status} />
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-[11px] font-mono">
                        <span>Bookings {row.completed_bookings}</span>
                        <span>Net {money(row.net_amount)}</span>
                        <span>Commission {money(row.commission_amount)}</span>
                        <span>Pending {money(row.pending_commission)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'paid' && (
          <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-xs">
            <h2 className="font-display font-bold text-lg mb-3">Paid history</h2>
            {loading ? (
              <div className="h-40 bg-gray-50 rounded-xl animate-pulse" />
            ) : history.filter((row) => row.status === 'paid').length === 0 ? (
              <EmptyBlock title={STAFF_COMMISSION_ERROR_COPY.no_review_data} body="Mark an approved payout as paid to see it here." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-500 font-mono-caps">
                      <th className="py-3 px-2">Staff</th>
                      <th className="py-3 px-2">Period</th>
                      <th className="py-3 px-2">Commission</th>
                      <th className="py-3 px-2">Paid at</th>
                      <th className="py-3 px-2">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history
                      .filter((row) => row.status === 'paid')
                      .map((row) => (
                        <tr key={row.payout_id} className="border-b border-gray-100">
                          <td className="py-3 px-2 font-bold">{row.staff_name}</td>
                          <td className="py-3 px-2 font-mono">
                            {row.period_from} → {row.period_to}
                          </td>
                          <td className="py-3 px-2 font-mono">{money(row.commission_amount)}</td>
                          <td className="py-3 px-2 font-mono">{row.paid_at ? String(row.paid_at).slice(0, 10) : '—'}</td>
                          <td className="py-3 px-2">{row.reference_number || '—'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {confirm && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl p-5 max-w-md w-full shadow-2xl">
            <h2 className="font-display font-bold text-lg mb-2">{confirm.title}</h2>
            <p className="text-xs text-gray-600 mb-3">{confirm.body}</p>
            {confirm.action === 'pay' && (
              <label className="text-xs font-bold text-gray-600 block mb-2">
                Reference
                <input
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2"
                />
              </label>
            )}
            {confirm.action !== 'save' && (
              <label className="text-xs font-bold text-gray-600 block mb-3">
                Note
                <input
                  value={actionNotes}
                  onChange={(e) => setActionNotes(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-2"
                />
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void runConfirm()}
                disabled={saving}
                className="px-3 py-2 rounded-xl text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                style={{ backgroundColor: primaryAccentColor }}
              >
                {saving ? 'Working…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          role={toast.type === 'error' ? 'alert' : 'status'}
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[1200] px-5 py-3 rounded-2xl text-sm font-bold text-white ${
            toast.type === 'error' ? 'bg-rose-600' : 'bg-emerald-600'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
};

export default StaffCommissionDashboard;
