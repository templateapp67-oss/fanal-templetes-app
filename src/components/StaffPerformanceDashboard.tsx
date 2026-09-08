import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  STAFF_PERFORMANCE_ERROR_COPY,
  aggregateSalonTotals,
  bookingGrowthPercent,
  chartStaffBars,
  dailySeries,
  emptyTotals,
  filterStaffRows,
  formatInr,
  formatPercent,
  formatRating,
  STAFF_FILTER_DEBOUNCE_MS,
  lastSevenCivilDays,
  leaderBadgesFor,
  mostImprovedStaffId,
  paginateRows,
  percentChange,
  previousPeriod,
  publicCustomerLabel,
  ratingTrend,
  resolveDateRange,
  sortStaffRows,
  staffInitials,
  toIsoDate,
  type DateRange,
  type SalonTotals,
  type StaffDailyPerformanceRow,
  type StaffDatePreset,
  type StaffDetailPayload,
  type StaffLast7DaysRow,
  type StaffLeaderBadge,
  type StaffNumericSortKey,
  type StaffPerformanceError,
  type StaffPerformanceSummaryRow,
} from '../lib/staffPerformance';
import {
  fetchStaffDailyPerformance,
  fetchStaffDetail,
  fetchStaffExport,
  fetchStaffLast7Days,
  fetchStaffPerformance,
  isRpcFail,
  refreshStaffDaily,
  resolveOwnerSalon,
  triggerCsvDownload,
} from '../lib/staffPerformanceApi';

const PAGE_SIZE = 8;
const PRESETS: Array<{ id: StaffDatePreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'last_7', label: 'Last 7 Days' },
  { id: 'last_30', label: 'Last 30 Days' },
  { id: 'this_month', label: 'This Month' },
  { id: 'custom', label: 'Custom Range' },
];

const TABLE_COLUMNS: Array<{ key: StaffNumericSortKey; label: string; numeric?: boolean }> = [
  { key: 'total_bookings', label: 'Total bookings', numeric: true },
  { key: 'completed_bookings', label: 'Completed', numeric: true },
  { key: 'cancelled_bookings', label: 'Cancelled', numeric: true },
  { key: 'gross_amount', label: 'Gross', numeric: true },
  { key: 'discount_amount', label: 'Discount', numeric: true },
  { key: 'net_amount', label: 'Net revenue', numeric: true },
  { key: 'paid_amount', label: 'Paid', numeric: true },
  { key: 'commission_rate', label: 'Comm. rate', numeric: true },
  { key: 'commission_amount', label: 'Commission', numeric: true },
  { key: 'salon_amount', label: 'Salon share', numeric: true },
  { key: 'review_count', label: 'Reviews', numeric: true },
  { key: 'average_rating', label: 'Avg rating', numeric: true },
  { key: 'seven_day_rank', label: '7-day rank', numeric: true },
];

export interface StaffPerformanceDashboardProps {
  user: { id?: string } | null;
  onRequireAuth?: (mode?: 'login' | 'signup') => void;
  onBackToDashboard?: () => void;
  onOpenCommission?: () => void;
  primaryAccentColor?: string;
  currencySymbol?: string;
  salonName?: string;
}

interface LoadedBundle {
  salonId: string;
  rows: StaffPerformanceSummaryRow[];
  previousRows: StaffPerformanceSummaryRow[];
  last7: StaffLast7DaysRow[];
  previous7: StaffPerformanceSummaryRow[];
  daily7: StaffDailyPerformanceRow[];
}

function canUseCharts(): boolean {
  return typeof window !== 'undefined';
}

function Photo({ url, name, size = 36 }: { url: string | null; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <span
        className="rounded-full bg-slate-800 text-white font-bold flex items-center justify-center shrink-0"
        style={{ width: size, height: size, fontSize: size < 32 ? 10 : 12 }}
        aria-hidden="true"
      >
        {staffInitials(name)}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className="rounded-full object-cover shrink-0 bg-slate-200"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white border border-gray-200 p-5 rounded-2xl shadow-xs animate-pulse" data-testid="kpi-skeleton">
      <div className="h-3 w-24 bg-gray-200 rounded mb-3" />
      <div className="h-7 w-20 bg-gray-100 rounded mb-2" />
      <div className="h-3 w-16 bg-gray-100 rounded" />
    </div>
  );
}

