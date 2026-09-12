import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, ArrowLeft, Loader2, LogIn, LogOut, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  fetchMyGrowthPartnerRow,
  fetchMyPartnerDashboard,
  fetchMyPartnerPerformance,
  fetchMyPartnerReferrals,
  GROWTH_PARTNER_INACTIVE_BODY,
  GROWTH_PARTNER_INACTIVE_TITLE,
  isSessionExpiredError,
  resolveGrowthPartnerGate,
  toSafePartnerSectionError,
  type GrowthPartner,
  type PartnerDashboardData,
  type PartnerPerformanceData,
  type PartnerReferralFilter,
  type PartnerReferralList,
} from '../lib/growthPartner';
import { isMockSupabase, supabaseConfig } from '../lib/supabaseClient';
import {
  GROWTH_PARTNER_SECTIONS,
  growthPartnerLoginPath,
  growthPartnerPath,
  isGrowthPartnerLoginPath,
  matchGrowthPartnerRoute,
  type GrowthPartnerSection,
} from '../lib/router';
import { GrowthPartnerLogin } from './GrowthPartnerLogin';
import {
  GrowthPartnerCommission,
  GrowthPartnerCustomers,
  GrowthPartnerDashboard,
  GrowthPartnerPerformance,
  GrowthPartnerProfile,
  GrowthPartnerReferrals,
  SectionError,
  SectionLoading,
} from './GrowthPartnerSections';

// ============================================================================
// Growth Partner area — `/growth-partner/...`.
//
// Same Supabase Auth, same database, same backend as the Template App.
// Authorization is enforced by the backend in two layers: the Phase 1 RLS
// model gates this page (SELECT-own-row-only on growth_partners — a normal
// signed-in user gets zero rows and therefore the "unauthorized" state), and
// the Phase 6 dashboard RPCs independently derive the partner from
// auth.uid() and return only that partner's own referrals. This page only
// renders outcomes — it never passes a partner id and never filters by
// partner, so URL manipulation cannot reach another partner's data.
// ============================================================================

export interface GrowthPartnerPageProps {
  user?: { id?: string; email?: string; user_metadata?: Record<string, any> } | null;
  /** Opens the existing login/signup flow. */
  onRequireAuth?: (mode?: 'login' | 'signup') => void;
  /** Back to the main app (dashboard). */
  onBack?: () => void;
  /** Current path (drives the section, so refresh/deep links work). */
  path?: string;
  /** Navigate to another Growth Partner section. */
  navigate?: (to: string) => void;
  /** Log out via the existing Supabase Auth flow (clears the session). */
  onLogout?: () => void;
  accentHex?: string;
}

export const GROWTH_PARTNER_SIGNIN_TITLE = 'Sign in to open the Growth Partner area';
export const GROWTH_PARTNER_SIGNIN_BODY =
  'Growth Partner tools are tied to your account, so we can only show them once you are signed in.';
export const GROWTH_PARTNER_UNAUTHORIZED_TITLE = 'Growth Partners only';
export const GROWTH_PARTNER_UNAUTHORIZED_BODY =
  'This account is not registered as a Growth Partner. If you were invited as one, sign in with that account.';
export const GROWTH_PARTNER_ERROR_TITLE = 'Could not load the Growth Partner area';
export const GROWTH_PARTNER_SESSION_TITLE = 'Your session expired';
export const GROWTH_PARTNER_SESSION_BODY = 'Please sign in again to continue to the Growth Partner area.';
export const GROWTH_PARTNER_MOCK_TITLE = 'Growth Partner area needs a live connection';
export const GROWTH_PARTNER_MOCK_BODY =
  'This area reads real partner data from Supabase, which is not connected in this preview. No demo numbers are shown.';

export const GROWTH_PARTNER_SECTION_LABELS: Record<GrowthPartnerSection, string> = {
  dashboard: 'Dashboard',
  referrals: 'Referrals',
  customers: 'Customers',
  performance: 'Performance',
  commission: 'Commission',
  profile: 'Profile',
};

function errorMessage(error: unknown): string {
  const message = (error as { message?: string } | null)?.message;
  return typeof message === 'string' && message ? message : 'Please try again.';
}

function StateCard({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-md w-full text-center bg-white rounded-3xl border border-slate-200 shadow-sm p-8"
    >
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
        {icon}
      </div>
      <h1 className="text-xl font-bold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-600 mt-2">{body}</p>
      {children}
    </motion.div>
  );
}

