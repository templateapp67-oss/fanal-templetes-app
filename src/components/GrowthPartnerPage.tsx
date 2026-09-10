import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  Inbox,
  Loader2,
  LogIn,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import {
  fetchMyGrowthPartnerRow,
  fetchMyGrowthReferrals,
  growthReferralStatusLabel,
  resolveGrowthPartnerGate,
  summarizeGrowthReferrals,
  type GrowthPartner,
  type GrowthReferralRow,
} from '../lib/growthPartner';
import { isMockSupabase } from '../lib/supabaseClient';
import {
  GROWTH_PARTNER_SECTIONS,
  growthPartnerPath,
  matchGrowthPartnerRoute,
  type GrowthPartnerSection,
} from '../lib/router';

// ============================================================================
// Growth Partner area — `/growth-partner/...`.
//
// Same Supabase Auth, same database, same backend as the Template App. Access
// is enforced by the Phase 1 RLS model (SELECT-own-row-only on
// growth_partners; own-referrals-only on growth_onboarding): this page only
// renders the outcome — a normal signed-in user gets zero partner rows and
// therefore the "unauthorized" state, never another partner's data.
//
// Dashboard is real in this phase; Referrals / Customers / Performance /
// Commission are explicit placeholders (routes resolve; no fake features).
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
  accentHex?: string;
}

export const GROWTH_PARTNER_SIGNIN_TITLE = 'Sign in to open the Growth Partner area';
export const GROWTH_PARTNER_SIGNIN_BODY =
  'Growth Partner tools are tied to your account, so we can only show them once you are signed in.';
export const GROWTH_PARTNER_UNAUTHORIZED_TITLE = 'Growth Partners only';
export const GROWTH_PARTNER_UNAUTHORIZED_BODY =
  'This account is not registered as a Growth Partner. If you were invited as one, sign in with that account.';
export const GROWTH_PARTNER_EMPTY_TITLE = 'No referrals yet.';
export const GROWTH_PARTNER_EMPTY_BODY =
  'Share your referral code. New users who join with it will appear here with their onboarding progress.';
export const GROWTH_PARTNER_ERROR_TITLE = 'Could not load the Growth Partner area';
export const GROWTH_PARTNER_SESSION_TITLE = 'Your session expired';
export const GROWTH_PARTNER_SESSION_BODY = 'Please sign in again to continue to the Growth Partner area.';
export const GROWTH_PARTNER_MOCK_TITLE = 'Growth Partner area needs a live connection';
export const GROWTH_PARTNER_MOCK_BODY =
  'This area reads real partner data from Supabase, which is not connected in this preview. No demo numbers are shown.';
export const GROWTH_PARTNER_COMING_SOON_BODY =
  'This module is not implemented yet in this phase. Nothing here is functional — check back later.';

export const GROWTH_PARTNER_SECTION_LABELS: Record<GrowthPartnerSection, string> = {
  dashboard: 'Dashboard',
  referrals: 'Referrals',
  customers: 'Customers',
  performance: 'Performance',
  commission: 'Commission',
};

export function growthPartnerComingSoonTitle(section: GrowthPartnerSection): string {
  return `${GROWTH_PARTNER_SECTION_LABELS[section]} is coming soon.`;
}

function initialsFor(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'GP';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString();
}

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