function Delta({ current, previous, money = false, currencySymbol = '₹' }: { current: number; previous: number; money?: boolean; currencySymbol?: string }) {
  const pct = percentChange(current, previous);
  const up = current >= previous;
  const label = pct === null ? 'New' : formatPercent(pct);
  return (
    <div className={`text-[11px] font-bold mt-1 flex items-center gap-1 ${up ? 'text-emerald-600' : 'text-rose-600'}`}>
      <span className="material-symbols-outlined text-sm">{up ? 'trending_up' : 'trending_down'}</span>
      <span>{label}</span>
      <span className="text-gray-400 font-medium">
        vs {money ? formatInr(previous, currencySymbol) : previous.toLocaleString('en-IN')}
      </span>
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
      <div className="font-bold text-sm mb-1">{error.message}</div>
      <p className="text-xs text-rose-800/80 mb-3">{STAFF_PERFORMANCE_ERROR_COPY.unknown} Use Retry if this looks temporary.</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-3.5 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold cursor-pointer"
        >
          Retry
        </button>
      )}
    </div>
  );
}

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
    <div className="min-h-[60vh] flex items-center justify-center px-4" data-testid="staff-performance-access-denied">
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

function Badge({ label }: { label: StaffLeaderBadge; key?: string }) {
  const tone: Record<StaffLeaderBadge, string> = {
    'Best Overall': 'bg-amber-100 text-amber-900 border-amber-300',
    'Booking Leader': 'bg-blue-100 text-blue-900 border-blue-300',
    'Revenue Leader': 'bg-emerald-100 text-emerald-900 border-emerald-300',
    'Review Leader': 'bg-purple-100 text-purple-900 border-purple-300',
    'Most Improved': 'bg-sky-100 text-sky-900 border-sky-300',
  };
  return (
    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full border ${tone[label]}`}>{label}</span>
  );
}

function MiniChart({
  title,
  data,
  currency,
  color,
}: {
  title: string;
  data: Array<{ name: string; value: number }>;
  currency?: boolean;
  color: string;
}) {
  const empty = data.length === 0 || data.every((d) => !d.value);
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-xs min-h-[220px]">
      <h3 className="text-xs font-bold font-mono-caps text-gray-700 mb-2">{title}</h3>
      {empty ? (
        <EmptyBlock title="No chart data" body="Nothing to plot for this filter." />
      ) : canUseCharts() ? (
        <div className="h-44" role="img" aria-label={title}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="name" fontSize={10} interval={0} angle={-20} textAnchor="end" height={48} />
              <YAxis fontSize={10} tickFormatter={(v) => (currency ? `₹${v}` : String(v))} allowDecimals={false} />
              <Tooltip
                formatter={(value: number) => (currency ? formatInr(value) : value)}
                contentStyle={{ fontSize: 12, borderRadius: 12 }}
              />
              <Bar dataKey="value" fill={color} radius={[6, 6, 0, 0]} maxBarSize={42} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="text-xs text-gray-500">Charts load in the browser.</div>
      )}
    </div>
  );
}

function LineMini({
  title,
  data,
  currency,
  color,
}: {
  title: string;
  data: Array<{ date: string; value: number }>;
  currency?: boolean;
  color: string;
}) {
  const empty = data.length === 0 || data.every((d) => !d.value);
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-xs min-h-[220px]">
      <h3 className="text-xs font-bold font-mono-caps text-gray-700 mb-2">{title}</h3>
      {empty ? (
        <EmptyBlock title="No chart data" body="No daily values in the last 7 days." />
      ) : canUseCharts() ? (
        <div className="h-44" role="img" aria-label={title}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="date" fontSize={10} tickFormatter={(v) => String(v).slice(5)} />
              <YAxis fontSize={10} tickFormatter={(v) => (currency ? `₹${v}` : String(v))} allowDecimals={false} />
              <Tooltip
                formatter={(value: number) => (currency ? formatInr(value) : value)}
                contentStyle={{ fontSize: 12, borderRadius: 12 }}
              />
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="text-xs text-gray-500">Charts load in the browser.</div>
      )}
    </div>
  );
}

export const StaffPerformanceDashboard: React.FC<StaffPerformanceDashboardProps> = ({
  user,
  onRequireAuth,
  onBackToDashboard,
  onOpenCommission,
  primaryAccentColor = '#C20E5A',
  currencySymbol = '₹',
  salonName,
}) => {
  const [preset, setPreset] = useState<StaffDatePreset>('last_7');
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

  const [staffFilter, setStaffFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<StaffNumericSortKey>('completed_bookings');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fatal, setFatal] = useState<StaffPerformanceError | null>(
    user ? null : { code: 'session_expired', message: STAFF_PERFORMANCE_ERROR_COPY.session_expired, retryable: false }
  );
  const [loadError, setLoadError] = useState<StaffPerformanceError | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<LoadedBundle | null>(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<StaffPerformanceError | null>(null);
  const [detail, setDetail] = useState<StaffDetailPayload | null>(null);
  const [detailDaily, setDetailDaily] = useState<StaffDailyPerformanceRow[]>([]);
  const detailStaffIdRef = useRef<string | null>(null);

  const inflight = useRef(0);
  const salonIdRef = useRef<string | null>(null);

  const clearDashboard = useCallback(() => {
    setBundle(null);
    setDetail(null);
    setDetailDaily([]);
    setDetailOpen(false);
    salonIdRef.current = null;
    detailStaffIdRef.current = null;
  }, []);

  const load = useCallback(async () => {
    if (!user) {
      clearDashboard();
      setFatal({ code: 'session_expired', message: STAFF_PERFORMANCE_ERROR_COPY.session_expired, retryable: false });
      setLoading(false);
      return;
    }
    const ticket = ++inflight.current;
    setLoading(true);
    setLoadError(null);
    setFatal(null);

    const owner = await resolveOwnerSalon();
    if (ticket !== inflight.current) return;
    if (isRpcFail(owner)) {
      clearDashboard();
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
    const seven = lastSevenCivilDays();
    const prev7 = previousPeriod(seven.from, seven.to);
    const prevRange = previousPeriod(debouncedRange.from, debouncedRange.to);

    const [current, previous, last7, previous7, daily7] = await Promise.all([
      fetchStaffPerformance(owner.context.salonId, debouncedRange.from, debouncedRange.to, null),
      fetchStaffPerformance(owner.context.salonId, prevRange.from, prevRange.to, null),
      fetchStaffLast7Days(owner.context.salonId),
      fetchStaffPerformance(owner.context.salonId, prev7.from, prev7.to, null),
      fetchStaffDailyPerformance(owner.context.salonId, seven.from, seven.to, null),
    ]);
    if (ticket !== inflight.current) return;

    const firstFail = [current, previous, last7, previous7, daily7].find(isRpcFail);
    if (firstFail) {
      if (firstFail.error.code === 'session_expired' || firstFail.error.code === 'owner_access_denied') {
        clearDashboard();
        setFatal(firstFail.error);
      } else {
        setLoadError(firstFail.error);
      }
      setLoading(false);
      return;
    }

    setBundle({
      salonId: owner.context.salonId,
      rows: current.ok ? current.rows : [],
      previousRows: previous.ok ? previous.rows : [],
      last7: last7.ok ? last7.rows : [],
      previous7: previous7.ok ? previous7.rows : [],
      daily7: daily7.ok ? daily7.rows : [],
    });
    setLoading(false);
  }, [user, debouncedRange.from, debouncedRange.to, clearDashboard]);

  useEffect(() => {
    void load();
    return () => {
      inflight.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (!user) {
      clearDashboard();
      setFatal({ code: 'session_expired', message: STAFF_PERFORMANCE_ERROR_COPY.session_expired, retryable: false });
      setLoading(false);
    }
  }, [user, clearDashboard]);

  useEffect(() => {
    setPage(1);
  }, [search, staffFilter, sortKey, sortDir, range.from, range.to]);

  useEffect(() => {
    if (!detailOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailOpen]);

  const ranks = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of bundle?.last7 || []) map[row.staff_id] = row.overall_rank;
    return map;
  }, [bundle]);

  const staffIdFilter = staffFilter === 'all' ? null : staffFilter;

  const visibleRows = useMemo(() => {
    const filtered = filterStaffRows(bundle?.rows || [], { query: search, staffId: staffIdFilter });
    return sortStaffRows(filtered, sortKey, sortDir, ranks);
  }, [bundle, search, staffIdFilter, sortKey, sortDir, ranks]);

  const paged = paginateRows<StaffPerformanceSummaryRow>(visibleRows, page, PAGE_SIZE);
  const totals: SalonTotals = bundle ? aggregateSalonTotals(visibleRows) : emptyTotals();
  const prevTotals: SalonTotals = bundle
    ? aggregateSalonTotals(filterStaffRows(bundle.previousRows, { staffId: staffIdFilter }))
    : emptyTotals();

  const previous7Map = useMemo(() => {
    const map: Record<string, { completed_bookings: number; average_rating: number; paid_amount: number }> = {};
    for (const row of bundle?.previous7 || []) {
      map[row.staff_id] = {
        completed_bookings: row.completed_bookings,
        average_rating: row.average_rating,
        paid_amount: row.paid_amount,
      };
    }
    return map;
  }, [bundle]);

  const improvedId = useMemo(
    () => mostImprovedStaffId(bundle?.last7 || [], previous7Map),
    [bundle, previous7Map]
  );

  const toggleSort = (key: StaffNumericSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'staff_name' ? 'asc' : 'desc');
    }
  };

  const handleRefresh = async () => {
    if (!salonIdRef.current || refreshing) return;
    setRefreshing(true);
    const result = await refreshStaffDaily(salonIdRef.current, range.to);
    setRefreshing(false);
    if (isRpcFail(result)) {
      setLoadError(result.error);
      return;
    }
    await load();
  };

  const handleExport = async () => {
    if (!salonIdRef.current || exporting) return;
    setExporting(true);
    setExportError(null);
    const staffId = staffFilter === 'all' ? null : staffFilter;
    const result = await fetchStaffExport(salonIdRef.current, range.from, range.to, staffId);
    setExporting(false);
    if (isRpcFail(result)) {
      setExportError(result.error.message);
      return;
    }
    triggerCsvDownload(`staff-performance_${range.from}_${range.to}.csv`, result.csv);
  };

  const openDetail = async (staffId: string) => {
    if (!salonIdRef.current) return;
    detailStaffIdRef.current = staffId;
    setDetailOpen(true);
    setDetail(null);
    setDetailDaily([]);
    setDetailError(null);
    setDetailLoading(true);
    const [result, daily] = await Promise.all([
      fetchStaffDetail(salonIdRef.current, staffId, range.from, range.to),
      fetchStaffDailyPerformance(salonIdRef.current, range.from, range.to, staffId),
    ]);
    setDetailLoading(false);
    if (isRpcFail(result)) {
      setDetailError(result.error);
      return;
    }
    setDetail(result.detail);
    setDetailDaily(isRpcFail(daily) ? [] : daily.rows.filter((row) => row.staff_id === staffId));
  };

  if (fatal) {
    return (
      <div className="min-h-screen pt-24 pb-16 bg-[#f9f9ff]">
        <AccessDenied error={fatal} onRequireAuth={onRequireAuth} onBack={onBackToDashboard} />
      </div>
    );
  }

  const money = (n: number) => formatInr(n, currencySymbol);
  const staffOptions = bundle?.rows || [];
  const chartRows = visibleRows;

  const bookingBars = chartStaffBars(chartRows, 'total_bookings');
  const revenueBars = chartStaffBars(chartRows, 'net_amount');
  const commissionBars = chartStaffBars(chartRows, 'commission_amount');
  const discountBars = chartStaffBars(chartRows, 'discount_amount');
  const reviewBars = chartStaffBars(chartRows, 'review_count');
  const ratingBars = chartStaffBars(chartRows, 'average_rating');
  const seven = lastSevenCivilDays();
  const dailySource =
    staffFilter === 'all'
      ? bundle?.daily7 || []
      : (bundle?.daily7 || []).filter((row) => row.staff_id === staffFilter);
  const dailyBookings = dailySeries(dailySource, seven.from, seven.to, 'bookings');
  const dailyPaid = dailySeries(dailySource, seven.from, seven.to, 'paid_amount');

  const kpis = [
    { key: 'bookings', label: 'Total Bookings', value: String(totals.total_bookings), current: totals.total_bookings, previous: prevTotals.total_bookings, icon: 'event_available' },
    { key: 'completed', label: 'Completed Bookings', value: String(totals.completed_bookings), current: totals.completed_bookings, previous: prevTotals.completed_bookings, icon: 'task_alt' },
    { key: 'payments', label: 'Total Payments', value: money(totals.paid_amount), current: totals.paid_amount, previous: prevTotals.paid_amount, icon: 'payments', money: true },
    { key: 'discounts', label: 'Total Discounts', value: money(totals.discount_amount), current: totals.discount_amount, previous: prevTotals.discount_amount, icon: 'sell', money: true },
    { key: 'commission', label: 'Total Commission', value: money(totals.commission_amount), current: totals.commission_amount, previous: prevTotals.commission_amount, icon: 'account_balance_wallet', money: true },
    { key: 'net', label: 'Salon Net Revenue', value: money(totals.salon_amount), current: totals.salon_amount, previous: prevTotals.salon_amount, icon: 'storefront', money: true },
    { key: 'reviews', label: 'Total Reviews', value: String(totals.review_count), current: totals.review_count, previous: prevTotals.review_count, icon: 'reviews' },
    { key: 'rating', label: 'Average Rating', value: formatRating(totals.average_rating), current: totals.average_rating, previous: prevTotals.average_rating, icon: 'star' },
  ];

  const last7filtered =
    staffFilter === 'all' ? bundle?.last7 || [] : (bundle?.last7 || []).filter((r) => r.staff_id === staffFilter);

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
                <h1 className="font-display text-2xl font-bold">Staff Performance</h1>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                  Owner only
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {salonName ? `${salonName} · ` : ''}
                {range.from} → {range.to} · currency {currencySymbol} INR · figures from secure RPCs
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={refreshing || loading}
                className="px-3.5 py-2 text-xs font-bold rounded-xl border border-slate-300 bg-white hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                id="staff-performance-refresh"
              >
                <span className="material-symbols-outlined text-sm">refresh</span>
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={exporting || loading || !bundle}
                className="px-3.5 py-2 text-xs font-bold rounded-xl text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                style={{ backgroundColor: primaryAccentColor }}
                id="staff-performance-export"
              >
                <span className="material-symbols-outlined text-sm">download</span>
                {exporting ? 'Exporting…' : 'CSV Export'}
              </button>
            </div>
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
                  <option key={s.staff_id} value={s.staff_id}>
                    {s.staff_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {exportError && <div className="text-xs text-rose-700 font-bold">{exportError}</div>}
        </div>

        {loadError && <ErrorBlock error={loadError} onRetry={() => void load()} />}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {loading
            ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
            : kpis.map((card) => (
                <div key={card.key} className="bg-white border border-gray-200 p-5 rounded-2xl shadow-xs" data-kpi={card.key}>
                  <div className="flex justify-between items-center text-gray-500 mb-2">
                    <span className="text-xs font-bold font-mono-caps">{card.label}</span>
                    <span className="material-symbols-outlined text-base" style={{ color: primaryAccentColor }}>
                      {card.icon}
                    </span>
                  </div>
                  <div className="font-display font-extrabold text-2xl">{card.value || '—'}</div>
                  <Delta
                    current={card.current}
                    previous={card.previous}
                    money={!!card.money}
                    currencySymbol={currencySymbol}
                  />
                </div>
              ))}
        </div>

        {!loading && bundle && bundle.rows.length === 0 && (
          <EmptyBlock title={STAFF_PERFORMANCE_ERROR_COPY.no_staff} body="Add stylists in Team Management, then refresh." />
        )}
        {!loading && bundle && bundle.rows.length > 0 && totals.total_bookings === 0 && (
          <EmptyBlock title={STAFF_PERFORMANCE_ERROR_COPY.no_bookings} body="Try a wider date range." />
        )}
        {!loading && bundle && totals.paid_amount === 0 && totals.total_bookings > 0 && (
          <EmptyBlock title={STAFF_PERFORMANCE_ERROR_COPY.no_payment_data} body="Only successful / paid payments are counted." />
        )}
        {!loading && bundle && totals.review_count === 0 && bundle.rows.length > 0 && (
          <EmptyBlock title={STAFF_PERFORMANCE_ERROR_COPY.no_review_data} body="Ratings appear after completed visits are reviewed." />
        )}

        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row justify-between gap-3 mb-4">
            <h2 className="font-display font-bold text-lg">Staff performance</h2>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search staff by name"
              className="w-full sm:w-64 pl-3 pr-3 py-2 rounded-xl border border-gray-300 text-xs bg-gray-50"
              aria-label="Search staff by name"
            />
          </div>

          {loading ? (
            <div className="h-40 bg-gray-50 rounded-xl animate-pulse" data-testid="table-skeleton" />
          ) : visibleRows.length === 0 ? (
            <EmptyBlock title="No matching staff" body="Clear search or pick All Staff." />
          ) : (
            <>
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-500 font-mono-caps">
                      <th className="py-3 px-2">
                        <button type="button" className="font-bold cursor-pointer" onClick={() => toggleSort('staff_name')}>
                          Staff
                        </button>
                      </th>
                      {TABLE_COLUMNS.map((col) => (
                        <th key={col.key} className="py-3 px-2">
                          <button type="button" className="font-bold cursor-pointer" onClick={() => toggleSort(col.key)}>
                            {col.label}
                            {sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                          </button>
                        </th>
                      ))}
                      <th className="py-3 px-2 text-right"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.items.map((row) => {
                      const top = ranks[row.staff_id] === 1;
                      return (
                        <tr
                          key={row.staff_id}
                          className={`border-b border-gray-100 hover:bg-gray-50 ${top ? 'bg-amber-50/70' : ''}`}
                        >
                          <td className="py-3 px-2">
                            <div className="flex items-center gap-2">
                              <Photo url={row.staff_photo} name={row.staff_name} />
                              <div>
                                <div className="font-bold text-gray-900 max-w-[160px] truncate" title={row.staff_name}>{row.staff_name}</div>
                                <div className="text-[10px] text-gray-500">{row.staff_role || '—'}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-2 font-mono">{row.total_bookings}</td>
                          <td className="py-3 px-2 font-mono">{row.completed_bookings}</td>
                          <td className="py-3 px-2 font-mono">{row.cancelled_bookings}</td>
                          <td className="py-3 px-2 font-mono">{money(row.gross_amount)}</td>
                          <td className="py-3 px-2 font-mono">{money(row.discount_amount)}</td>
                          <td className="py-3 px-2 font-mono">{money(row.net_amount)}</td>
                          <td className="py-3 px-2 font-mono">{money(row.paid_amount)}</td>
                          <td className="py-3 px-2 font-mono">{row.commission_rate}%</td>
                          <td className="py-3 px-2 font-mono">{money(row.commission_amount)}</td>
                          <td className="py-3 px-2 font-mono">{money(row.salon_amount)}</td>
                          <td className="py-3 px-2 font-mono">{row.review_count}</td>
                          <td className="py-3 px-2 font-mono">{formatRating(row.average_rating)}</td>
                          <td className="py-3 px-2 font-mono">{ranks[row.staff_id] ? `#${ranks[row.staff_id]}` : '—'}</td>
                          <td className="py-3 px-2 text-right">
                            <button
                              type="button"
                              onClick={() => void openDetail(row.staff_id)}
                              className="text-xs font-bold px-2.5 py-1 rounded-lg border border-gray-300 hover:bg-gray-100 cursor-pointer"
                            >
                              View details
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="lg:hidden flex flex-col gap-3">
                {paged.items.map((row) => (
                  <div key={row.staff_id} className="border border-gray-200 rounded-xl p-4 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Photo url={row.staff_photo} name={row.staff_name} />
                        <div>
                          <div className="font-bold text-sm">{row.staff_name}</div>
                          <div className="text-[11px] text-gray-500">{row.staff_role || '—'}</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void openDetail(row.staff_id)}
                        className="text-[11px] font-bold px-2 py-1 rounded-lg border border-gray-300"
                      >
                        View details
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                      <span>Bookings {row.total_bookings}</span>
                      <span>Completed {row.completed_bookings}</span>
                      <span>Cancelled {row.cancelled_bookings}</span>
                      <span>Paid {money(row.paid_amount)}</span>
                      <span>Net {money(row.net_amount)}</span>
                      <span>Commission {money(row.commission_amount)}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-between items-center mt-4 text-xs text-gray-500">
                <span>
                  Page {paged.page} of {paged.pages} · {visibleRows.length} staff
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={paged.page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-2 py-1 rounded border disabled:opacity-40 cursor-pointer"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={paged.page >= paged.pages}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-2 py-1 rounded border disabled:opacity-40 cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div>
          <h2 className="font-display font-bold text-lg mb-3">Last 7 days leaderboard</h2>
          {loading ? (
            <div className="h-40 bg-white border rounded-2xl animate-pulse" data-testid="leaderboard-skeleton" />
          ) : !loading && last7filtered.length === 0 ? (
            <EmptyBlock title="No staff data" body="The 7-day leaderboard appears once staff exist." />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <LeaderCard
                title="Top by Bookings"
                rows={[...last7filtered].sort((a, b) => a.booking_rank - b.booking_rank)}
                improvedId={improvedId}
                previous7Map={previous7Map}
                currencySymbol={currencySymbol}
                variant="bookings"
              />
              <LeaderCard
                title="Top by Payments"
                rows={[...last7filtered].sort((a, b) => a.payment_rank - b.payment_rank)}
                improvedId={improvedId}
                previous7Map={previous7Map}
                currencySymbol={currencySymbol}
                variant="payments"
              />
              <LeaderCard
                title="Top by Reviews"
                rows={[...last7filtered].sort((a, b) => a.review_rank - b.review_rank)}
                improvedId={improvedId}
                previous7Map={previous7Map}
                currencySymbol={currencySymbol}
                variant="reviews"
              />
            </div>
          )}
        </div>

        <div>
          <h2 className="font-display font-bold text-lg mb-3">Charts</h2>
          {loading ? (
            <div className="h-40 bg-white border rounded-2xl animate-pulse" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <MiniChart title="Bookings by Staff" data={bookingBars} color={primaryAccentColor} />
              <MiniChart title="Revenue by Staff" data={revenueBars} currency color="#047857" />
              <MiniChart title="Commission by Staff" data={commissionBars} currency color="#b45309" />
              <MiniChart title="Discounts by Staff" data={discountBars} currency color="#be123c" />
              <MiniChart title="Reviews by Staff" data={reviewBars} color="#6d28d9" />
              <MiniChart title="Rating Comparison" data={ratingBars} color="#ca8a04" />
              <LineMini title="Daily Bookings for Last 7 Days" data={dailyBookings} color={primaryAccentColor} />
              <LineMini title="Daily Payments for Last 7 Days" data={dailyPaid} currency color="#047857" />
            </div>
          )}
        </div>
      </div>

      {detailOpen && (
        <div className="fixed inset-0 z-[80] flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-label="Staff details">
          <button type="button" className="flex-1 cursor-pointer" aria-label="Close details" onClick={() => setDetailOpen(false)} />
          <div className="w-full max-w-md h-full bg-white shadow-2xl overflow-y-auto p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-display font-bold text-lg">Staff details</h2>
              <button type="button" onClick={() => setDetailOpen(false)} className="p-1 rounded hover:bg-gray-100 cursor-pointer" aria-label="Close">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            {detailLoading && <div className="h-40 bg-gray-50 animate-pulse rounded-xl" data-testid="detail-skeleton" />}
            {detailError && (
              <ErrorBlock
                error={detailError}
                onRetry={() => {
                  const id = detailStaffIdRef.current || detail?.staff_profile.staff_id;
                  if (id) void openDetail(id);
                }}
              />
            )}
            {detail && !detailLoading && (
              <div className="flex flex-col gap-4 text-xs">
                <div className="flex items-center gap-3">
                  <Photo url={detail.staff_profile.staff_photo} name={detail.staff_profile.staff_name} size={56} />
                  <div>
                    <div className="font-bold text-base max-w-[240px] truncate" title={detail.staff_profile.staff_name}>{detail.staff_profile.staff_name}</div>
                    <div className="text-gray-500">{detail.staff_profile.staff_role || '—'}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Total bookings" value={detail.booking_status_summary.total_bookings} />
                  <Stat label="Pending" value={detail.booking_status_summary.pending_bookings} />
                  <Stat label="Confirmed" value={detail.booking_status_summary.confirmed_bookings} />
                  <Stat label="Completed" value={detail.booking_status_summary.completed_bookings} />
                  <Stat label="Cancelled" value={detail.booking_status_summary.cancelled_bookings} />
                  <Stat label="Gross" value={money(detail.payment_summary.gross_amount)} />
                  <Stat label="Discounts" value={money(detail.discount_summary.discount_amount)} />
                  <Stat label="Net revenue" value={money(detail.discount_summary.net_amount)} />
                  <Stat label="Paid" value={money(detail.payment_summary.paid_amount)} />
                  <Stat label="Commission rate" value={`${detail.commission_calculation.commission_rate}%`} />
                  <Stat label="Commission" value={money(detail.commission_calculation.commission_amount)} />
                  <Stat label="Salon share" value={money(detail.salon_share.salon_amount)} />
                  <Stat label="Reviews" value={detail.review_summary.review_count} />
                  <Stat label="Average rating" value={formatRating(detail.review_summary.average_rating)} />
                </div>
                <div>
                  <div className="font-bold mb-1">Rating distribution</div>
                  <div className="grid grid-cols-5 gap-1 text-center font-mono">
                    <span>5★ {detail.rating_distribution.five_star_reviews}</span>
                    <span>4★ {detail.rating_distribution.four_star_reviews}</span>
                    <span>3★ {detail.rating_distribution.three_star_reviews}</span>
                    <span>2★ {detail.rating_distribution.two_star_reviews}</span>
                    <span>1★ {detail.rating_distribution.one_star_reviews}</span>
                  </div>
                </div>
                <div>
                  <div className="font-bold mb-1">Service-wise bookings</div>
                  {detail.service_wise_booking_summary.length === 0 ? (
                    <p className="text-gray-500">No services in this range.</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {detail.service_wise_booking_summary.map((s) => (
                        <li key={`${s.service_id}-${s.service_name}`} className="flex justify-between border-b border-gray-100 py-1">
                          <span>{s.service_name}</span>
                          <span className="font-mono">
                            {s.completed_bookings}/{s.bookings ?? 0} · {money(s.gross_amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="font-bold mb-1">Top services</div>
                  {detail.top_services.length === 0 ? (
                    <p className="text-gray-500">No top services yet.</p>
                  ) : (
                    <ul>
                      {detail.top_services.map((s) => (
                        <li key={s.service_name} className="flex justify-between py-1">
                          <span>{s.service_name}</span>
                          <span className="font-mono">{s.completed_bookings} completed</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="font-bold mb-1">Recent appointments</div>
                  <p className="text-[10px] text-gray-400 mb-1">Client first name only — no phone or email.</p>
                  {detail.recent_appointments.length === 0 ? (
                    <p className="text-gray-500">No recent appointments.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {detail.recent_appointments.map((a) => (
                        <li key={a.booking_id} className="border border-gray-100 rounded-lg p-2">
                          <div className="font-bold">{a.service_name || 'Service'} · {a.performance_date} {a.time_slot || ''}</div>
                          <div className="text-gray-500">
                            {publicCustomerLabel(a.customer_name)} · {a.status} · {a.payment_status} · {money(a.paid_amount)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="font-bold mb-1">Daily bookings</div>
                  {detailDaily.length === 0 ? (
                    <p className="text-gray-500">No daily rows in this range.</p>
                  ) : (
                    <ul className="flex flex-col gap-1 font-mono">
                      {detailDaily.map((d) => (
                        <li key={d.performance_date} className="flex justify-between border-b border-gray-100 py-1">
                          <span>{d.performance_date}</span>
                          <span>
                            {d.bookings} booked · {d.completed_bookings} done · {money(d.paid_amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="font-bold mb-1">Last 7 days</div>
                  {detail.last_7_days && 'overall_rank' in detail.last_7_days ? (
                    <div className="font-mono text-gray-700">
                      Rank #{String((detail.last_7_days as StaffLast7DaysRow).overall_rank)} · completed{' '}
                      {String((detail.last_7_days as StaffLast7DaysRow).completed_booking_count_7d)} · paid{' '}
                      {money(asFiniteSafe((detail.last_7_days as StaffLast7DaysRow).paid_amount_7d))}
                    </div>
                  ) : (
                    <p className="text-gray-500">No 7-day snapshot.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

function asFiniteSafe(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-2 rounded-lg bg-gray-50 border border-gray-100">
      <div className="text-[10px] text-gray-500 font-mono-caps">{label}</div>
      <div className="font-bold text-gray-900">{value}</div>
    </div>
  );
}

function LeaderCard({
  title,
  rows,
  improvedId,
  previous7Map,
  currencySymbol,
  variant,
}: {
  title: string;
  rows: StaffLast7DaysRow[];
  improvedId: string | null;
  previous7Map: Record<string, { completed_bookings: number; average_rating: number; paid_amount: number }>;
  currencySymbol: string;
  variant: 'bookings' | 'payments' | 'reviews';
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-xs">
      <h3 className="font-display font-bold text-base mb-3">{title}</h3>
      {rows.length === 0 ? (
        <EmptyBlock title="No staff data" body="Nothing to rank." />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.slice(0, 8).map((row) => {
            const badges = leaderBadgesFor(row, { mostImprovedStaffId: improvedId });
            const prev = previous7Map[row.staff_id];
            const growth = bookingGrowthPercent(row.completed_booking_count_7d, prev?.completed_bookings ?? 0);
            const trend = ratingTrend(row.average_rating_7d, prev?.average_rating ?? 0);
            const rank =
              variant === 'bookings' ? row.booking_rank : variant === 'payments' ? row.payment_rank : row.review_rank;
            return (
              <li key={row.staff_id} className="flex items-start gap-2">
                <span className="font-mono font-extrabold text-gray-400 w-6">#{rank}</span>
                <Photo url={row.staff_photo} name={row.staff_name} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm truncate">{row.staff_name}</div>
                  <div className="flex flex-wrap gap-1 my-1">
                    {badges.map((b) => (
                      <Badge key={b} label={b} />
                    ))}
                  </div>
                  {variant === 'bookings' && (
                    <div className="text-[11px] text-gray-600 font-mono">
                      Completed {row.completed_booking_count_7d} · Total {row.booking_count_7d} · Growth {formatPercent(growth)}
                    </div>
                  )}
                  {variant === 'payments' && (
                    <div className="text-[11px] text-gray-600 font-mono">
                      Paid {formatInr(row.paid_amount_7d, currencySymbol)} · Net {formatInr(row.net_amount_7d, currencySymbol)} · Comm{' '}
                      {formatInr(row.commission_amount_7d, currencySymbol)} · Salon {formatInr(row.salon_amount_7d, currencySymbol)}
                    </div>
                  )}
                  {variant === 'reviews' && (
                    <div className="text-[11px] text-gray-600 font-mono">
                      Reviews {row.review_count_7d} · Avg {formatRating(row.average_rating_7d)} · Trend {trend >= 0 ? '+' : ''}
                      {trend.toFixed(2)}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default StaffPerformanceDashboard;
