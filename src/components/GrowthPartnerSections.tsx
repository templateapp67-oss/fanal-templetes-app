import React, { useCallback, useState } from 'react';
import { GrowthPartnerMilestones } from './GrowthPartnerMilestones';
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
  copyReferralCodeToClipboard,
  GROWTH_PARTNER_REFERRAL_CODE_UNAVAILABLE,
  growthReferralStatusLabel,
  PARTNER_ACTIVITY_LABELS,
  PARTNER_REFERRAL_FILTER_LABELS,
  type GrowthOnboardingStatusValue,
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
// growthReferralStatusLabel. Each section owns loading / error / empty /
// success states; data fetching lives in GrowthPartnerPage.
// ============================================================================

export const GROWTH_PARTNER_NO_REFERRALS_TITLE = 'No referrals yet.';
export const GROWTH_PARTNER_NO_REFERRALS_BODY =
  'Your referrals will appear here once users join with your referral code.';
export const GROWTH_PARTNER_NO_COMMISSION_TITLE = 'No commission earned yet.';
export const GROWTH_PARTNER_NO_COMMISSION_BODY =
  'Partner commissions are not configured yet. When a commission model is available, earned amounts and history will appear here.';
export const GROWTH_PARTNER_NO_PERFORMANCE_TITLE = 'No performance data yet.';
export const GROWTH_PARTNER_NO_PERFORMANCE_BODY = 'Performance data will appear as referrals progress.';

export function formatPartnerDate(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString();
}

function formatMonthLabel(month: string): string {
  const parsed = new Date(`${month}-01T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return month;
  return parsed.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function activityLabel(type: string): string {
  return (PARTNER_ACTIVITY_LABELS as Record<string, string>)[type] ?? 'Referral update';
}

function referralTitle(row: Pick<PartnerReferralEntry, 'ref' | 'display_name'>): string {
  const name = (row.display_name || '').trim();
  return name || `Referred user ${row.ref}`;
}

// ---------------------------------------------------------------------------
// Shared atoms
// ---------------------------------------------------------------------------

/** Status pill — the single place referral statuses become UI (one mapping). */
export function ReferralStatusPill({ status }: { status: GrowthOnboardingStatusValue | null }) {
  const tone =
    status === 'template_completed'
      ? 'bg-emerald-100 text-emerald-800'
      : status === 'template_started'
        ? 'bg-sky-100 text-sky-800'
        : status === 'linked'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${tone}`}>
      {growthReferralStatusLabel(status)}
    </span>
  );
}

export function SectionLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="text-center bg-white rounded-3xl border border-slate-200 shadow-sm px-6 py-14">
      <Loader2 className="w-8 h-8 text-slate-400 animate-spin mx-auto mb-4" />
      <p className="text-sm font-bold text-slate-700">{label}</p>
    </div>
  );
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

