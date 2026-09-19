import React from 'react';
import { Check, Lock, Medal, Sparkles, TrendingUp } from 'lucide-react';
import { getPartnerLevels } from '../../lib/partnerPortalOperations';
import { usePartnerQuery } from '../../lib/partnerPortalQueries';
import { formatPartnerRateBps } from '../../lib/partnerPresentation';
import {
  PartnerInlineNotice,
  PartnerModuleButton,
  PartnerModuleCard,
  PartnerModuleHeader,
  PartnerSectionEmpty,
  PartnerSectionError,
  PartnerSectionLoading,
  PartnerStatGrid,
} from './PartnerModuleKit';

// ============================================================================
// PARTNER LEVELS — /partner/levels
//
// Tier ladder read from `partner_level_definitions` through
// `get_my_partner_levels`, which also answers how many ACTIVE referrals the
// caller has and which tiers that unlocks. The ladder is data, not copy: the
// rates and thresholds shown here are the rows the finance desk maintains, and
// the commission each ledger row actually used is visible on Earnings
// (`commission_bps` is frozen per row), so this page can never argue with the
// wallet.
// ============================================================================

const LEVEL_ACCENTS: Record<string, string> = {
  bronze: '#b45309',
  silver: '#64748b',
  gold: '#ca8a04',
  platinum: '#C20E5A',
};

const titleCase = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

