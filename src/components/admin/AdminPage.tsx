// ============================================================================
// The /admin surface: one shell, one role resolution, one place that decides
// which panel a path renders.
//
// Three states, and the third is why this file exists at all:
//
//   1. `/admin/onboard-manager` — PUBLIC. The candidate has no session; the link
//      token is the authorization. Rendered before any auth check runs.
//   2. signed in AND an active admin_members row — the panels, scoped by role.
//   3. signed in but NOT staff — never a blank page and never a redirect to a
//      login screen (confusing for a salon owner). The panel says which account
//      is signed in and, depending on the project, shows one of:
//        a. schema missing  — how to apply supabase/apply_admin_management.sql;
//        b. no Super Admin yet — a one-click "Claim Super Admin access" button
//           (claim_first_super_admin(); SQL refuses it once any admin exists);
//        c. otherwise — the plain staff-only refusal.
//
// The role is read from SQL (`get_my_admin_access()`), so it cannot be raised by
// editing the URL, localStorage or a request body.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import {
  claimFirstSuperAdmin,
  fetchAdminSetupState,
  fetchMyAdminAccess,
  NO_ADMIN_ACCESS,
  type AdminAccess,
  type AdminApiError,
  type AdminSetupState,
} from '../../lib/adminApi';
import {
  adminPath,
  adminSectionLabel,
  ADMIN_ONBOARD_MANAGER_PATH,
  type AdminSection,
} from '../../lib/router';
import { AdminManagerOnboardingForm } from './AdminManagerOnboardingForm';
import { AdminManagerApplicationsPanel, AdminOnboardingLinksPanel } from './AdminOnboardingPanels';
import { AdminAuditPanel, AdminOverviewPanel, AdminPartnerDirectoryPanel, AdminPayoutsPanel } from './AdminDirectoryPanels';
import { roleLabel, SecurePanel } from './AdminSecurity';

interface AdminPageProps {
  path: string;
  search: string;
  navigate: (path: string) => void;
  user: { id: string; email?: string | null } | null;
  onLogout?: () => void;
  onRequireAuth?: () => void;
}

const NAV: AdminSection[] = ['dashboard', 'applications', 'staff', 'partners', 'payouts', 'audit'];