export function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
      <p className="text-3xl font-black text-slate-900">{value}</p>
      <p className="mt-1 text-sm font-bold text-slate-600">{label}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
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
  if (total <= 0) return null;
  const from = Math.min(offset + 1, total);
  const to = Math.min(offset + limit, total);
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs font-bold text-slate-500" aria-live="polite">
        Showing {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPage(Math.max(0, offset - limit))}
          disabled={!hasPrev}
          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-4 h-4" />
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPage(offset + limit)}
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
  const [copied, setCopied] = useState(false);
  const value = typeof code === 'string' ? code.trim() : '';
  const copy = useCallback(async () => {
    // Copies ONLY the referral code — never ids, links or metadata. The helper
    // reports whether the write actually happened, so a missing/rejected
    // clipboard never shows a fake "Copied" state.
    const ok = await copyReferralCodeToClipboard(value);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }, [value]);

  if (!value) {
    return (
      <section aria-label="Your referral code" className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">Your referral code</h2>
        <p className="mt-3 text-sm font-bold text-slate-700">{GROWTH_PARTNER_REFERRAL_CODE_UNAVAILABLE}</p>
        <p className="mt-3 text-xs text-slate-500">
          Your code is managed by the platform and cannot be changed here.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Your referral code" className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
      <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">Your referral code</h2>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <code className="text-2xl font-black tracking-[0.2em] text-slate-900 select-all">{value}</code>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90"
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 w-4" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
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
                dashboard.partner.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
              }`}
            >
              {dashboard.partner.is_active ? 'Active' : 'Paused'}
            </span>
            <span className="text-xs text-slate-500">Partner since {formatPartnerDate(dashboard.partner.partner_since)}</span>
          </p>
        </div>
      </div>
      {!dashboard.partner.is_active && (
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

function ActivityList({ activity }: { activity: PartnerActivityEntry[] }) {
  if (activity.length === 0) {
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
      {activity.map((entry, index) => (
        <li key={`${entry.type}-${entry.ref}-${entry.at ?? index}`} className="py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900">{activityLabel(entry.type)}</p>
            <p className="text-xs text-slate-500 truncate">{referralTitle(entry)}</p>
          </div>
          <span className="text-xs font-bold text-slate-500">{formatPartnerDate(entry.at)}</span>
        </li>
      ))}
    </ul>
  );
}

export const GrowthPartnerDashboard: React.FC<{
  dashboard: PartnerDashboardData;
  displayName: string;
  email: string;
  accentHex?: string;
  onRetry?: () => void;
  refreshing?: boolean;
}> = ({ dashboard, displayName, email, accentHex = '#C20E5A', onRetry, refreshing = false }) => (
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
    {refreshing && <p className="text-xs font-bold text-slate-500">Refreshing…</p>}

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <PartnerProfileCard dashboard={dashboard} displayName={displayName} email={email} accentHex={accentHex} />
      <ReferralCodeCard code={dashboard.partner.referral_code} />
    </div>

    <section aria-label="Referral summary" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <KpiCard label="Total Referrals" value={String(dashboard.kpis.total_referrals)} />
      <KpiCard label="Active Onboarding" value={String(dashboard.kpis.active_onboarding ?? '—')} />
      <KpiCard label="Completed Customers" value={String(dashboard.kpis.completed ?? '—')} />
    </section>

    <GrowthPartnerMilestones shopCount={dashboard.kpis.onboarded_shops} />
    <section aria-label="Recent activity" className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
      <h2 className="text-base font-bold text-slate-900">Recent activity</h2>
      <ActivityList activity={dashboard.recent_activity} />
    </section>
  </div>
);

// ---------------------------------------------------------------------------
// Referrals + Customers (same backend rows, different presentations)
// ---------------------------------------------------------------------------

function ReferralTable({ rows, showStarted }: { rows: PartnerReferralEntry[]; showStarted: boolean }) {
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-widest text-slate-500 border-b border-slate-100">
            <th scope="col" className="py-2 pr-4 font-bold">
              {showStarted ? 'Referral' : 'Customer'}
            </th>
            <th scope="col" className="py-2 pr-4 font-bold">
              Status
            </th>
            <th scope="col" className="py-2 pr-4 font-bold">
              {showStarted ? 'Linked' : 'Joined'}
            </th>
            {showStarted && (
              <th scope="col" className="py-2 pr-4 font-bold">
                Website started
              </th>
            )}
            <th scope="col" className="py-2 font-bold">
              Completed
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={`${row.ref}-${row.linked_at ?? 'na'}`}>
              <td className="py-3 pr-4">
                <p className="font-bold text-slate-900">{referralTitle(row)}</p>
                {row.display_name?.trim() && <p className="font-mono text-xs text-slate-500">{row.ref}</p>}
              </td>
              <td className="py-3 pr-4">
                <ReferralStatusPill status={row.status} />
              </td>
              <td className="py-3 pr-4 text-slate-600">{formatPartnerDate(row.linked_at)}</td>
              {showStarted && <td className="py-3 pr-4 text-slate-600">{formatPartnerDate(row.template_started_at)}</td>}
              <td className="py-3 text-slate-600">{formatPartnerDate(row.template_completed_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface PartnerListSectionProps {
  list: PartnerReferralList | null;
  loading: boolean;
  error: string | null;
  filter: PartnerReferralFilter;
  onFilterChange: (next: PartnerReferralFilter) => void;
  onPage: (nextOffset: number) => void;
  onRetry: () => void;
}

// Referred users deliberately omit onboarding status and milestone UI (Part 2.5).
export const GrowthPartnerReferrals: React.FC<
  Omit<PartnerListSectionProps, 'filter' | 'onFilterChange'>
> = ({ list, loading, error, onPage, onRetry }) => {
  return (
    <section aria-label="Referred users" aria-busy={loading} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold text-slate-900">Referred Users</h2>
        <button
          type="button"
          onClick={onRetry}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </button>
      </div>
      {loading ? (
        <SectionLoading label="Loading referred users…" />
      ) : error ? (
        <div role="alert"><SectionError message={error} onRetry={onRetry} /></div>
      ) : !list ? (
        <SectionLoading label="Loading referred users…" />
      ) : list.total === 0 ? (
        <SectionEmpty title="No referred users yet." body={GROWTH_PARTNER_NO_REFERRALS_BODY} />
      ) : (
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <ul aria-label="Referred user list" className="divide-y divide-slate-100">
            {list.rows.map((row) => (
              <li key={row.ref + '-' + row.linked_at} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                <div className="min-w-0">
                  <p className="break-words font-bold text-slate-900">{referralTitle(row)}</p>
                  <p className="font-mono text-xs text-slate-500">Reference: {row.ref}</p>
                </div>
                <p className="shrink-0 text-sm text-slate-600">
                  Referred: {formatPartnerDate(row.linked_at)}
                </p>
              </li>
            ))}
          </ul>
          <Pager total={list.total} limit={list.limit} offset={list.offset} onPage={onPage} />
        </div>
      )}
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
  if (list && list.total === 0 && filter === 'all' && !search.trim()) {
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
        {list && list.total === 0 ? (
          <p className="mt-4 text-sm text-slate-600">
            {search.trim() ? 'No customers match your search.' : 'No customers match this filter.'}
          </p>
        ) : (
          list && (
            <>
              <div className="mt-4">
                <ReferralTable rows={list.rows} showStarted={false} />
              </div>
              <Pager total={list.total} limit={list.limit} offset={list.offset} onPage={onPage} />
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

export const GrowthPartnerPerformance: React.FC<{
  performance: PartnerPerformanceData | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}> = ({ performance, loading, error, onRetry }) => {
  if (loading && !performance) return <SectionLoading label="Loading your performance…" />;
  if (error && !performance) return <SectionError message={error} onRetry={onRetry} />;
  if (!performance || performance.total_referrals === 0) {
    return (
      <SectionEmpty title={GROWTH_PARTNER_NO_PERFORMANCE_TITLE} body={GROWTH_PARTNER_NO_PERFORMANCE_BODY} />
    );
  }
  // Bar widths only visualize backend values (proportional layout, no business math).
  const maxPoint = Math.max(1, ...performance.monthly.map((point) => Math.max(point.referred, point.completed)));
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <section aria-label="Performance summary" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Referrals" value={String(performance.total_referrals)} />
        <KpiCard label="Completed" value={String(performance.completed)} />
        <KpiCard label="Completion Rate" value={`${performance.completion_rate_pct}%`} />
        <KpiCard label="Websites Started" value={String(performance.websites_started)} />
      </section>
      <section aria-label="Monthly performance" className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-base font-bold text-slate-900">Last 6 months</h2>
        <ul className="mt-4 space-y-4">
          {performance.monthly.map((point) => (
            <li key={point.month}>
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
// Profile (read-only — the existing model has no partner-editable fields)
// ---------------------------------------------------------------------------

export const GrowthPartnerProfile: React.FC<{
  dashboard: PartnerDashboardData;
  displayName: string;
  email: string;
  accentHex?: string;
}> = ({ dashboard, displayName, email, accentHex = '#C20E5A' }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <PartnerProfileCard dashboard={dashboard} displayName={displayName} email={email} accentHex={accentHex} />
      <ReferralCodeCard code={dashboard.partner.referral_code} />
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
          <dd className="font-bold text-slate-900">{dashboard.partner.is_active ? 'Active' : 'Paused'}</dd>
        </div>
        <div className="py-3 flex flex-wrap items-center justify-between gap-2">
          <dt className="font-bold text-slate-500">Partner since</dt>
          <dd className="font-bold text-slate-900">{formatPartnerDate(dashboard.partner.partner_since)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-slate-500">
        Partner details are managed by the platform. Account sign-in settings live in the main app.
      </p>
    </section>
  </div>
);