export const PartnerLevelsPage: React.FC<{ accentHex?: string }> = ({ accentHex }) => {
  const query = usePartnerQuery(() => getPartnerLevels(), []);
  const { data, loading, error } = query;

  if (loading && !data) return <PartnerSectionLoading label="Loading your partner level…" kind="dashboard" module="partner-levels" />;
  if (error && !data) return <PartnerSectionError error={error} onRetry={query.reload} title="Partner levels could not load" module="partner-levels" />;

  const levels = data?.levels ?? [];
  const unlocked = levels.filter((level) => level.unlocked);
  const current = unlocked.length ? unlocked[unlocked.length - 1] : null;
  const next = levels.find((level) => !level.unlocked) ?? null;
  const activeReferrals = data?.active_referrals ?? 0;

  // Progress toward the next threshold only exists when there IS a next one and
  // the floor of the current tier is below it.
  const spanFrom = current?.minimum_paid_referrals ?? 0;
  const progress = next
    ? Math.max(0, Math.min(100, Math.round(((activeReferrals - spanFrom) / Math.max((next.minimum_paid_referrals - spanFrom) || 1, 1)) * 100)))
    : 100;

  return (
    <div data-partner-module="partner-levels" className="space-y-5">
      <PartnerModuleHeader
        eyebrow="Tier ladder"
        title="Partner Levels"
        description="Active referred shops move you up the ladder. A higher tier raises the recurring rate applied to each new commission row."
        icon={Medal}
        actions={
          <PartnerModuleButton variant="secondary" onClick={query.reload} disabled={query.refreshing}>
            {query.refreshing ? 'Refreshing…' : 'Refresh'}
          </PartnerModuleButton>
        }
      >
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-pink-200">Current tier</p>
            <p className="mt-1 flex items-center gap-3 text-4xl font-black sm:text-5xl">
              {current ? titleCase(current.code) : 'Bronze'}
              {current ? (
                <span
                  className="inline-flex items-center rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-wide text-white"
                  style={{ backgroundColor: LEVEL_ACCENTS[current.code] || accentHex }}
                >
                  {formatPartnerRateBps(current.commission_bps)}
                </span>
              ) : null}
            </p>
            <p className="mt-2 text-xs font-bold text-slate-200">
              {activeReferrals} active referred {activeReferrals === 1 ? 'shop' : 'shops'} on your account
            </p>
          </div>
          {next ? (
            <div className="min-w-[220px] flex-1 sm:max-w-sm">
              <div className="flex justify-between text-[11px] font-black uppercase tracking-wider text-pink-100">
                <span>{`${activeReferrals} / ${next.minimum_paid_referrals} for ${titleCase(next.code)}`}</span>
                <span>{progress}%</span>
              </div>
              <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/20">
                <div className="h-full rounded-full bg-white transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-2 text-xs text-pink-50">
                {Math.max(next.minimum_paid_referrals - activeReferrals, 0)} more active {next.minimum_paid_referrals - activeReferrals === 1 ? 'shop' : 'shops'} to move up
              </p>
            </div>
          ) : (
            <p className="max-w-xs text-xs font-bold text-pink-50">
              You are on the top published tier. Keep the referrals active — a tier is held while its threshold is met.
            </p>
          )}
        </div>
      </PartnerModuleHeader>

      {error ? <PartnerInlineNotice message={`${error} — showing the last tiers we loaded.`} /> : null}

      <PartnerStatGrid
        columns={4}
        stats={[
          { label: 'Active referrals', value: String(activeReferrals), hint: 'Referred shops currently active' },
          { label: 'Current rate', value: current ? formatPartnerRateBps(current.commission_bps) : '—', hint: current ? titleCase(current.code) : 'Tier not assigned yet' },
          { label: 'Tiers unlocked', value: `${unlocked.length} of ${levels.length || '—'}` },
          {
            label: 'Next unlock',
            value: next ? `${next.minimum_paid_referrals} shops` : '—',
            hint: next ? `${titleCase(next.code)} · ${formatPartnerRateBps(next.commission_bps)}` : 'Top tier reached',
          },
        ]}
      />

      {levels.length ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {levels.map((level) => {
            const isCurrent = current?.code === level.code;
            return (
              <article
                key={level.code}
                data-partner-tier={level.code}
                className={`relative flex min-w-0 flex-col rounded-3xl border bg-white p-5 shadow-sm transition-shadow hover:shadow-md ${
                  level.unlocked ? 'border-transparent ring-2' : 'border-slate-200'
                }`}
                style={level.unlocked ? ({ ['--tw-ring-color' as any]: LEVEL_ACCENTS[level.code] || accentHex } as React.CSSProperties) : undefined}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Tier {level.sort_order}</p>
                    <h3 className="mt-0.5 text-lg font-black text-slate-950">{titleCase(level.code)}</h3>
                  </div>
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-white"
                    style={{ backgroundColor: level.unlocked ? LEVEL_ACCENTS[level.code] || accentHex : '#e2e8f0' }}
                  >
                    {level.unlocked ? <Check className="h-4 w-4" /> : <Lock className="h-4 w-4 text-slate-500" />}
                  </span>
                </div>
                <p className="mt-4 text-3xl font-black text-slate-950">{formatPartnerRateBps(level.commission_bps)}</p>
                <p className="mt-0.5 text-xs font-bold text-slate-500">
                  recurring rate from {level.minimum_paid_referrals} active {level.minimum_paid_referrals === 1 ? 'shop' : 'shops'}
                </p>
                {level.perks.length ? (
                  <ul className="mt-4 space-y-1.5 border-t border-slate-100 pt-4 text-sm text-slate-600">
                    {level.perks.map((perk) => (
                      <li key={perk} className="flex items-start gap-2">
                        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="min-w-0">{perk}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="mt-4 text-[11px] font-black uppercase tracking-wide text-slate-400">
                  {isCurrent ? 'Your current tier' : level.unlocked ? 'Unlocked' : `${Math.max(level.minimum_paid_referrals - activeReferrals, 0)} more to unlock`}
                </p>
              </article>
            );
          })}
        </section>
      ) : (
        <PartnerModuleCard id="tiers">
          <PartnerSectionEmpty
            title="No tiers published yet"
            body="The partner tier ladder is configured by Nexora. As soon as the definitions are live, your current tier and rate appear here."
            icon={TrendingUp}
          />
        </PartnerModuleCard>
      )}

      <PartnerModuleCard id="how-levels-work" title="How a tier is applied" description="The rules the ledger actually follows.">
        <ul className="grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
          <li className="rounded-2xl bg-slate-50 p-4">
            <span className="block font-black text-slate-900">Counted: active referrals</span>
            A referred shop counts while its referral is active. Completed or dropped referrals do not hold a tier up.
          </li>
          <li className="rounded-2xl bg-slate-50 p-4">
            <span className="block font-black text-slate-900">Frozen per row</span>
            Each commission row keeps the rate it was earned at, so a later tier change never rewrites history.
          </li>
          <li className="rounded-2xl bg-slate-50 p-4">
            <span className="block font-black text-slate-900">Released after 7 days</span>
            Earnings follow the clearance hold; the tier only decides how much is credited, not when it is payable.
          </li>
          <li className="rounded-2xl bg-slate-50 p-4">
            <span className="block font-black text-slate-900">No self-approval</span>
            Tiers are data the Nexora team maintains. Nothing on this page can be edited by a partner.
          </li>
        </ul>
      </PartnerModuleCard>
    </div>
  );
};

export default PartnerLevelsPage;
