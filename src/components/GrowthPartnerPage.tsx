import { PartnerRouteGuard, usePartnerRouteGuard } from './PartnerRouteGuard';
export * from './PartnerStatusScreen';
import { GrowthPartnerProfilePage } from './GrowthPartnerProfilePage';
import { PartnerCommissionPage, PartnerRewardsPage } from './PartnerRewardsCommission';
import { PartnerEarningsPage, PartnerLeaderboardsPage, PartnerLevelsPage, PartnerMarketingMaterialsPage, PartnerNotificationsPage, PartnerSupportPage, PartnerWithdrawalsPage } from './partner';
import { DEFAULT_REFERRAL_FILTERS, referralDateBounds, type ReferralFilters } from '../lib/referralFilters';
import type { ReferralStatusTab } from '../lib/referralStatus';
import React, { useEffect, useState } from 'react';
import { ArrowLeft, LogOut } from 'lucide-react';
import {
  fetchMyGrowthPartnerRow,
  fetchMyGrowthPartnerApplication,
  fetchMyPartnerDashboard,
  fetchMyPartnerPerformance,
  fetchMyPartnerReferrals,
  isSessionExpiredError,
  isPartnerSuspendedError,
  toSafePartnerSectionError,
  type GrowthPartner,
  type PartnerDashboardData,
  type PartnerPerformanceData,
  type PartnerReferralFilter,
  type PartnerReferralList,
} from '../lib/growthPartner';
import { isMockSupabase, supabase } from '../lib/supabaseClient';
import {
  GROWTH_PARTNER_SECTIONS,
  growthPartnerLoginPath,
  growthPartnerPath,
  isGrowthPartnerLoginPath,
  isPartnerLoginPath,
  isPartnerPortalPath,
  matchGrowthPartnerRoute,
  matchPartnerPortalRoute,
  PARTNER_DASHBOARD_PATH,
  PARTNER_LOGIN_PATH,
  type GrowthPartnerSection,
  type PartnerPortalSection,
} from '../lib/router';
import { PARTNER_PORTAL_UNAUTHORIZED_BODY } from '../lib/partnerPortalAuth';
import { GrowthPartnerLogin } from './GrowthPartnerLogin';
import { PartnerPortalLogin } from './PartnerPortalLogin';
import {
  PartnerPortalShell,
  partnerPortalContentSection,
} from './PartnerPortalShell';
import {
  PartnerReferralCodeSection,
  PartnerReferralStatusSection,
} from './PartnerPortalSections';
import {
  GrowthPartnerCustomers,
  GrowthPartnerDashboard,
  GrowthPartnerPerformance,
  GrowthPartnerReferrals,
  SectionError,
  SectionLoading,
} from './GrowthPartnerSections';

// ============================================================================
// Growth Partner area — `/partner/...` (PART 2 canonical) with the legacy
// `/growth-partner/...` routes as an alias of the SAME module.
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

export const GROWTH_PARTNER_SECTION_LABELS: Record<GrowthPartnerSection, string> = {
  dashboard: 'Dashboard',
  referrals: 'Referrals',
  customers: 'Customers',
  performance: 'Performance',
  commission: 'Commission',
  profile: 'Profile',
};

