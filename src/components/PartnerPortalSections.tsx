import React, { useCallback, useState } from 'react';
import { Check, Copy, Link2, PauseCircle } from 'lucide-react';
import {
  copyReferralCodeToClipboard,
  GROWTH_PARTNER_REFERRAL_CODE_UNAVAILABLE,
  PartnerDashboardData,
} from '../lib/growthPartner';
import { KpiCard } from './GrowthPartnerSections';

/**
 * Partner-portal sections that are new in the Part 2.2 shell (the other pages
 * reuse the existing area components). Everything here renders only real
 * backend values: the referral code comes from the caller's own
 * growth_partners row and the share link is a plain URL built from it.
 */

/** Resolve the app origin for share links (empty outside a browser context). */
export function partnerShareOrigin(): string {
  try {
    if (typeof window === 'undefined' || !window.location) return '';
    return window.location.origin;
  } catch {
    return '';
  }
}

/** The onboarding link a partner shares: /onboarding/referral?ref=CODE. */
export function partnerReferralShareLink(code: string, origin?: string): string {
  const base = (origin ?? partnerShareOrigin()).replace(/\/+$/, '');
  const value = code.trim();
  if (!base || !value) return '';
  return `${base}/onboarding/referral?ref=${encodeURIComponent(value)}`;
}

/**
 * "My Referral Code" page — the hero surface of the referral funnel: the code
 * at a glance, one-click copy, a ready-to-share onboarding link (it pre-fills
 * the code on the referral screen) and how the funnel works. If the partner's
 * row has no code, or the partner is paused, the page says so honestly.
 */
export const PartnerReferralCodeSection: React.FC<{
  code: string | null | undefined;
  isActive?: boolean;
  origin?: string;
}> = ({ code, isActive = true, origin }) => {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const value = typeof code === 'string' ? code.trim() : '';
  const shareLink = value ? partnerReferralShareLink(value, origin) : '';

  const copyValue = useCallback(async (text: string): Promise<boolean> => {
    const ok = await copyReferralCodeToClipboard(text);
    return ok;
  }, []);

  const copyCode = useCallback(async () => {
    if (await copyValue(value)) {
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 2000);
    }
  }, [copyValue, value]);

  const copyLink = useCallback(async () => {
    if (await copyValue(shareLink)) {
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    }
  }, [copyValue, shareLink]);

  if (!value) {
    return (
      <section
        aria-label="Your referral code"
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">
          Your referral code
        </h2>
        <p className="mt-3 text-sm font-bold text-slate-700">
          {GROWTH_PARTNER_REFERRAL_CODE_UNAVAILABLE}
        </p>
        <p className="mt-3 text-xs text-slate-500">
          Your code is managed by the platform and cannot be changed here.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {!isActive ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
        >
          <PauseCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>
            Your partner account is currently paused — your code still identifies referred users,
            but new links are not credited until your account is active again.
          </p>
        </div>
      ) : null}

      <section
        aria-label="Your referral code"
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">
          Your referral code
        </h2>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <code
            className="select-all rounded-2xl bg-slate-900 px-5 py-3 text-3xl font-black tracking-[0.25em] text-white sm:text-4xl"
            data-referral-code={value}
          >
            {value}
          </code>
          <button
            type="button"
            onClick={() => void copyCode()}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-800 transition-opacity hover:opacity-90"
          >
            {copiedCode ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copiedCode ? 'Copied' : 'Copy code'}
          </button>
        </div>
        <p className="mt-4 text-xs text-slate-500">
          New users who join with this code are linked to you. Your code is managed by the platform
          and cannot be changed here.
        </p>
      </section>

      {shareLink ? (
        <section
          aria-label="Share your referral link"
          className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
        >
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">
            Share your link
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Anyone who opens this link gets the referral screen with your code already filled in.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
              <Link2 className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <input
                type="text"
                readOnly
                value={shareLink}
                aria-label="Your referral link"
                onFocus={(event) => event.currentTarget.select()}
                className="w-full min-w-0 cursor-text bg-transparent font-mono text-xs text-slate-700 focus:outline-none sm:text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => void copyLink()}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90"
            >
              {copiedLink ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copiedLink ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </section>
      ) : null}

      <section
        aria-label="How referrals work"
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">
          How it works
        </h2>
        <ol className="mt-4 space-y-4">
          {[
            {
              title: 'Share your code or link',
              body: 'Send your referral code or link to people who want a website for their business.',
            },
            {
              title: 'They sign up with your code',
              body: 'Your link opens onboarding with the code filled in — or they can type the code themselves.',
            },
            {
              title: 'Track them in your portal',
              body: 'Everyone who joins with your code appears under Referred Users and their progress under Referral Status.',
            },
          ].map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-black text-white"
              >
                {index + 1}
              </span>
              <span>
                <span className="block text-sm font-bold text-slate-900">{step.title}</span>
                <span className="mt-0.5 block text-sm text-slate-600">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
};

/**
 * "Referral Status" page wrapper — backend KPI chips at a glance plus what
 * each status means, around the real filterable/searchable referral list
 * (passed as children by the page).
 */
export const PartnerReferralStatusSection: React.FC<{
  dashboard: PartnerDashboardData | null;
  loading?: boolean;
  children: React.ReactNode;
}> = ({ dashboard, loading = false, children }) => (
  <div className="space-y-4">
    <section aria-label="Referral status summary" aria-busy={loading}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Total Referrals"
          value={dashboard ? String(dashboard.kpis.total_referrals) : '—'}
        />
        <KpiCard
          label="In Progress"
          value={dashboard ? String(dashboard.kpis.active_onboarding ?? 0) : '—'}
        />
        <KpiCard
          label="Completed"
          value={dashboard ? String(dashboard.kpis.completed ?? 0) : '—'}
        />
      </div>
    </section>
    <section
      aria-label="What each status means"
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">
        What each status means
      </h2>
      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-slate-50 p-4">
          <dt className="text-sm font-bold text-slate-900">Pending</dt>
          <dd className="mt-1 text-xs text-slate-600">
            Signed up with your code — onboarding not started yet.
          </dd>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <dt className="text-sm font-bold text-slate-900">In Progress</dt>
          <dd className="mt-1 text-xs text-slate-600">Onboarding started — the website is underway.</dd>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <dt className="text-sm font-bold text-slate-900">Completed</dt>
          <dd className="mt-1 text-xs text-slate-600">The referred user’s website is completed.</dd>
        </div>
      </dl>
    </section>
    {children}
  </div>
);
