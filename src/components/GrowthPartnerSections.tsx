import { ReferralTable } from './ReferralTable';
import { formatPartnerDate, referralTitle } from '../lib/partnerPresentation';
export { formatPartnerDate } from '../lib/partnerPresentation';
import { PartnerStatCard as KpiCard } from './PartnerStatCard';
export { PartnerStatCard as KpiCard } from './PartnerStatCard';
import { ReferralStatusPill } from './ReferralStatusPill';
export { ReferralStatusPill } from './ReferralStatusPill';
import { usePartnerClipboard } from '../lib/usePartnerClipboard';
import { PartnerReferralActivity } from './PartnerReferralActivity';
import { PartnerToast } from './PartnerToast';
import { PartnerLoading } from './PartnerLoading';
import { ReferralEmptyState } from './ReferralEmptyState';
import { ReferralSearchControls } from './ReferralSearchControls';
import { ReferralDetailsDrawer } from './ReferralDetailsDrawer';
import { DEFAULT_REFERRAL_FILTERS, type ReferralFilters } from '../lib/referralFilters';
import { referralStatusDescriptor, REFERRAL_STATUS_TABS, type ReferralStatusTab, type ReferralStatusCounts } from '../lib/referralStatus';
import React, { useCallback, useState, useId } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  GROWTH_PARTNER_REFERRAL_CODE_UNAVAILABLE,
  PARTNER_ACTIVITY_LABELS,
  PARTNER_REFERRAL_FILTER_LABELS,
  normalizePartnerDashboardData,
  normalizePartnerPerformanceData,
  normalizePartnerReferralList,
  type PartnerActivityEntry,
  type PartnerDashboardData,
  type PartnerPerformanceData,
  type PartnerReferralEntry,
  type PartnerReferralFilter,
  type PartnerReferralList,
} from '../lib/growthPartner';

// ============================================================================
// Growth Partner sections — presentational components for /growth-partner/....
//
// Every value rendered here arrives from the Phase 6 backend RPCs (partner
// card, KPI counts, referral rows, activity, performance aggregates). The
// components never compute business totals, never touch partner/user ids
// (rows carry masked refs only), and map statuses through the single shared
// referralStatusDescriptor. Each section owns loading / error / empty /
// success states; data fetching lives in GrowthPartnerPage.
// ============================================================================

export const GROWTH_PARTNER_NO_REFERRALS_TITLE = 'No referrals yet.';
/** Referred-users list (the Referrals section) — same meaning, section wording. */
export const GROWTH_PARTNER_NO_REFERRED_USERS_TITLE = 'No referrals yet.';
export const GROWTH_PARTNER_NO_REFERRALS_BODY =
  'Start sharing your referral link to grow your network.';
export const GROWTH_PARTNER_NO_COMMISSION_TITLE = 'No commission earned yet.';
export const GROWTH_PARTNER_NO_COMMISSION_BODY =
  'Partner commissions are not configured yet. When a commission model is available, earned amounts and history will appear here.';
export const GROWTH_PARTNER_NO_PERFORMANCE_TITLE = 'No performance data yet.';
export const GROWTH_PARTNER_NO_PERFORMANCE_BODY = 'Performance data will appear as referrals progress.';