export function GrowthPartnerSectionTabs({
  section,
  navigate,
  accentHex,
  pathFor,
}: {
  section: GrowthPartnerSection;
  navigate?: (to: string) => void;
  accentHex: string;
  /** Section→URL resolver. Defaults to the legacy /growth-partner paths. */
  pathFor?: (section: GrowthPartnerSection) => string;
}) {
  const resolve = pathFor ?? growthPartnerPath;
  return (
    <nav aria-label="Growth Partner sections" className="mt-4 -mb-px flex gap-1 overflow-x-auto">
      {GROWTH_PARTNER_SECTIONS.map((key) => {
        const active = key === section;
        return (
          <button
            key={key}
            type="button"
            onClick={() => navigate?.(resolve(key))}
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
  /** Section→URL resolver for the tab links (see GrowthPartnerSectionTabs). */
  pathFor?: (section: GrowthPartnerSection) => string;
  /** Label of the back link (the /partner/* portal says "Back to app"). */
  backLabel?: string;
  children?: React.ReactNode;
}> = ({ section, displayName, navigate, onBack, onLogout, accentHex = '#C20E5A', pathFor, backLabel = 'Back to dashboard', children }) => (
  <main className="min-w-0 max-w-6xl mx-auto px-4 py-8">
    <header className="mb-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onBack?.()}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            {backLabel}
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
      <GrowthPartnerSectionTabs section={section} navigate={navigate} accentHex={accentHex} pathFor={pathFor} />
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
  // PART 2: the same component serves two namespaces — the legacy
  // `/growth-partner/...` routes and the canonical `/partner/...` portal.
  // Only the URLs differ; the auth, the backend reads and the gate are shared.
  const isPartnerNamespace = isPartnerPortalPath(path);
  const portalSection: PartnerPortalSection = matchPartnerPortalRoute(path);
  const legacySection: GrowthPartnerSection = matchGrowthPartnerRoute(path);
  const section = isPartnerNamespace ? portalSection : legacySection;
  /**
   * What the active section renders. The legacy namespace renders its
   * section ids directly; the /partner/* portal maps its menu sections to the
   * same content (referral-status → the filterable list, referral-code → the
   * dedicated code + share-link section). Data effects key off this value, so
   * each page fetches exactly what it shows.
   */
  const contentSection: GrowthPartnerSection | 'referral-code' | 'rewards' | PartnerPortalSection = isPartnerNamespace
    ? partnerPortalContentSection(portalSection)
    : legacySection;
  const isLoginPath = isPartnerLoginPath(path) || isGrowthPartnerLoginPath(path);
  /** Login route for the active namespace (where the gate sends visitors). */
  const loginRoute = isPartnerNamespace ? PARTNER_LOGIN_PATH : growthPartnerLoginPath();
  /** Section URLs for the legacy namespace's section tabs. */
  const sectionPathFor = growthPartnerPath;
  const userId = user?.id || null;

  // Gate: RLS decides authorization (non-partners get zero rows → unauthorized).
  const [savedProfileName, setSavedProfileName] = useState<{ owner: string; name: string } | null>(null);
  const [savedProfileAvatar, setSavedProfileAvatar] = useState('');
  const [partner, setPartner] = useState<GrowthPartner | null>(null);
  const [gateLoading, setGateLoading] = useState(true);
  const [verifiedFor, setVerifiedFor] = useState<string | null>(null);
  const [applicationStatus, setApplicationStatus] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Section data (each fetched once per visit from its backend RPC).
  const [dashboardState, setDashboard] = useState<SectionState<PartnerDashboardData>>(initialSectionState);
  const [dashboardOwner, setDashboardOwner] = useState<string | null>(null);
  const dashboard = dashboardOwner === userId ? dashboardState : initialSectionState<PartnerDashboardData>();
  const [referrals, setReferrals] = useState<SectionState<PartnerReferralList>>(initialSectionState);
  const [customers, setCustomers] = useState<SectionState<PartnerReferralList>>(initialSectionState);
  const [performance, setPerformance] = useState<SectionState<PartnerPerformanceData>>(initialSectionState);

  // Server-side list controls (filter/search/page all re-query the backend).
  const [referralRefreshKey, setReferralRefreshKey] = useState(0);
  const [referralOwner, setReferralOwner] = useState<string | null>(null);
  const [referralOffset, setReferralOffset] = useState(0);
  const [referralStatusTab, setReferralStatusTab] = useState<ReferralStatusTab>('all');
  const [referralFilters, setReferralFilters] = useState<ReferralFilters>({ ...DEFAULT_REFERRAL_FILTERS });
  useEffect(() => {
    setReferralFilters({ ...DEFAULT_REFERRAL_FILTERS });
    setReferralStatusTab('all');
    setReferralOffset(0);
    setCustomers(initialSectionState());
    setPerformance(initialSectionState());
  }, [userId]);
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
        const application = row ? null : await fetchMyGrowthPartnerApplication();
        if (cancelled) return;
        setPartner(row);
        setApplicationStatus(application?.status ?? null);
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        setPartner(null);
        setLoadError(err);
      } finally {
        if (!cancelled) { setVerifiedFor(userId); setGateLoading(false); }
      }
    })();
    return () => {
      cancelled = true;
    };
    // `onRequireAuth` is intentionally not a dependency (inline arrow at call site).
  }, [userId, reloadKey, isLoginPath]); // eslint-disable-line react-hooks/exhaustive-deps

  const gate = usePartnerRouteGuard({
    userId, loading: gateLoading, isMockMode: isMockSupabase,
    partnerRow: partner, loadError, applicationStatus, verifiedFor,
    isLoginPath, loginRoute, navigate,
  });
  const ready = gate === 'ready';

  // Canonicalize the bare portal root to the dashboard URL, so `/partner`
  // and `/partner/dashboard` are one screen with one shareable address.
  useEffect(() => {
    if (ready && isPartnerNamespace && path === '/partner') {
      navigate?.(PARTNER_DASHBOARD_PATH);
    }
  }, [ready, isPartnerNamespace, path, navigate]);

  // A session dying mid-section returns to the page-level session gate instead
  // of stranding the section on an error card.
  const noteSectionFailure = (error: unknown): string | null => {
    if (isPartnerSuspendedError(error)) {
      setLoadError(error);
      return null;
    }
    if (isSessionExpiredError(error)) {
      setPartner(null);
      setLoadError(error);
      return null;
    }
    return toSafePartnerSectionError(error).message;
  };

  // In the /partner/* portal the dashboard RPC is read on every section: it
  // feeds the page content (dashboard/profile), the Referral Status KPI chips
  // AND the header's notifications dropdown (recent activity). The legacy
  // namespace keeps its per-section fetches.
  const wantsDashboardData = isPartnerNamespace
    ? true
    : contentSection === 'dashboard' || contentSection === 'profile';

  useEffect(() => {
    if (!ready || !wantsDashboardData) return;
    let cancelled = false;
    setDashboardOwner(userId);
    setDashboard((prev) => ({ data: dashboardOwner === userId ? prev.data : null, loading: true, error: null }));
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
  }, [ready, wantsDashboardData, userId, reloadKey]);

  useEffect(() => {
    if (!ready || contentSection !== 'referrals') return;
    let cancelled = false;
    setReferralOwner(userId);
    // Preserve the last successful counts across filters/pages, never across owners.
    setReferrals(prev => ({ data: referralOwner === userId ? prev.data : null, loading: true, error: null }));
    (async () => {
      try {
        const data = await fetchMyPartnerReferrals({
          search: referralFilters.search || undefined,
          conversion: referralFilters.conversion, sort: referralFilters.sort,
          ...referralDateBounds(referralFilters),
          status: referralStatusTab === 'active' ? 'in_progress' : referralStatusTab === 'converted' ? 'completed' : referralStatusTab,
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
  }, [ready, contentSection, userId, referralOffset, referralStatusTab, referralFilters, referralRefreshKey, reloadKey]);

  useEffect(() => {
    if (!ready || contentSection !== 'customers') return;
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
  }, [ready, contentSection, customerFilter, customerSearch, customerOffset, reloadKey]);

  useEffect(() => {
    if (!ready || contentSection !== 'performance') return;
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
  }, [ready, contentSection, reloadKey]);

  // The login route is a separate surface of the same namespace: render the
  // dedicated login screen (email + password → backend role verification).
  // The /partner/* portal uses the PART 2 login page (logo, show/hide
  // password, Remember me, Forgot Password, success redirect to
  // /partner/dashboard); the legacy namespace keeps its original screen.
  if (isLoginPath) {
    if (isPartnerNamespace) {
      return <PartnerPortalLogin user={user} navigate={navigate} onBack={onBack} accentHex={accentHex} />;
    }
    return <GrowthPartnerLogin user={user} navigate={navigate} onBack={onBack} accentHex={accentHex} />;
  }

  if (gate !== 'ready') return <PartnerRouteGuard
    gate={gate} loadingReferralLink={contentSection === 'referral-code'}
    onBack={onBack} onRetry={() => setReloadKey(key => key + 1)}
    onSignIn={() => navigate?.(loginRoute)} error={loadError}
    unauthorizedBody={isPartnerNamespace ? PARTNER_PORTAL_UNAUTHORIZED_BODY : undefined}
  />;

  const email = typeof user?.email === 'string' ? user.email : '';
  const metadataName = user?.user_metadata?.full_name;
  const displayName =
    (savedProfileName?.owner === userId && savedProfileName.name) ||
    (typeof metadataName === 'string' && metadataName.trim()) || email.split('@')[0] || 'Growth Partner';
  const retrySection = () => setReloadKey((key) => key + 1);

  const renderSection = () => {
    switch (contentSection) {
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
            refreshError={dashboard.error}
          />
        ) : null;
      case 'referral-code':
        return (
          <PartnerReferralCodeSection
            loading={gateLoading}
            code={partner ? partner.referral_code : null}
            isActive={partner ? partner.is_active : true}
          />
        );
      case 'referrals':
        return (
          <div key={userId}><GrowthPartnerReferrals
            list={referralOwner === userId ? referrals.data : null}
            loading={referralOwner !== userId || referrals.loading}
            error={referralOwner === userId ? referrals.error : null}
            statusTab={referralStatusTab}
            onStatusTabChange={next => {
              if (next === referralStatusTab) return;
              setReferrals(prev => ({ ...prev, loading: true, error: null }));
              setReferralStatusTab(next);
              setReferralOffset(0);
            }}
            referralCode={partner?.referral_code}
            filtersActive={!!referralFilters.search || referralFilters.datePreset !== 'all' || referralFilters.conversion !== 'all'}
            onApplyFilters={(next, clearStatus) => {
              setReferrals(prev => ({ ...prev, loading: true, error: null }));
              setReferralFilters(next);
              setReferralOffset(0);
              if (clearStatus) setReferralStatusTab('all');
            }}
            onPage={setReferralOffset}
            onRetry={() => setReferralRefreshKey((key) => key + 1)}
          /></div>
        );
      case 'customers': {
        const customersSection = (
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
        // The portal's Referral Status page frames the same real list with
        // KPI chips and a status legend; the legacy page keeps its layout.
        return isPartnerNamespace ? (
          <PartnerReferralStatusSection
            dashboard={dashboard.data}
            loading={dashboard.loading}
          >
            {customersSection}
          </PartnerReferralStatusSection>
        ) : (
          customersSection
        );
      }
      case 'performance':
        return (
          <GrowthPartnerPerformance
            performance={performance.data}
            loading={performance.loading}
            error={performance.error}
            onRetry={retrySection}
          />
        );
      case 'rewards':
        return <PartnerRewardsPage />;
      case 'commission':
        return <PartnerCommissionPage />;
      // The seven promoted sections. Each page owns its own reads (see
      // src/lib/partnerPortalOperations.ts), so switching sections never
      // refetches another module's data; the values below are display-only
      // context from the session — a code for the share link, an id to
      // highlight the partner's own leaderboard row.
      case 'earnings':
        return <PartnerEarningsPage accentHex={accentHex} navigate={navigate} />;
      case 'withdrawals':
        return <PartnerWithdrawalsPage accentHex={accentHex} />;
      case 'marketing-materials':
        return <PartnerMarketingMaterialsPage accentHex={accentHex} referralCode={partner?.referral_code ?? null} />;
      case 'partner-levels':
        return <PartnerLevelsPage accentHex={accentHex} />;
      case 'leaderboards':
        return <PartnerLeaderboardsPage accentHex={accentHex} partnerId={userId ?? undefined} />;
      case 'notifications':
        return <PartnerNotificationsPage accentHex={accentHex} />;
      case 'support':
        return <PartnerSupportPage accentHex={accentHex} />;
      case 'profile':
        return <div key={userId}><GrowthPartnerProfilePage onProfileChange={saved => {
          if (saved.partner_id === userId) setSavedProfileName({ owner: saved.partner_id, name: saved.full_name });
          if (saved.partner_id === userId && saved.photo_path) setSavedProfileAvatar(supabase.storage.from('partner-avatars').getPublicUrl(saved.photo_path).data.publicUrl);
          if (saved.partner_id === userId && !saved.photo_path) setSavedProfileAvatar('');
        }} /></div>;
      case 'account-settings':
        return <div key={userId}><GrowthPartnerProfilePage onProfileChange={saved => {
          if (saved.partner_id === userId && saved.photo_path) setSavedProfileAvatar(supabase.storage.from('partner-avatars').getPublicUrl(saved.photo_path).data.publicUrl);
        }} /></div>;
      default:
        return null;
    }
  };

  // The /partner/* portal renders the Part 2.2 dashboard shell (sidebar +
  // header + main; drawer on mobile). The legacy /growth-partner/* namespace
  // keeps its original top-tabs shell — same content, same backend checks.
  if (isPartnerNamespace) {
    return (
      <PartnerPortalShell
        section={portalSection}
        displayName={displayName}
        email={email}
        // The Partner ID shown in the header is the signed-in partner's own
        // auth id (the growth_partners row is keyed by it) — a display value
        // from the session, never an input to any backend read.
        partnerId={userId ?? undefined}
        avatarUrl={savedProfileAvatar}
        notifications={dashboard.data ? dashboard.data.recent_activity : []}
        notificationsLoading={dashboard.loading && !dashboard.data}
        navigate={navigate ?? (() => {})}
        onLogout={() => onLogout?.()}
        accentHex={accentHex}
      >
        {renderSection()}
      </PartnerPortalShell>
    );
  }

  return (
    <GrowthPartnerShell
      section={section}
      displayName={displayName}
      navigate={navigate}
      onBack={onBack}
      onLogout={onLogout}
      accentHex={accentHex}
      pathFor={sectionPathFor}
    >
      {renderSection()}
    </GrowthPartnerShell>
  );
};
