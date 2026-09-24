import React from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Inbox, RefreshCw } from 'lucide-react';
import { PartnerLoading } from '../PartnerLoading';
import { PartnerStatCard } from '../PartnerStatCard';
import { partnerQueryErrorMessage } from '../../lib/partnerPortalQueries';
import { PartnerAreaFailurePanel } from '../PartnerAreaFailurePanel';
import type { PartnerAreaFailure } from '../../lib/partnerAreaFailure';

// ============================================================================
// Shared building blocks for the Growth Partner portal's operational sections.
//
// These are the pieces every promoted module needs, written once so the pages
// stay short and the portal keeps ONE visual language: the dark/gradient module
// header, a white `rounded-3xl` card with a titled header row and an optional
// action, the stat grid (the dashboard's PartnerStatCard), a table shell with a
// horizontally scrollable body, and the three states a real backend forces you
// into — loading, empty, failed-with-retry.
//
// `data-partner-module` / `data-partner-card` hooks exist for the DOM tests:
// they pin that a page rendered ITS section rather than a shared fallback.
// ============================================================================

export const PARTNER_ACCENT = '#C20E5A';

/** Module header: eyebrow + title + description, dark or brand-gradient. */
export const PartnerModuleHeader: React.FC<{
  eyebrow: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
  /** `gradient` is the brand pink used by Rewards; `dark` is the neutral hero. */
  tone?: 'dark' | 'gradient';
  children?: React.ReactNode;
}> = ({ eyebrow, title, description, icon: Icon, actions, tone = 'dark', children }) => (
  <section
    data-partner-module-header={tone}
    className={`overflow-hidden rounded-3xl p-6 text-white shadow-xl sm:p-8 ${
      tone === 'gradient'
        ? 'bg-gradient-to-br from-[#8b0a46] via-[#c20e5a] to-[#ed176f]'
        : 'bg-gradient-to-br from-slate-950 to-[#4a0726]'
    }`}
  >
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 max-w-2xl">
        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-pink-200">{eyebrow}</p>
        <h2 className="mt-2 text-2xl font-black leading-tight sm:text-3xl">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-200">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        <span aria-hidden="true" className="hidden h-12 w-12 items-center justify-center rounded-2xl bg-white/10 sm:flex">
          <Icon className="h-6 w-6 text-pink-200" />
        </span>
      </div>
    </div>
    {children ? <div className="mt-6">{children}</div> : null}
  </section>
);

export type PartnerModuleButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost';

const BUTTON_VARIANTS: Record<PartnerModuleButtonVariant, string> = {
  primary: 'bg-slate-900 text-white hover:opacity-90',
  accent: 'text-white hover:opacity-90',
  secondary: 'bg-white text-slate-800 border border-slate-200 hover:bg-slate-50',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100',
};

const BUTTON_BASE =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50';