export const GrowthPartnerSignInPrompt: React.FC<{
  onRequireAuth?: (mode?: 'login' | 'signup') => void;
  accentHex?: string;
}> = ({ onRequireAuth, accentHex = '#C20E5A' }) => (
  <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
    <StateCard
      icon={<LogIn className="w-7 h-7 text-slate-400" />}
      title={GROWTH_PARTNER_SIGNIN_TITLE}
      body={GROWTH_PARTNER_SIGNIN_BODY}
    >
      <button
        type="button"
        onClick={() => onRequireAuth?.('login')}
        className="mt-6 w-full py-3 rounded-xl text-white text-sm font-bold cursor-pointer transition-opacity hover:opacity-90"
        style={{ backgroundColor: accentHex }}
      >
        Sign in
      </button>
    </StateCard>
  </main>
);

export const GrowthPartnerUnauthorized: React.FC<{ onBack?: () => void }> = ({ onBack }) => (
  <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
    <StateCard
      icon={<ShieldAlert className="w-7 h-7 text-slate-400" />}
      title={GROWTH_PARTNER_UNAUTHORIZED_TITLE}
      body={GROWTH_PARTNER_UNAUTHORIZED_BODY}
    >
      <button
        type="button"
        onClick={() => onBack?.()}
        className="mt-6 w-full py-3 rounded-xl text-sm font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90"
      >
        Back to dashboard
      </button>
    </StateCard>
  </main>
);

export const GrowthPartnerInactive: React.FC<{ onBack?: () => void }> = ({ onBack }) => (
  <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
    <StateCard
      icon={<ShieldAlert className="w-7 h-7 text-slate-400" />}
      title={GROWTH_PARTNER_INACTIVE_TITLE}
      body={GROWTH_PARTNER_INACTIVE_BODY}
    >
      <button
        type="button"
        onClick={() => onBack?.()}
        className="mt-6 w-full py-3 rounded-xl text-sm font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90"
      >
        Back to dashboard
      </button>
    </StateCard>
  </main>
);

export const GrowthPartnerLoadError: React.FC<{
  title: string;
  body: string;
  actionLabel: string;
  onAction?: () => void;
}> = ({ title, body, actionLabel, onAction }) => (
  <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
    <StateCard icon={<AlertCircle className="w-7 h-7 text-rose-500" />} title={title} body={body}>
      <button
        type="button"
        onClick={() => onAction?.()}
        className="mt-6 w-full py-3 rounded-xl text-white text-sm font-bold cursor-pointer transition-opacity hover:opacity-90 inline-flex items-center justify-center gap-2 bg-slate-900"
      >
        <RefreshCw className="w-4 h-4" />
        {actionLabel}
      </button>
    </StateCard>
  </main>
);