function formatMonthLabel(month: string): string {
  if (!month) return '—';
  const parsed = new Date(`${month}-01T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return month;
  return parsed.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/**
 * A backend count that did not arrive renders as '—' — never as a fabricated
 * zero, and never as the string "undefined"/"null".
 */
function countLabel(value: number | null | undefined): string {
  return Number.isFinite(value as number) ? String(value) : '—';
}

/** Percentage label under the same rule (completion rate). */
function percentLabel(value: number | null | undefined): string {
  return Number.isFinite(value as number) ? `${value}%` : '—';
}

/** Finite number or `fallback` — for pager math that must never be NaN. */
function numOr(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function activityLabel(type: string): string {
  return (PARTNER_ACTIVITY_LABELS as Record<string, string>)[type] ?? 'Referral update';
}

// ---------------------------------------------------------------------------
// Shared atoms
// ---------------------------------------------------------------------------

/** Status pill — the single place referral statuses become UI (one mapping). */
export function SectionLoading({ label }: { label: string }) {
  return <PartnerLoading label={label} kind={label.includes('dashboard') ? 'dashboard' : 'table'} />;
}

export function SectionError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="text-center bg-white rounded-3xl border border-slate-200 shadow-sm px-6 py-14">
      <div className="w-16 h-16 rounded-2xl bg-rose-50 flex items-center justify-center mx-auto mb-4">
        <AlertCircle className="w-8 h-8 text-rose-500" />
      </div>
      <h2 className="text-lg font-bold text-slate-900">Something went wrong</h2>
      <p className="text-sm text-slate-600 mt-1.5">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={() => onRetry()}
          className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold cursor-pointer bg-slate-900 text-white transition-opacity hover:opacity-90"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      )}
    </div>
  );
}

export function SectionEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="text-center bg-white rounded-3xl border border-slate-200 shadow-sm px-6 py-14">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
        <Inbox className="w-8 h-8 text-slate-400" />
      </div>
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      <p className="text-sm text-slate-600 mt-1.5">{body}</p>
    </div>
  );
}

/** Server-side pager: page turns request a new slice, never slice in React. */
export function Pager({
  total,
  limit,
  offset,
  onPage,
}: {
  total: number;
  limit: number;
  offset: number;
  onPage: (nextOffset: number) => void;
}) {
  // Pager math runs on server numbers; a malformed/absent value must not turn
  // into "Showing NaN–NaN of undefined".
  const safeTotal = numOr(total, 0);
  const safeLimit = Math.max(1, numOr(limit, 1));
  const safeOffset = Math.max(0, numOr(offset, 0));
  if (safeTotal <= 0) return null;
  const from = Math.min(safeOffset + 1, safeTotal);
  const to = Math.min(safeOffset + safeLimit, safeTotal);
  const hasPrev = safeOffset > 0;
  const hasNext = safeOffset + safeLimit < safeTotal;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs font-bold text-slate-500" aria-live="polite">
        Showing {from}–{to} of {safeTotal}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPage(Math.max(0, safeOffset - safeLimit))}
          disabled={!hasPrev}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-4 h-4" />
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPage(safeOffset + safeLimit)}
          disabled={!hasNext}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function PartnerFilterPills({
  value,
  onChange,
}: {
  value: PartnerReferralFilter;
  onChange: (next: PartnerReferralFilter) => void;
}) {
  const filters = Object.keys(PARTNER_REFERRAL_FILTER_LABELS) as PartnerReferralFilter[];
  return (
    <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
      {filters.map((key) => {
        const active = key === value;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={active}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
              active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {PARTNER_REFERRAL_FILTER_LABELS[key]}
          </button>
        );
      })}
    </div>
  );
}

function initialsFor(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'GP';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function ReferralCodeCard({ code }: { code?: string | null }) {
  const { copy, copied, error: copyError, notice } = usePartnerClipboard();
  const value = typeof code === 'string' ? code.trim() : '';

  if (!value) {
    return (
      <section aria-label="Your referral code" className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">Your referral code</h2>
        <p className="mt-3 text-sm font-bold text-slate-700">{GROWTH_PARTNER_REFERRAL_CODE_UNAVAILABLE}</p>
        {copyError && <p role="alert" className="mt-3 text-sm text-rose-700">Could not copy. Select and copy the code manually.</p>}
      <p className="mt-3 text-xs text-slate-500">
          Your code is managed by the platform and cannot be changed here.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Your referral code" className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
      <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">Your referral code</h2>
      <PartnerToast noticeId={notice.id} message={notice.message} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <code className="min-w-0 break-all text-2xl font-black tracking-[0.2em] text-slate-900 select-all">{value}</code>
        <button
          type="button"
          onClick={() => void copy(value, 'code')}
          className="inline-flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90"
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 w-4" />}
          {copied ? 'Copied' : 'Copy Code'}
        </button>
      </div>
      {copyError && <p role="alert" className="mt-3 text-sm text-rose-700">Could not copy. Select and copy the code manually.</p>}
      <p className="mt-3 text-xs text-slate-500">
        New users who join with this code are linked to you. Your code is managed by the platform and cannot be
        changed here.
      </p>
    </section>
  );
}

export function PartnerProfileCard({
  dashboard,
  displayName,
  email,
  accentHex = '#C20E5A',
}: {
  dashboard: PartnerDashboardData;
  displayName: string;
  email: string;
  accentHex?: string;
}) {
  // The card renders even when the payload omitted the partner block or the
  // status flag: an unknown status is stated as unknown (and never turns into
  // a false "Paused" alarm) instead of throwing.
  const partner = dashboard?.partner ?? { referral_code: '', is_active: null, partner_since: null };
  const isActive = partner.is_active === true;
  const isPaused = partner.is_active === false;
  return (
    <section aria-label="Partner profile" className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="w-14 h-14 rounded-full text-white font-black flex items-center justify-center shrink-0"
          style={{ backgroundColor: accentHex }}
        >
          {initialsFor(displayName)}
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-slate-900 truncate">{displayName}</h2>
          <p className="text-sm text-slate-600 truncate">{email}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                isActive ? 'bg-emerald-100 text-emerald-800' : isPaused ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {isActive ? 'Active' : isPaused ? 'Paused' : 'Status unavailable'}
            </span>
            <span className="text-xs text-slate-500">Partner since {formatPartnerDate(partner.partner_since ?? null)}</span>
          </p>
        </div>
      </div>
      {isPaused && (
        <p className="mt-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          Your code is currently paused: existing referrals stay linked, but new users cannot join with it.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function ActivityList({ activity }: { activity?: PartnerActivityEntry[] | null }) {
  // A missing activity list is "no activity", not a render crash.
  const entries = Array.isArray(activity) ? activity.filter((entry): entry is PartnerActivityEntry => !!entry) : [];
  if (entries.length === 0) {
    return (
      <div className="text-center px-6 py-10">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
          <Inbox className="w-8 h-8 text-slate-400" />
        </div>
        <h3 className="text-base font-bold text-slate-900">{GROWTH_PARTNER_NO_REFERRALS_TITLE}</h3>
        <p className="text-sm text-slate-600 mt-1.5">{GROWTH_PARTNER_NO_REFERRALS_BODY}</p>
      </div>
    );
  }
  return (
    <ul className="mt-4 divide-y divide-slate-100">
      {entries.map((entry, index) => (
        <li key={`${entry.type}-${entry.ref}-${entry.at ?? index}`} className="py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900">{activityLabel(entry.type)}</p>
            <p className="text-xs text-slate-500 truncate">{referralTitle(entry)}</p>
          </div>
          <span className="text-xs font-bold text-slate-500">{formatPartnerDate(entry.at ?? null)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Dashboard section. The payload is normalized on entry, so a partial or empty
 * answer (rolling schema upgrade, a backend that answered `{}`) renders the
 * honest '—'/empty states below instead of throwing during render — a throw
 * here would blank the entire partner area through the root ErrorBoundary.
 */
export const GrowthPartnerDashboard: React.FC<{
  dashboard: PartnerDashboardData | null;
  displayName: string;
  email: string;
  accentHex?: string;
  onRetry?: () => void;
  refreshing?: boolean;
  refreshError?: string | null;
}> = ({ dashboard, displayName, email, accentHex = '#C20E5A', onRetry, refreshing = false, refreshError }) => {
  const data = normalizePartnerDashboardData(dashboard);
  return (
  <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-bold text-slate-900">Dashboard</h2>
      {onRetry && (
        <button
          type="button"
          onClick={() => onRetry()}
          disabled={refreshing}
          aria-label="Refresh dashboard"
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      )}
    </div>
    {refreshError && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{refreshError} Showing previously loaded totals. Use Refresh to retry.</p>}
    {refreshing && <p className="text-xs font-bold text-slate-500">Refreshing…</p>}

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <PartnerProfileCard dashboard={data} displayName={displayName} email={email} accentHex={accentHex} />
      <ReferralCodeCard code={data.partner.referral_code} />
    </div>

    <section aria-label="Referral summary" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <KpiCard label="Total Referrals" value={countLabel(data.totalReferrals ?? data.kpis.total_referrals)} />
      <KpiCard label="Active Referrals" value={countLabel(data.activeReferrals ?? data.referral_status_counts?.active)} />
      <KpiCard label="Pending Referrals" value={countLabel(data.pendingReferrals ?? data.referral_status_counts?.pending)} />
      <KpiCard label="Converted Referrals" value={countLabel(data.convertedReferrals ?? data.referral_status_counts?.converted)} />
    </section>

    <p className="text-xs text-slate-500">Registered accounts only. Inactive, cancelled and rejected referrals remain in the total but are excluded from active, pending and converted counts.</p>

    <PartnerReferralActivity activity={data.referralActivity ?? data.recent_activity} />

    <section aria-label="Recent activity" className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
      <h2 className="text-base font-bold text-slate-900">Recent activity</h2>
      <ActivityList activity={data.recent_activity} />
    </section>
  </div>
  );
};

// ---------------------------------------------------------------------------
// Referrals + Customers (same backend rows, different presentations)
// ---------------------------------------------------------------------------

export interface PartnerListSectionProps {
  list: PartnerReferralList | null;
  loading: boolean;
  error: string | null;
  filter: PartnerReferralFilter;
  onFilterChange: (next: PartnerReferralFilter) => void;
  onPage: (nextOffset: number) => void;
  onRetry: () => void;
}

/** Accessible count tabs; arrow keys/Home/End move focus and activate a filter. */
export function ReferralStatusTabs({ value, counts, onChange, panelId }: {
  value: ReferralStatusTab;
  /** Partial on purpose: an uncounted status renders '—', never a fake 0. */
  counts?: Partial<ReferralStatusCounts>;
  onChange?: (next: ReferralStatusTab) => void;
  panelId: string;
}) {
  return (
    <div role="tablist" aria-label="Referral status" className="flex flex-wrap gap-2">
      {REFERRAL_STATUS_TABS.map((status, index) => (
        <button key={status} type="button" role="tab" id={`${panelId}-tab-${status}`}
          aria-controls={panelId} aria-selected={value === status} tabIndex={value === status ? 0 : -1}
          disabled={!onChange}
          onClick={() => onChange?.(status)}
          onKeyDown={event => {
            let next: number;
            if (event.key === 'ArrowRight') next = (index + 1) % REFERRAL_STATUS_TABS.length;
            else if (event.key === 'ArrowLeft') next = (index + REFERRAL_STATUS_TABS.length - 1) % REFERRAL_STATUS_TABS.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = REFERRAL_STATUS_TABS.length - 1;
            else return;
            event.preventDefault();
            document.getElementById(`${panelId}-tab-${REFERRAL_STATUS_TABS[next]}`)?.focus();
            onChange?.(REFERRAL_STATUS_TABS[next]);
          }}
          className={`rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${value === status ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
          {status === 'all' ? 'All' : referralStatusDescriptor(status).label} ({counts?.[status] ?? '—'})
        </button>
      ))}
    </div>
  );
}