/** The portal's action button. `variant="accent"` picks up the tenant colour. */
export const PartnerModuleButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  variant?: PartnerModuleButtonVariant;
  type?: 'button' | 'submit';
  disabled?: boolean;
  accentHex?: string;
  className?: string;
  title?: string;
  'data-partner-action'?: string;
}> = ({ children, onClick, variant = 'primary', type = 'button', disabled, accentHex, className = '', title, ...rest }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`}
    style={variant === 'accent' ? { backgroundColor: accentHex || PARTNER_ACCENT } : undefined}
    {...rest}
  >
    {children}
  </button>
);

/** White card with a titled header row, optional action, optional footer. */
export const PartnerModuleCard: React.FC<{
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  /** Set when the card body must pad itself (tables pad in their own cells). */
  padded?: boolean;
  footer?: React.ReactNode;
  id?: string;
  children: React.ReactNode;
}> = ({ title, description, actions, padded = true, footer, id, children }) => (
  <section
    data-partner-card={id || 'card'}
    className="min-w-0 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
  >
    {title || actions ? (
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
        <div className="min-w-0">
          {title ? <h3 className="text-base font-black text-slate-950">{title}</h3> : null}
          {description ? <p className="mt-1 text-xs text-slate-500">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
    ) : null}
    <div className={padded ? 'p-5' : ''}>{children}</div>
    {footer ? <footer className="border-t border-slate-100 bg-slate-50/60 p-5">{footer}</footer> : null}
  </section>
);

/** Stat grid on top of the dashboard's card so KPIs match every other page. */
export const PartnerStatGrid: React.FC<{
  stats: Array<{ label: string; value: string; hint?: string }>;
  columns?: 2 | 3 | 4;
}> = ({ stats, columns = 3 }) => (
  <section
    data-partner-stat-grid={columns}
    className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${columns === 2 ? 'lg:grid-cols-2' : columns === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}
  >
    {stats.map((stat) => (
      <PartnerStatCard key={stat.label} label={stat.label} value={stat.value} hint={stat.hint} />
    ))}
  </section>
);

/**
 * Table shell: a real <table> with a sticky-look header, a horizontally
 * scrollable body for narrow screens and a11y-safe captions.
 */
export const PartnerTable: React.FC<{
  caption: string;
  columns: string[];
  rows: React.ReactNode[];
  empty?: React.ReactNode;
  minWidth?: string;
}> = ({ caption, columns, rows, empty, minWidth = 'min-w-[680px]' }) => {
  if (!rows.length && empty) return <>{empty}</>;
  return (
    <div className="overflow-x-auto">
      <table className={`w-full ${minWidth} text-left text-sm`}>
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wide text-slate-500">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="p-4">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
};

export const PartnerTableRow: React.FC<{ children: React.ReactNode; highlighted?: boolean }> = ({
  children,
  highlighted = false,
}) => (
  <tr className={`border-t border-slate-100 ${highlighted ? 'bg-pink-50/60' : ''}`}>{children}</tr>
);

const STATUS_TONES: Record<string, string> = {
  paid: 'bg-emerald-50 text-emerald-700',
  resolved: 'bg-emerald-50 text-emerald-700',
  available_for_withdrawal: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-amber-50 text-amber-800',
  in_review: 'bg-amber-50 text-amber-800',
  in_progress: 'bg-amber-50 text-amber-800',
  open: 'bg-slate-100 text-slate-700',
  held: 'bg-orange-50 text-orange-700',
  cancelled: 'bg-slate-100 text-slate-600',
  rejected: 'bg-rose-50 text-rose-700',
  reversed: 'bg-rose-50 text-rose-700',
};

/** Ledger/payout/ticket status as a pill — colours reused across all pages. */
export const PartnerStatusPill: React.FC<{ status: string; label: string }> = ({ status, label }) => (
  <span
    data-partner-status={status}
    className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ${
      STATUS_TONES[status] || 'bg-slate-100 text-slate-700'
    }`}
  >
    {label}
  </span>
);

/**
 * The `[data-partner-module]` marker wraps EVERY state of a section — loading,
 * failed or full of rows — so anything that locates a module (the shell's
 * scroll-to, an inspection test, an analytics event) never has to care which
 * state it caught.
 */
export const PartnerModuleFrame: React.FC<{ module?: string; children: React.ReactNode }> = ({
  module,
  children,
}) => (module ? <div data-partner-module={module} className="space-y-5">{children}</div> : <>{children}</>);

export const PartnerSectionLoading: React.FC<{
  label: string;
  kind?: React.ComponentProps<typeof PartnerLoading>['kind'];
  module?: string;
}> = ({ label, kind, module }) => (
  <PartnerModuleFrame module={module}>
    <PartnerLoading label={label} kind={kind} />
  </PartnerModuleFrame>
);