export const GrowthPartnerMockNotice: React.FC<{ onBack?: () => void }> = ({ onBack }) => (
  <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
    <StateCard
      icon={<AlertCircle className="w-7 h-7 text-slate-400" />}
      title={GROWTH_PARTNER_MOCK_TITLE}
      body={GROWTH_PARTNER_MOCK_BODY}
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

export const GrowthPartnerComingSoon: React.FC<{ section: GrowthPartnerSection }> = ({ section }) => (
  <motion.div
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    className="text-center bg-white rounded-3xl border border-slate-200 shadow-sm px-6 py-14"
  >
    <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
      <Inbox className="w-8 h-8 text-slate-400" />
    </div>
    <h2 className="text-lg font-bold text-slate-900">{growthPartnerComingSoonTitle(section)}</h2>
    <p className="text-sm text-slate-600 mt-1.5">{GROWTH_PARTNER_COMING_SOON_BODY}</p>
  </motion.div>
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

function ReferralCodeCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [code]);
  return (
    <section aria-label="Your referral code" className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
      <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">Your referral code</h2>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <code className="text-2xl font-black tracking-[0.2em] text-slate-900 select-all">{code}</code>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold cursor-pointer bg-slate-100 text-slate-800 transition-opacity hover:opacity-90"
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
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

export const GrowthPartnerDashboard: React.FC<{
  partner: GrowthPartner;
  referrals: GrowthReferralRow[];
  displayName: string;
  email: string;
  accentHex?: string;
}> = ({ partner, referrals, displayName, email, accentHex = '#C20E5A' }) => {
  const summary = useMemo(() => summarizeGrowthReferrals(referrals), [referrals]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    partner.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {partner.is_active ? 'Active' : 'Paused'}
                </span>
                <span className="text-xs text-slate-500">Partner since {formatDate(partner.created_at)}</span>
              </p>
            </div>
          </div>
          {!partner.is_active && (
            <p className="mt-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              Your code is currently paused: existing referrals stay linked, but new users cannot join with it.
            </p>
          )}
        </section>
        <ReferralCodeCard code={partner.referral_code} />
      </div>

      <section aria-label="Referral summary" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total referred', value: summary.total },
          { label: 'Onboarding now', value: summary.onboarding },
          { label: 'Completed', value: summary.completed },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
            <p className="text-3xl font-black text-slate-900">{stat.value}</p>
            <p className="mt-1 text-sm font-bold text-slate-600">{stat.label}</p>
          </div>
        ))}
      </section>

      <section aria-label="Recent referrals" className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-base font-bold text-slate-900">Recent referrals</h2>
        {referrals.length === 0 ? (
          <div className="text-center px-6 py-10">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <Inbox className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-base font-bold text-slate-900">{GROWTH_PARTNER_EMPTY_TITLE}</h3>
            <p className="text-sm text-slate-600 mt-1.5">{GROWTH_PARTNER_EMPTY_BODY}</p>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 max-h-96 overflow-y-auto">
            {referrals.map((row) => (
              <li key={row.user_id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900">
                    Referred user <span className="font-mono font-semibold text-slate-500">…{row.user_id.slice(-8)}</span>
                  </p>
                  <p className="text-xs text-slate-500">Linked {formatDate(row.linked_at)}</p>
                </div>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                    row.status === 'template_completed'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-sky-100 text-sky-800'
                  }`}
                >
                  {growthReferralStatusLabel(row.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export const GrowthPartnerPage: React.FC<GrowthPartnerPageProps> = ({
  user,
  onRequireAuth,
  onBack,
  path = '/growth-partner',
  navigate,
  accentHex = '#C20E5A',
}) => {
  const section = matchGrowthPartnerRoute(path);
  const userId = user?.id || null;
  const [partner, setPartner] = useState<GrowthPartner | null>(null);
  const [referrals, setReferrals] = useState<GrowthReferralRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!userId || isMockSupabase) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        // RLS decides authorization: a non-partner gets zero rows (null).
        const row = await fetchMyGrowthPartnerRow();
        if (cancelled) return;
        setPartner(row);
        if (row) {
          const rows = await fetchMyGrowthReferrals(row.user_id);
          if (cancelled) return;
          setReferrals(rows);
        } else {
          setReferrals([]);
        }
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        setPartner(null);
        setReferrals([]);
        setLoadError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `onRequireAuth` is intentionally not a dependency (inline arrow at call site).
  }, [userId, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const gate = resolveGrowthPartnerGate({
    userId,
    loading,
    isMockMode: isMockSupabase,
    partnerRow: partner,
    loadError,
  });

  if (gate === 'loading') return <GrowthPartnerLoading />;
  if (gate === 'unauthenticated')
    return <GrowthPartnerSignInPrompt onRequireAuth={onRequireAuth} accentHex={accentHex} />;
  if (gate === 'unauthorized') return <GrowthPartnerUnauthorized onBack={onBack} />;
  if (gate === 'mock-mode') return <GrowthPartnerMockNotice onBack={onBack} />;
  if (gate === 'session-expired')
    return (
      <GrowthPartnerLoadError
        title={GROWTH_PARTNER_SESSION_TITLE}
        body={GROWTH_PARTNER_SESSION_BODY}
        actionLabel="Sign in again"
        onAction={() => onRequireAuth?.('login')}
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

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <header className="mb-2">
        <button
          type="button"
          onClick={() => onBack?.()}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </button>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Growth Partner</h1>
        <p className="text-sm text-slate-600">Your referral code, referrals and onboarding progress.</p>
        <GrowthPartnerSectionTabs section={section} navigate={navigate} accentHex={accentHex} />
      </header>

      <div className="mt-4">
        {section === 'dashboard' && partner ? (
          <GrowthPartnerDashboard
            partner={partner}
            referrals={referrals}
            displayName={displayName}
            email={email}
            accentHex={accentHex}
          />
        ) : (
          <GrowthPartnerComingSoon section={section} />
        )}
      </div>
    </main>
  );
};