// Responsive, privacy-minimized referred users table (Sections 9–10).
export const GrowthPartnerReferrals: React.FC<
  Omit<PartnerListSectionProps, 'filter' | 'onFilterChange'> & {
    referralCode?: string | null;
    filtersActive?: boolean;
    onApplyFilters?: (filters: ReferralFilters, clearStatus?: boolean) => void;
    statusTab?: ReferralStatusTab;
    onStatusTabChange?: (next: ReferralStatusTab) => void;
  }
> = ({ list, loading, error, onPage, onRetry, statusTab = 'all' as ReferralStatusTab, onStatusTabChange, filtersActive = false, onApplyFilters, referralCode }) => {
  const [filtersResetKey, setFiltersResetKey] = useState(0);
  const [selectedReferral, setSelectedReferral] = useState<string | null>(null);
  const closeDetails = useCallback(() => setSelectedReferral(null), []);
  const panelId = useId();
  // Normalized on entry: rows/counters/pager values are always well-formed, so
  // a partial payload renders the empty state instead of crashing the render.
  const view = list ? normalizePartnerReferralList(list) : null;
  return (
    <section aria-label="Referred users" aria-busy={loading} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold text-slate-900">Referred Users</h2>
        <button
          type="button"
          onClick={onRetry}
          disabled={loading}
          aria-label="Refresh referred users"
          title="Refresh referred users"
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </button>
      </div>
      {onApplyFilters && <ReferralSearchControls onApply={onApplyFilters} resetKey={filtersResetKey} />}
      <ReferralStatusTabs value={statusTab} counts={view?.status_counts} onChange={onStatusTabChange} panelId={panelId} />
      <div role="tabpanel" id={panelId} aria-labelledby={`${panelId}-tab-${statusTab}`} aria-busy={loading} tabIndex={0}>
      {loading ? (
        <SectionLoading label="Loading referred users…" />
      ) : error ? (
        <div role="alert"><SectionError message={error} onRetry={onRetry} /></div>
      ) : !view ? (
        <SectionLoading label="Loading referred users…" />
      ) : view.total === 0 ? (
        <ReferralEmptyState
          filtered={filtersActive || statusTab !== 'all'}
          referralCode={referralCode}
          onClear={onApplyFilters || onStatusTabChange ? () => {
            setFiltersResetKey(value => value + 1);
            if (onApplyFilters) onApplyFilters({ ...DEFAULT_REFERRAL_FILTERS }, true);
            else onStatusTabChange?.('all');
          } : undefined}
        />
      ) : (
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <p className="mb-4 text-xs text-slate-500">Contact details are masked for privacy. Converted means the user completed their website, not a payment. Last activity shows referral milestones only.</p>
          <ReferralTable rows={view.rows} onOpenDetails={setSelectedReferral} />
          <Pager total={view.total} limit={view.limit} offset={view.offset} onPage={onPage} />
        </div>
      )}
      </div>
      {selectedReferral && <ReferralDetailsDrawer referralId={selectedReferral} onClose={closeDetails} />}
    </section>
  );
};