function Shell({
  access,
  section,
  onNavigate,
  navigate,
  userEmail,
  onLogout,
  children,
}: {
  access: AdminAccess;
  section: AdminSection;
  onNavigate: (section: AdminSection) => void;
  navigate: AdminPageProps['navigate'];
  userEmail: string;
  onLogout?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('dashboard')}
              className="text-sm font-bold tracking-tight text-slate-900"
            >
              Nexora <span className="font-normal text-slate-500">Admin</span>
            </button>
            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">
              {roleLabel(access.role)}
              {access.workArea ? ` · ${access.workArea}` : ''}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="hidden sm:inline">{userEmail}</span>
            <button type="button" className="rounded-lg border border-slate-300 px-2 py-1" onClick={() => navigate('/')}>
              Exit
            </button>
            {onLogout ? (
              <button type="button" className="rounded-lg border border-slate-300 px-2 py-1" onClick={onLogout}>
                Sign out
              </button>
            ) : null}
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2">
          {NAV.map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => onNavigate(entry)}
              className={`whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-medium transition ${
                section === entry ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {adminSectionLabel(entry)}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

export function AdminPage({ path, search, navigate, user, onLogout, onRequireAuth }: AdminPageProps) {
  const [access, setAccess] = useState<AdminAccess>(NO_ADMIN_ACCESS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [setup, setSetup] = useState<AdminSetupState | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const params = (() => {
    try {
      return new URLSearchParams(search || '');
    } catch {
      return new URLSearchParams();
    }
  })();
  const token = (params.get('token') || '').trim();

  const section: AdminSection = (() => {
    const segment = path.replace(/^\/+|\/+$/g, '').split('/')[1]?.toLowerCase() || '';
    return (NAV as string[]).includes(segment) ? (segment as AdminSection) : 'dashboard';
  })();

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setLoading(false);
      setAccess(NO_ADMIN_ACCESS);
      setSetup(null);
      setSchemaMissing(false);
      return;
    }
    setLoading(true);
    setError(null);
    (async () => {
      let resolved: AdminAccess = NO_ADMIN_ACCESS;
      let missing = false;
      let state: AdminSetupState | null = null;
      try {
        resolved = await fetchMyAdminAccess();
      } catch (failure) {
        const err = failure as AdminApiError;
        if (err?.code === 'schema_not_applied') missing = true;
        if (!cancelled) setError(err?.message || 'Your access could not be verified.');
      }
      // Only a signed-in NON-staff account needs to know whether the project
      // can still be bootstrapped; staff never see the setup card.
      if (!resolved.isAdmin && !missing) {
        state = await fetchAdminSetupState();
        if (!state.schemaApplied) missing = true;
      }
      if (cancelled) return;
      setAccess(resolved);
      setSchemaMissing(missing);
      setSetup(state);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, reloadKey]);

  const onClaim = useCallback(async () => {
    setClaiming(true);
    setClaimError(null);
    try {
      await claimFirstSuperAdmin();
      // Re-read access from SQL (the source of truth) instead of trusting the
      // claim response: the panel opens only if get_my_admin_access agrees.
      setReloadKey((key) => key + 1);
    } catch (failure) {
      setClaimError((failure as AdminApiError)?.message || 'The claim could not be completed.');
    } finally {
      setClaiming(false);
    }
  }, []);

  const onNavigate = useCallback(
    (next: AdminSection) => {
      navigate(adminPath(next));
    },
    [navigate]
  );

  // 1. The public onboarding form — no session required, no admin gate.
  if (path.replace(/\/+$/, '') === ADMIN_ONBOARD_MANAGER_PATH) {
    return <AdminManagerOnboardingForm token={token} />;
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl items-center justify-center p-6 text-center">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Nexora Admin</h1>
          <p className="mt-2 text-sm text-slate-600">
            Sign in with your staff account to open the admin panel. If your account has not been approved yet, ask the
            Super Admin who shared your onboarding link.
          </p>
          <button
            type="button"
            className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            onClick={() => onRequireAuth?.()}
          >
            Sign in
          </button>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-dvh items-center justify-center p-6">
        <p role="status" className="text-sm text-slate-600">
          Checking your admin access…
        </p>
      </main>
    );
  }

  // 3a. The admin schema was never applied to this project.
  if (!access.isAdmin && schemaMissing) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl items-center justify-center p-6">
        <div
          data-testid="admin-schema-missing"
          className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center"
        >
          <h1 className="text-lg font-semibold text-amber-900">Admin setup is not finished yet</h1>
          <p className="mt-2 text-sm text-amber-800">
            The admin tables and functions have not been applied to this Supabase project, so nobody can sign in to
            the panel yet.
          </p>
          <ol className="mt-3 space-y-1 text-left text-sm text-amber-900">
            <li>
              1. Open <strong>Supabase Dashboard → SQL Editor</strong>.
            </li>
            <li>
              2. Paste the whole file <code className="rounded bg-amber-100 px-1">supabase/apply_admin_management.sql</code>{' '}
              and press <strong>Run</strong>.
            </li>
            <li>3. Come back to this page and reload — you will be able to claim Super Admin access.</li>
          </ol>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              className="rounded-xl border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-900"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              Check again
            </button>
            {onLogout ? (
              <button
                type="button"
                className="rounded-xl bg-amber-900 px-3 py-2 text-sm font-semibold text-white"
                onClick={onLogout}
              >
                Switch account
              </button>
            ) : null}
          </div>
        </div>
      </main>
    );
  }

  // 3b. Signed in, not staff, and the project has no Super Admin yet.
  if (!access.isAdmin && setup?.claimable) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl items-center justify-center p-6">
        <div data-testid="admin-claim-card" className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">No Super Admin exists on this project yet.</h1>
          <p className="mt-2 text-sm text-slate-600">
            You are signed in as <strong>{user.email || 'this account'}</strong>. Claiming makes this account the
            project&apos;s Super Admin. It works only once — after that, new staff join through onboarding links.
          </p>
          {claimError ? (
            <p role="alert" data-testid="admin-claim-error" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {claimError}
            </p>
          ) : null}
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              data-testid="admin-claim-setup"
              disabled={claiming}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              onClick={onClaim}
            >
              {claiming ? 'Claiming…' : 'Claim Super Admin access'}
            </button>
            {onLogout ? (
              <button
                type="button"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                onClick={onLogout}
              >
                Switch account
              </button>
            ) : null}
          </div>
        </div>
      </main>
    );
  }

  // 3c. Signed in, but not staff.
  if (!access.isAdmin) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl items-center justify-center p-6">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <h1 className="text-lg font-semibold text-amber-900">This area is for Nexora staff</h1>
          <p className="mt-2 text-sm text-amber-800">
            {user.email || 'This account'} is not an admin member{error ? ` — ${error}` : ''}. The Growth Partner portal
            lives at /partner/dashboard, and salon owners use /dashboard.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              className="rounded-xl border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-900"
              onClick={() => navigate('/partner/dashboard')}
            >
              Partner portal
            </button>
            {onLogout ? (
              <button
                type="button"
                className="rounded-xl bg-amber-900 px-3 py-2 text-sm font-semibold text-white"
                onClick={onLogout}
              >
                Switch account
              </button>
            ) : null}
          </div>
        </div>
      </main>
    );
  }

  const content = (() => {
    switch (section) {
      case 'applications':
        return <AdminManagerApplicationsPanel access={access} />;
      case 'staff':
        return <AdminOnboardingLinksPanel access={access} />;
      case 'partners':
        return <AdminPartnerDirectoryPanel access={access} />;
      case 'payouts':
        return <AdminPayoutsPanel access={access} />;
      case 'audit':
        return <AdminAuditPanel access={access} />;
      default:
        return <AdminOverviewPanel access={access} />;
    }
  })();

  return (
    <Shell
      access={access}
      section={section}
      onNavigate={onNavigate}
      navigate={navigate}
      userEmail={user.email || ''}
      onLogout={onLogout}
    >
      {/*
        Copy protection + watermark wrap the panels that show partner contact
        details and money. `SecurePanel` turns itself off for a Super Admin, who
        is allowed to export the same data through the audited CSV route.
      */}
      <SecurePanel
        enabled={access.role !== 'super_admin'}
        viewerEmail={user.email || ''}
        label={adminSectionLabel(section)}
      >
        {content}
      </SecurePanel>
    </Shell>
  );
}
