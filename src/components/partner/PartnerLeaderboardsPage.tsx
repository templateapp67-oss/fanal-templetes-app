import React, { useState } from 'react';
import { Crown, RefreshCw, Trophy } from 'lucide-react';
import { growthPartnerService } from '../../services/growthPartner';
import { usePartnerServiceQuery } from '../../lib/partnerServiceQueries';
import { formatPartnerMoney } from '../../lib/partnerPresentation';
import { shortPartnerId } from '../PartnerPortalShell';
import {
  PartnerInlineNotice,
  PartnerFilterChip,
  PartnerModuleButton,
  PartnerModuleCard,
  PartnerModuleHeader,
  PartnerSectionEmpty,
  PartnerSectionError,
  PartnerSectionLoading,
  PartnerStatGrid,
  PartnerTable,
  PartnerTableRow,
} from './PartnerModuleKit';

// ============================================================================
// LEADERBOARDS — /partner/leaderboard
//
// `get_partner_leaderboard` ranks every active, approved partner by
// non-reversed, non-held earnings with a DENSE_RANK, so two partners on the
// same number share a rank and the next position is not skipped. The caller's
// own row is highlighted with the session's partner id — the ranking itself is
// public among approved partners, individual identities stay as short ids, in
// line with how the rest of the portal avoids exposing other people's accounts.
// ============================================================================

const LEADERBOARD_WINDOWS = [
  { value: 10, label: 'Top 10' },
  { value: 25, label: 'Top 25' },
  { value: 100, label: 'Top 100' },
];

export const PartnerLeaderboardsPage: React.FC<{
  accentHex?: string;
  /** The signed-in partner's own id (display-only, used to highlight their row). */
  partnerId?: string;
}> = ({ accentHex, partnerId }) => {
  const [limit, setLimit] = useState(25);
  const query = usePartnerServiceQuery(() => growthPartnerService.getLeaderboard({ limit }), [limit]);
  const { data, loading, error } = query;

  if (loading && !data) return <PartnerSectionLoading label="Loading the partner leaderboard…" kind="table" module="leaderboards" />;
  if (error && !data) {
    return <PartnerSectionError error={error} failure={query.failure} onRetry={query.reload} title="The leaderboard could not load" module="leaderboards" />;
  }

  const rows = data?.items ?? [];
  const myRank = data?.my_rank ?? null;
  const myRow = partnerId ? rows.find((row) => row.partner_id === partnerId) : undefined;
  const total = rows.reduce((sum, row) => sum + row.earnings_paise, 0);
  const leader = rows[0];

  return (
    <div data-partner-module="leaderboards" className="space-y-5">
      <PartnerModuleHeader
        tone="gradient"
        eyebrow="Partner standings"
        title="Leaderboards"
        description="All-time eligible earnings across approved partners. Ties share a rank; reversed and held rows never count."
        icon={Trophy}
        actions={
          <PartnerModuleButton variant="secondary" onClick={query.reload} disabled={query.refreshing}>
            <RefreshCw className={`h-4 w-4 ${query.refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </PartnerModuleButton>
        }
      >
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-pink-200">Your rank</p>
            <p className="mt-1 text-4xl font-black sm:text-5xl">{myRank ? `#${myRank}` : 'Unranked'}</p>
            <p className="mt-2 text-xs font-bold text-slate-200">
              {myRank
                ? `Ranked on lifetime cleared and pending earnings · position ${myRank} of ${rows.length} shown`
                : myRank === null && rows.length
                  ? `You are outside the top ${rows.length}. ${leader ? `The gap to #1 is ${formatPartnerMoney(Math.max((leader.earnings_paise || 0) - (myRow?.earnings_paise ?? 0), 0))}.` : ''}`
                  : 'Ranking starts as soon as your first commission row is recorded.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {LEADERBOARD_WINDOWS.map((window) => (
              <PartnerFilterChip
                key={window.value}
                label={window.label}
                active={limit === window.value}
                accentHex={accentHex}
                onSelect={() => setLimit(window.value)}
              />
            ))}
          </div>
        </div>
      </PartnerModuleHeader>

      {error ? <PartnerInlineNotice message={`${error} — showing the last standings we loaded.`} /> : null}

      <PartnerStatGrid
        columns={4}
        stats={[
          { label: 'Your rank', value: myRank ? `#${myRank}` : '—' },
          { label: 'Your earnings', value: myRow ? formatPartnerMoney(myRow.earnings_paise) : formatPartnerMoney(0), hint: 'Eligible rows only' },
          { label: 'Leadership bar', value: leader ? formatPartnerMoney(leader.earnings_paise) : '—', hint: leader ? `Set by #${leader.rank}` : 'No ranked partner yet' },
          { label: 'Partners shown', value: String(rows.length), hint: `Top ${limit} window` },
        ]}
      />

      <PartnerModuleCard
        id="standings"
        title="Standings"
        description="Earnings are partner-level totals; names are never published, only the short partner id."
        padded={false}
      >
        <PartnerTable
          caption="Partner leaderboard"
          columns={['Rank', 'Partner', 'Eligible earnings']}
          minWidth="min-w-[420px]"
          rows={rows.map((row) => {
            const isMe = Boolean(partnerId && row.partner_id === partnerId);
            return (
              <PartnerTableRow key={`${row.rank}-${row.partner_id}`} highlighted={isMe}>
                <td className="p-4">
                  <span className="inline-flex items-center gap-2">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-xl text-xs font-black ${row.rank <= 3 ? 'text-white' : 'bg-slate-100 text-slate-600'}`}
                      style={row.rank <= 3 ? { backgroundColor: accentHex } : undefined}>
                      {row.rank}
                    </span>
                    {row.rank === 1 ? <Crown className="h-4 w-4 text-amber-500" aria-label="Leading partner" /> : null}
                  </span>
                </td>
                <td className="p-4">
                  <span className="block font-mono text-xs text-slate-500" title={row.partner_id}>
                    {shortPartnerId(row.partner_id) || '—'}
                  </span>
                  {isMe ? (
                    <span className="mt-0.5 block text-[11px] font-black uppercase tracking-wide" style={{ color: accentHex }}>
                      You
                    </span>
                  ) : null}
                </td>
                <td className="whitespace-nowrap p-4 text-right text-sm font-black text-slate-950">
                  {formatPartnerMoney(row.earnings_paise)}
                </td>
              </PartnerTableRow>
            );
          })}
          empty={
            <PartnerSectionEmpty
              title="No ranked partners yet"
              body="The board fills up as approved partners earn their first eligible commission. Your own rows count from the moment they are recorded."
              icon={Trophy}
            />
          }
        />
        {rows.length ? (
          <p className="border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-[11px] font-semibold text-slate-500">
            {rows.length} partner{rows.length === 1 ? '' : 's'} in this window · {formatPartnerMoney(total)} of eligible earnings counted
          </p>
        ) : null}
      </PartnerModuleCard>
    </div>
  );
};

export default PartnerLeaderboardsPage;