export const GrowthPartnerCustomers: React.FC<
  PartnerListSectionProps & {
    search: string;
    onSearchChange: (next: string) => void;
    onSearchSubmit: () => void;
  }
> = ({ list, loading, error, filter, onFilterChange, onPage, onRetry, search, onSearchChange, onSearchSubmit }) => {
  if (loading && !list) return <SectionLoading label="Loading your customers…" />;
  if (error && !list) return <SectionError message={error} onRetry={onRetry} />;
  // Same normalization as the referrals section (identical backend rows).
  const view = list ? normalizePartnerReferralList(list) : null;
  if (view && view.total === 0 && filter === 'all' && !search.trim()) {
    return (
      <SectionEmpty title={GROWTH_PARTNER_NO_REFERRALS_TITLE} body={GROWTH_PARTNER_NO_REFERRALS_BODY} />
    );
  }
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <form
        role="search"
        aria-label="Search customers by name"
        onSubmit={(event) => {
          event.preventDefault();
          onSearchSubmit();
        }}
        className="flex gap-2"
      >
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search by customer name"
          aria-label="Search by customer name"
          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-2 focus:outline-offset-1 focus:outline-slate-900"
        />
        <button
          type="submit"
          className="inline-flex shrink-0 items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold cursor-pointer bg-slate-900 text-white transition-opacity hover:opacity-90"
        >
          <Search className="w-4 h-4" />
          Search
        </button>
      </form>
      <PartnerFilterPills value={filter} onChange={onFilterChange} />
      <section aria-label="Customers" className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-base font-bold text-slate-900">Customers</h2>
        {loading && <p className="mt-2 text-xs font-bold text-slate-500">Refreshing…</p>}
        {view && view.total === 0 ? (
          <p className="mt-4 text-sm text-slate-600">
            {search.trim() ? 'No customers match your search.' : 'No customers match this filter.'}
          </p>
        ) : (
          view && (
            <>
              <div className="mt-4">
                <ReferralTable rows={view.rows} showStarted={false} />
              </div>
              <Pager total={view.total} limit={view.limit} offset={view.offset} onPage={onPage} />
            </>
          )
        )}
      </section>
    </motion.div>
  );
};

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

