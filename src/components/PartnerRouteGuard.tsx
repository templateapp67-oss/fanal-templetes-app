import React, { useEffect, useRef } from 'react';
import { ShieldAlert } from 'lucide-react';
import { resolveGrowthPartnerGate, toSafePartnerSectionError, type GrowthPartnerGate } from '../lib/growthPartner';
import { PartnerLoading } from './PartnerLoading';
import {
  PartnerStatusScreen, GrowthPartnerLoading, GrowthPartnerUnauthorized,
  GrowthPartnerInactive, GrowthPartnerMockNotice, GrowthPartnerLoadError,
  GROWTH_PARTNER_SESSION_TITLE, GROWTH_PARTNER_SESSION_BODY, GROWTH_PARTNER_ERROR_TITLE,
} from './PartnerStatusScreen';

type GuardInput = Parameters<typeof resolveGrowthPartnerGate>[0] & {
  verifiedFor: string | null;
  isLoginPath: boolean;
  loginRoute: string;
  navigate?: (to: string) => void;
};

/** Common UX gate. Backend Auth/RLS still authorizes every data request. */
export function usePartnerRouteGuard(input: GuardInput): GrowthPartnerGate {
  const gate = resolveGrowthPartnerGate({...input, loading: input.loading ||
    (!input.isMockMode && !!input.userId && input.verifiedFor !== input.userId)});
  const lastRedirect = useRef('');
  useEffect(() => {
    if (input.isLoginPath || (gate !== 'unauthenticated' && gate !== 'session-expired')) {
      lastRedirect.current = ''; return;
    }
    const key = `${input.userId}:${gate}:${input.loginRoute}`;
    if (lastRedirect.current === key) return;
    lastRedirect.current = key;
    input.navigate?.(input.loginRoute);
  }, [gate, input.userId, input.isLoginPath, input.loginRoute, input.navigate]);
  return gate;
}

/** Never mounts protected children for a loading or denied account. */
export function PartnerRouteGuard({gate,children,onBack,onRetry,onSignIn,error,unauthorizedBody,loadingReferralLink}: {
  gate: GrowthPartnerGate;
  children?: React.ReactNode;
  onBack?: () => void;
  onRetry?: () => void;
  onSignIn?: () => void;
  error?: unknown;
  unauthorizedBody?: string;
  loadingReferralLink?: boolean;
}) {
  if (gate === 'ready') return <>{children}</>;
  if (gate === 'loading' || gate === 'unauthenticated') return loadingReferralLink
    ? <main className="mx-auto max-w-6xl px-4 py-8"><PartnerLoading kind="link" label="Loading your referral link…" /></main>
    : <GrowthPartnerLoading />;
  if (gate === 'unauthorized') return <GrowthPartnerUnauthorized onBack={onBack} body={unauthorizedBody} />;
  if (gate === 'inactive') return <GrowthPartnerInactive onBack={onBack} />;
  if (gate === 'mock-mode') return <GrowthPartnerMockNotice onBack={onBack} />;
  if (gate === 'pending' || gate === 'rejected') return <main className="min-h-[70vh] flex items-center justify-center px-4 py-16">
    <PartnerStatusScreen icon={<ShieldAlert className="h-7 w-7 text-slate-400" />} title={gate === 'pending' ? 'Approval pending' : 'Application not approved'}
      body={gate === 'pending' ? 'Your Growth Partner application is under review.' : 'Your Growth Partner application was not approved.'}>
      <button type="button" onClick={onRetry} className="mt-6 min-h-11 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white">Check status</button>
      <button type="button" onClick={onBack} className="mt-3 min-h-11 w-full rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold">Back to app</button>
    </PartnerStatusScreen>
  </main>;
  if (gate === 'session-expired') return <GrowthPartnerLoadError title={GROWTH_PARTNER_SESSION_TITLE} body={GROWTH_PARTNER_SESSION_BODY} actionLabel="Sign in again" onAction={onSignIn} />;
  return <GrowthPartnerLoadError title={GROWTH_PARTNER_ERROR_TITLE} body={toSafePartnerSectionError(error).message} actionLabel="Retry" onAction={onRetry} />;
}