/** Honest empty state — the copy says WHY it is empty, never "coming soon". */
export const PartnerSectionEmpty: React.FC<{
  title: string;
  body: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
}> = ({ title, body, icon: Icon = Inbox, action }) => (
  <div data-partner-empty={title} className="px-6 py-12 text-center">
    <span aria-hidden="true" className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
      <Icon className="h-7 w-7 text-slate-400" />
    </span>
    <p className="mt-4 text-base font-black text-slate-900">{title}</p>
    <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-500">{body}</p>
    {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
  </div>
);

/**
 * Failure state with retry. `note` carries the schema/hint text when known.
 *
 * On top of the message, a section that failed through the Growth Partner
 * service gets the classified cause (`failure`): who has to act, what the next
 * step is, and a live diagnostic — so a refused grant or a missing migration
 * never reads as "try again".
 */
export const PartnerSectionError: React.FC<{
  error: unknown;
  onRetry: () => void;
  title?: string;
  module?: string;
  /** Classified cause from the service layer (see `usePartnerServiceQuery`). */
  failure?: PartnerAreaFailure | null;
}> = ({ error, onRetry, title = 'This section could not load', module, failure = null }) => {
  const message = partnerQueryErrorMessage(error);
  return (
    <PartnerModuleFrame module={module}>
      <div role="alert" className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-center">
        <span aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white">
          <AlertCircle className="h-6 w-6 text-rose-600" />
        </span>
        <p className="mt-3 text-base font-black text-rose-900">{title}</p>
        <p className="mx-auto mt-1.5 max-w-xl whitespace-pre-line text-sm text-rose-800">{message}</p>
        <PartnerAreaFailurePanel
          error={error}
          failure={failure}
          onRetry={onRetry}
          className="mx-auto mt-5 max-w-xl rounded-2xl border border-rose-200 bg-white p-4 text-left"
        />
        <button
          type="button"
          data-partner-retry
          onClick={onRetry}
          className={`${BUTTON_BASE} mx-auto mt-5 bg-rose-700 text-white hover:bg-rose-800`}
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    </PartnerModuleFrame>
  );
};

/** Inline banner for non-blocking failures (a refresh that failed over data). */
export const PartnerInlineNotice: React.FC<{ message: string; tone?: 'warn' | 'error' | 'success' }> = ({
  message,
  tone = 'warn',
}) => (
  <p
    role={tone === 'error' ? 'alert' : 'status'}
    aria-live="polite"
    className={`rounded-2xl px-4 py-3 text-sm font-semibold ${
      tone === 'error'
        ? 'bg-rose-50 text-rose-800'
        : tone === 'success'
          ? 'bg-emerald-50 text-emerald-800'
          : 'bg-amber-50 text-amber-900'
    }`}
  >
    {message}
  </p>
);

/** Labeled form field shell so inputs/looks stay identical across pages. */
export const PartnerField: React.FC<{
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  children: React.ReactNode;
}> = ({ label, hint, error, htmlFor, children }) => (
  <div className="min-w-0">
    <label htmlFor={htmlFor} className="block text-xs font-black uppercase tracking-wide text-slate-500">
      {label}
    </label>
    <div className="mt-2">{children}</div>
    {error ? (
      <p className="mt-1.5 text-xs font-bold text-rose-600">{error}</p>
    ) : hint ? (
      <p className="mt-1.5 text-xs text-slate-500">{hint}</p>
    ) : null}
  </div>
);

export const PARTNER_INPUT_CLASS =
  'w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-semibold text-slate-900 outline-none transition-colors focus:border-slate-400 focus:ring-2 focus:ring-slate-200';

/**
 * Page-by-page control for the ledger reads, which are `limit`/`offset` scoped
 * and return no row total: `hasMore` is "the page came back full", which is all
 * the partner needs to know before pressing Next. Copy never claims a total the
 * backend did not answer.
 */
export const PartnerPageControls: React.FC<{
  page: number;
  rowCount: number;
  pageSize: number;
  hasMore: boolean;
  onPage: (nextPage: number) => void;
}> = ({ page, rowCount, pageSize, hasMore, onPage }) => {
  const from = page * pageSize + 1;
  const to = page * pageSize + rowCount;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs font-bold text-slate-500" aria-live="polite">
        {rowCount ? `Showing ${from}–${to} of your newest records` : 'Nothing on this page'}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPage(Math.max(0, page - 1))}
          disabled={page === 0}
          className="inline-flex min-h-10 cursor-pointer items-center gap-1 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-800 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={!hasMore}
          className="inline-flex min-h-10 cursor-pointer items-center gap-1 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-800 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

/** Small chip filter (statuses, asset categories, notification types). */
export const PartnerFilterChip: React.FC<{
  label: string;
  active: boolean;
  onSelect: () => void;
  accentHex?: string;
}> = ({ label, active, onSelect, accentHex }) => (
  <button
    type="button"
    onClick={onSelect}
    aria-pressed={active}
    className={`inline-flex min-h-10 cursor-pointer items-center rounded-full px-3.5 text-xs font-black transition-colors ${
      active ? 'text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
    }`}
    style={active ? { backgroundColor: accentHex || PARTNER_ACCENT } : undefined}
  >
    {label}
  </button>
);