/**
 * Performance section. The aggregates and the monthly series are normalized on
 * entry, so a missing/partial payload renders '—' and an empty history rather
 * than throwing inside the `.map` (which would take down the whole route via
 * the root ErrorBoundary).
 */
export const GrowthPartnerPerformance: React.FC<{
  performance: PartnerPerformanceData | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}> = ({ performance, loading, error, onRetry }) => {
  if (loading && !performance) return <SectionLoading label="Loading your performance…" />;
  if (error && !performance) return <SectionError message={error} onRetry={onRetry} />;
  if (!performance) {
    return (
      <SectionEmpty title={GROWTH_PARTNER_NO_PERFORMANCE_TITLE} body={GROWTH_PARTNER_NO_PERFORMANCE_BODY} />
    );
  }
  const data = normalizePartnerPerformanceData(performance);
  if (data.total_referrals === 0) {
    return (
      <SectionEmpty title={GROWTH_PARTNER_NO_PERFORMANCE_TITLE} body={GROWTH_PARTNER_NO_PERFORMANCE_BODY} />
    );
  }
  // Bar widths only visualize backend values (proportional layout, no business math).
  const maxPoint = Math.max(1, ...data.monthly.map((point) => Math.max(point.referred, point.completed)));
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <section aria-label="Performance summary" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Referrals" value={countLabel(data.total_referrals)} />
        <KpiCard label="Completed" value={countLabel(data.completed)} />
        <KpiCard label="Completion Rate" value={percentLabel(data.completion_rate_pct)} />
        <KpiCard label="Websites Started" value={countLabel(data.websites_started)} />
      </section>
      <section aria-label="Monthly performance" className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-base font-bold text-slate-900">Last 6 months</h2>
        {data.monthly.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">Monthly history is not available yet.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {data.monthly.map((point, index) => (
              <li key={point.month || `month-${index}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-bold text-slate-900">{formatMonthLabel(point.month)}</p>
                  <p className="text-xs font-bold text-slate-500">
                    {point.referred} referred · {point.completed} completed
                  </p>
                </div>
                <div className="mt-2 space-y-1.5" aria-hidden="true">
                  <div className="h-2 rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full bg-slate-900"
                      style={{ width: `${(point.referred / maxPoint) * 100}%` }}
                    />
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full bg-emerald-500"
                      style={{ width: `${(point.completed / maxPoint) * 100}%` }}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </motion.div>
  );
};

// ---------------------------------------------------------------------------
// Commission (honest empty state — no partner commission model exists yet)
// ---------------------------------------------------------------------------

export const GrowthPartnerCommission: React.FC = () => (
  <SectionEmpty title={GROWTH_PARTNER_NO_COMMISSION_TITLE} body={GROWTH_PARTNER_NO_COMMISSION_BODY} />
);

// ---------------------------------------------------------------------------
// Legacy presentational profile summary; the live route uses GrowthPartnerProfilePage.
// ---------------------------------------------------------------------------

export const GrowthPartnerProfile: React.FC<{
  dashboard: PartnerDashboardData;
  displayName: string;
  email: string;
  accentHex?: string;
}> = ({ dashboard, displayName, email, accentHex = '#C20E5A' }) => {
  const data = normalizePartnerDashboardData(dashboard);
  return (
  <div className="space-y-4">
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <PartnerProfileCard dashboard={data} displayName={displayName} email={email} accentHex={accentHex} />
      <ReferralCodeCard code={data.partner.referral_code} />
    </div>
    <section aria-label="Account details" className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
      <h2 className="text-base font-bold text-slate-900">Account details</h2>
      <dl className="mt-4 divide-y divide-slate-100 text-sm">
        <div className="py-3 flex flex-wrap items-center justify-between gap-2">
          <dt className="font-bold text-slate-500">Display name</dt>
          <dd className="font-bold text-slate-900">{displayName}</dd>
        </div>
        <div className="py-3 flex flex-wrap items-center justify-between gap-2">
          <dt className="font-bold text-slate-500">Email</dt>
          <dd className="font-bold text-slate-900 break-all">{email || '—'}</dd>
        </div>
        <div className="py-3 flex flex-wrap items-center justify-between gap-2">
          <dt className="font-bold text-slate-500">Status</dt>
          <dd className="font-bold text-slate-900">{data.partner.is_active === true ? 'Active' : data.partner.is_active === false ? 'Paused' : '—'}</dd>
        </div>
        <div className="py-3 flex flex-wrap items-center justify-between gap-2">
          <dt className="font-bold text-slate-500">Partner since</dt>
          <dd className="font-bold text-slate-900">{formatPartnerDate(data.partner.partner_since ?? null)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-slate-500">
        Partner details are managed by the platform. Account sign-in settings live in the main app.
      </p>
    </section>
  </div>
  );
};