export const GrowthPartnerMockNotice: React.FC<{ onBack?: () => void; issues?: string[] }> = ({
  onBack,
  issues = supabaseConfig.issues,
}) => (
  <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
    <StateCard
      icon={<AlertCircle className="w-7 h-7 text-slate-400" />}
      title={GROWTH_PARTNER_MOCK_TITLE}
      body={GROWTH_PARTNER_MOCK_BODY}
    >
      {/* Actionable, not a dead end: name what is missing and the exact next
          step, so this screen is a setup instruction rather than a shrug. */}
      {issues.length > 0 && (
        <ul className="mt-5 space-y-1.5 text-left text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3">
          {issues.map((issue) => (
            <li key={issue} className="flex gap-2">
              <span aria-hidden="true">•</span>
              <span className="break-words">{issue}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 text-left text-xs text-slate-600">
        <p className="font-bold text-slate-800">To finish the setup</p>
        <ol className="mt-1.5 space-y-1 list-decimal list-inside">
          <li>
            Fill in the Supabase variables from <code className="font-mono">.env.example</code> in{' '}
            <code className="font-mono">.env</code>, then restart the app.
          </li>
          <li>
            Apply the Growth Partner migrations (order matters — see{' '}
            <code className="font-mono">GROWTH_PARTNER_SETUP.md</code>).
          </li>
          <li>
            Check it with <code className="font-mono">npm run verify:growth-partner</code>, then
            approve your account so the area unlocks.
          </li>
        </ol>
      </div>
      <button
        type="button"
        onClick={() => onBack?.()}
        className="mt-6 w-full py-3 rounded-xl text-sm font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90"
      >
        Back to dashboard
      </button>
    </StateCard>
  </main>
);

export const GrowthPartnerLoading: React.FC = () => (
  <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
    <div
      role="status"
      aria-label="Loading Growth Partner area"
      className="max-w-md w-full text-center bg-white rounded-3xl border border-slate-200 shadow-sm p-8"
    >
      <Loader2 className="w-8 h-8 text-slate-400 animate-spin mx-auto mb-4" />
      <p className="text-sm font-bold text-slate-700">Loading your partner area…</p>
    </div>
  </main>
);

export function GrowthPartnerSectionTabs({
  section,
  navigate,
  accentHex,
}: {
  section: GrowthPartnerSection;
  navigate?: (to: string) => void;
  accentHex: string;
}) {
  return (
    <nav aria-label="Growth Partner sections" className="mt-4 -mb-px flex gap-1 overflow-x-auto">
      {GROWTH_PARTNER_SECTIONS.map((key) => {
        const active = key === section;
        return (
          <button
            key={key}
            type="button"
            onClick={() => navigate?.(growthPartnerPath(key))}
            aria-current={active ? 'page' : undefined}
            className={`shrink-0 px-4 py-2.5 rounded-t-xl text-sm font-bold cursor-pointer border-b-2 transition-colors ${
              active
                ? 'text-slate-900 border-current bg-white'
                : 'text-slate-500 border-transparent hover:text-slate-800 hover:bg-white/60'
            }`}
            style={active ? { color: accentHex, borderColor: accentHex } : undefined}
          >
            {GROWTH_PARTNER_SECTION_LABELS[key]}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Growth Partner dashboard SHELL (Part 2.2) — header (back link + partner area
 * title + basic partner identity + logout action), navigation area (the section
 * tabs) and a main content slot. Rendered only after the authorization gate
 * reaches `ready` (authenticated ACTIVE partner). Responsive: the header wraps
 * on narrow screens and the tabs scroll horizontally instead of overflowing.
 */
export const GrowthPartnerShell: React.FC<{
  section: GrowthPartnerSection;
  displayName: string;
  navigate?: (to: string) => void;
  onBack?: () => void;
  onLogout?: () => void;
  accentHex?: string;
  children?: React.ReactNode;
}> = ({ section, displayName, navigate, onBack, onLogout, accentHex = '#C20E5A', children }) => (
  <main className="max-w-6xl mx-auto px-4 py-8">
    <header className="mb-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onBack?.()}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to dashboard
          </button>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Growth Partner</h1>
          <p className="mt-1 text-sm text-slate-600">
            Signed in as <span className="font-semibold text-slate-900">{displayName}</span>
          </p>
        </div>
        {onLogout && (
          <button
            type="button"
            onClick={() => onLogout()}
            title="Log out"
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        )}
      </div>
      <GrowthPartnerSectionTabs section={section} navigate={navigate} accentHex={accentHex} />
    </header>

    <div className="mt-4">{children}</div>
  </main>
);

const LIST_PAGE_SIZE = 20;

interface SectionState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function initialSectionState<T>(): SectionState<T> {
  return { data: null, loading: true, error: null };
}

export const GrowthPartnerPage: React.FC<GrowthPartnerPageProps> = ({
  user,
  onRequireAuth,
  onBack,
  path = '/growth-partner',
  navigate,
  onLogout,
  accentHex = '#C20E5A',
}) => {
  const section = matchGrowthPartnerRoute(path);
  const isLoginPath = isGrowthPartnerLoginPath(path);
  const userId = user?.id || null;

  // Gate: RLS decides authorization (non-partners get zero rows → unauthorized).
  const [partner, setPartner] = useState<GrowthPartner | null>(null);
  const [gateLoading, setGateLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Section data (each fetched once per visit from its backend RPC).
  const [dashboard, setDashboard] = useState<SectionState<PartnerDashboardData>>(initialSectionState);
  const [referrals, setReferrals] = useState<SectionState<PartnerReferralList>>(initialSectionState);
  const [customers, setCustomers] = useState<SectionState<PartnerReferralList>>(initialSectionState);
  const [performance, setPerformance] = useState<SectionState<PartnerPerformanceData>>(initialSectionState);

  // Server-side list controls (filter/search/page all re-query the backend).
  const [referralRefreshKey, setReferralRefreshKey] = useState(0);
  const [referralOwner, setReferralOwner] = useState<string | null>(null);
  const [referralOffset, setReferralOffset] = useState(0);
  const [customerFilter, setCustomerFilter] = useState<PartnerReferralFilter>('all');
  const [customerOffset, setCustomerOffset] = useState(0);
  const [customerSearchInput, setCustomerSearchInput] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!userId || isMockSupabase || isLoginPath) {
      // The login route performs its own role verification (GrowthPartnerLogin),
      // so the area gate stays quiet there and never double-fetches.
      setGateLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setGateLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const row = await fetchMyGrowthPartnerRow();
        if (cancelled) return;
        setPartner(row);
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        setPartner(null);
        setLoadError(err);
      } finally {
        if (!cancelled) setGateLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `onRequireAuth` is intentionally not a dependency (inline arrow at call site).
  }, [userId, reloadKey, isLoginPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const gate = resolveGrowthPartnerGate({
    userId,
    loading: gateLoading,
    isMockMode: isMockSupabase,
    partnerRow: partner,
    loadError,
  });
  const ready = gate === 'ready';

  // Unauthenticated visitors to the protected area are sent to the dedicated
  // login route. The login route renders its own screen (and only forwards
  // ACTIVE partners back to the area), so the two never chase each other.
  useEffect(() => {
    if (!isLoginPath && gate === 'unauthenticated') {
      navigate?.(growthPartnerLoginPath());
    }
  }, [isLoginPath, gate, navigate]);

  // A session dying mid-section returns to the page-level session gate instead
  // of stranding the section on an error card.
  const noteSectionFailure = (error: unknown): string | null => {
    if (isSessionExpiredError(error)) {
      setPartner(null);
      setLoadError(error);
      return null;
    }
    return toSafePartnerSectionError(error).message;
  };

  useEffect(() => {
    if (!ready || (section !== 'dashboard' && section !== 'profile')) return;
    let cancelled = false;
    setDashboard((prev) => ({ ...prev, loading: true, error: null }));
    (async () => {
      try {
        const data = await fetchMyPartnerDashboard();
        if (!cancelled) setDashboard({ data, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        const message = noteSectionFailure(err);
        if (message !== null) setDashboard((prev) => ({ ...prev, loading: false, error: message }));
        else setDashboard((prev) => ({ ...prev, loading: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, section, reloadKey]);

  useEffect(() => {
    if (!ready || section !== 'referrals') return;
    let cancelled = false;
    setReferralOwner(userId);
    setReferrals({ data: null, loading: true, error: null });
    (async () => {
      try {
        const data = await fetchMyPartnerReferrals({
          limit: LIST_PAGE_SIZE,
          offset: referralOffset,
        });
        if (cancelled) return;
        // A refresh may remove the last row on the current page.
        if (referralOffset > 0 && referralOffset >= data.total) {
          setReferralOffset(Math.max(0, Math.ceil(data.total / data.limit) - 1) * data.limit);
          return;
        }
        setReferrals({ data, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        const message = noteSectionFailure(err);
        if (message !== null) setReferrals((prev) => ({ ...prev, loading: false, error: message }));
        else setReferrals((prev) => ({ ...prev, loading: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, section, userId, referralOffset, referralRefreshKey, reloadKey]);

  useEffect(() => {
    if (!ready || section !== 'customers') return;
    let cancelled = false;
    setCustomers((prev) => ({ ...prev, loading: true, error: null }));
    (async () => {
      try {
        const data = await fetchMyPartnerReferrals({
          status: customerFilter,
          search: customerSearch || undefined,
          limit: LIST_PAGE_SIZE,
          offset: customerOffset,
        });
        if (!cancelled) setCustomers({ data, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        const message = noteSectionFailure(err);
        if (message !== null) setCustomers((prev) => ({ ...prev, loading: false, error: message }));
        else setCustomers((prev) => ({ ...prev, loading: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, section, customerFilter, customerSearch, customerOffset, reloadKey]);

  useEffect(() => {
    if (!ready || section !== 'performance') return;
    let cancelled = false;
    setPerformance((prev) => ({ ...prev, loading: true, error: null }));
    (async () => {
      try {
        const data = await fetchMyPartnerPerformance();
        if (!cancelled) setPerformance({ data, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        const message = noteSectionFailure(err);
        if (message !== null) setPerformance((prev) => ({ ...prev, loading: false, error: message }));
        else setPerformance((prev) => ({ ...prev, loading: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, section, reloadKey]);

  // The login route is a separate surface of the same namespace: render the
  // dedicated login screen (email + password → backend role verification).
  if (isLoginPath) {
    return <GrowthPartnerLogin user={user} navigate={navigate} onBack={onBack} accentHex={accentHex} />;
  }

  if (gate === 'loading') return <GrowthPartnerLoading />;
  if (gate === 'unauthenticated') return <GrowthPartnerLoading />; // redirects to the login route (effect above)
  if (gate === 'unauthorized') return <GrowthPartnerUnauthorized onBack={onBack} />;
  if (gate === 'inactive') return <GrowthPartnerInactive onBack={onBack} />;
  if (gate === 'mock-mode') return <GrowthPartnerMockNotice onBack={onBack} />;
  if (gate === 'session-expired')
    return (
      <GrowthPartnerLoadError
        title={GROWTH_PARTNER_SESSION_TITLE}
        body={GROWTH_PARTNER_SESSION_BODY}
        actionLabel="Sign in again"
        onAction={() => navigate?.(growthPartnerLoginPath())}
      />
    );
  if (gate === 'error')
    return (
      <GrowthPartnerLoadError
        title={GROWTH_PARTNER_ERROR_TITLE}
        body={errorMessage(loadError)}
        actionLabel="Retry"
        onAction={() => setReloadKey((key) => key + 1)}
      />
    );

  const email = typeof user?.email === 'string' ? user.email : '';
  const metadataName = user?.user_metadata?.full_name;
  const displayName =
    (typeof metadataName === 'string' && metadataName.trim()) || email.split('@')[0] || 'Growth Partner';
  const retrySection = () => setReloadKey((key) => key + 1);

  const renderSection = () => {
    switch (section) {
      case 'dashboard':
        if (dashboard.loading && !dashboard.data) return <SectionLoading label="Loading your dashboard…" />;
        if (dashboard.error && !dashboard.data)
          return <SectionError message={dashboard.error} onRetry={retrySection} />;
        return dashboard.data ? (
          <GrowthPartnerDashboard
            dashboard={dashboard.data}
            displayName={displayName}
            email={email}
            accentHex={accentHex}
            onRetry={retrySection}
            refreshing={dashboard.loading}
          />
        ) : null;
      case 'referrals':
        return (
          <GrowthPartnerReferrals
            list={referralOwner === userId ? referrals.data : null}
            loading={referralOwner !== userId || referrals.loading}
            error={referrals.error}
            onPage={setReferralOffset}
            onRetry={() => setReferralRefreshKey((key) => key + 1)}
          />
        );
      case 'customers':
        return (
          <GrowthPartnerCustomers
            list={customers.data}
            loading={customers.loading}
            error={customers.error}
            filter={customerFilter}
            onFilterChange={(next) => {
              setCustomerFilter(next);
              setCustomerOffset(0);
            }}
            onPage={setCustomerOffset}
            onRetry={retrySection}
            search={customerSearchInput}
            onSearchChange={setCustomerSearchInput}
            onSearchSubmit={() => {
              setCustomerSearch(customerSearchInput);
              setCustomerOffset(0);
            }}
          />
        );
      case 'performance':
        return (
          <GrowthPartnerPerformance
            performance={performance.data}
            loading={performance.loading}
            error={performance.error}
            onRetry={retrySection}
          />
        );
      case 'commission':
        return <GrowthPartnerCommission />;
      case 'profile':
        if (dashboard.loading && !dashboard.data) return <SectionLoading label="Loading your profile…" />;
        if (dashboard.error && !dashboard.data)
          return <SectionError message={dashboard.error} onRetry={retrySection} />;
        return dashboard.data ? (
          <GrowthPartnerProfile
            dashboard={dashboard.data}
            displayName={displayName}
            email={email}
            accentHex={accentHex}
          />
        ) : null;
      default:
        return null;
    }
  };

  return (
    <GrowthPartnerShell
      section={section}
      displayName={displayName}
      navigate={navigate}
      onBack={onBack}
      onLogout={onLogout}
      accentHex={accentHex}
    >
      {renderSection()}
    </GrowthPartnerShell>
  );
};
