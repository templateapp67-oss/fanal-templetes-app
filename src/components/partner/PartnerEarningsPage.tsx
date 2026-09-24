import React, { useMemo, useState } from 'react';
import { Banknote, Clock, Download, RefreshCw, Wallet } from 'lucide-react';
import type { PartnerEarningRow } from '../../lib/partnerPortalOperations';
// Data access goes through the service facade: result objects, paise-only money,
// identity from the session JWT (no partner id is ever passed).
import { growthPartnerService } from '../../services/growthPartner';
import { usePartnerServiceQuery } from '../../lib/partnerServiceQueries';
import {
  formatPartnerDate,
  formatPartnerMoney,
  formatPartnerRateBps,
  partnerEarningTypeLabel,
  partnerStatusLabel,
} from '../../lib/partnerPresentation';
import { partnerPortalPath } from '../../lib/router';
import {
  PartnerInlineNotice,
  PartnerModuleButton,
  PartnerModuleCard,
  PartnerModuleHeader,
  PartnerPageControls,
  PartnerSectionEmpty,
  PartnerSectionError,
  PartnerSectionLoading,
  PartnerStatGrid,
  PartnerStatusPill,
  PartnerTable,
  PartnerTableRow,
} from './PartnerModuleKit';

// ============================================================================
// EARNINGS — /partner/earnings
//
// The partner's own commission ledger: what has been earned, what is still
// inside the seven-day clearance hold, what is withdrawable now, and the rows
// behind those numbers. Everything is read from `get_my_partner_earnings`,
// which derives the partner from the caller's session, so the page never
// carries an id and cannot be pointed at someone else's wallet.
// ============================================================================

/** Rows per page — the RPC bounds the window itself at 200. */
const EARNINGS_PAGE_SIZE = 10;

/**
 * Statement export is built in the browser from the rows the partner can
 * already see. It is labelled as the current page so a downloaded file can
 * never be mistaken for the whole ledger.
 */
function earningsCsv(rows: PartnerEarningRow[], currency: string): string {
  const header = ['Date', 'Type', 'Status', `Amount (${currency})`, 'Rate', 'Available from'];
  const lines = rows.map((row) =>
    [
      row.earned_at ? new Date(row.earned_at).toISOString().slice(0, 10) : '',
      partnerEarningTypeLabel(row.earning_type),
      partnerStatusLabel(row.status),
      (row.amount_paise / 100).toFixed(2),
      `${(row.commission_bps / 100).toFixed(2)}%`,
      row.available_at ? new Date(row.available_at).toISOString().slice(0, 10) : '—',
    ]
      .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
      .join(',')
  );
  return [header.join(','), ...lines].join('\n');
}

export const PartnerEarningsPage: React.FC<{
  accentHex?: string;
  navigate?: (to: string) => void;
}> = ({ accentHex, navigate }) => {
  const [page, setPage] = useState(0);
  const [exportError, setExportError] = useState('');
  const query = usePartnerServiceQuery(
    () => growthPartnerService.getEarnings({ limit: EARNINGS_PAGE_SIZE, offset: page * EARNINGS_PAGE_SIZE }),
    [page]
  );
  const { data, loading, refreshing, error } = query;
  const currency = data?.currency || 'INR';
  const rows = data?.transactions ?? [];

  // Only a full page can promise that a next page exists.
  const hasMore = rows.length >= EARNINGS_PAGE_SIZE;

  const typeTotals = useMemo(() => {
    const totals = new Map<string, { amount_paise: number; count: number }>();
    for (const row of rows) {
      const key = partnerEarningTypeLabel(row.earning_type);
      const current = totals.get(key) ?? { amount_paise: 0, count: 0 };
      totals.set(key, { amount_paise: current.amount_paise + row.amount_paise, count: current.count + 1 });
    }
    return [...totals.entries()].sort((a, b) => b[1].amount_paise - a[1].amount_paise);
  }, [rows]);

  const exportStatement = () => {
    setExportError('');
    if (!rows.length) {
      setExportError('Nothing to export on this page yet.');
      return;
    }
    try {
      const blob = new Blob([earningsCsv(rows, currency)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `nexora-partner-earnings-page-${page + 1}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError('This browser blocked the download. Select the table and copy it instead.');
    }
  };

  if (loading && !data) return <PartnerSectionLoading label="Loading your earnings…" kind="dashboard" module="earnings" />;
  if (error && !data) {
    return <PartnerSectionError error={error} failure={query.failure} onRetry={query.reload} title="Your earnings could not load" module="earnings" />;
  }
  // No answer yet and no failure either: still loading. Never fall back to a
  // zeroed wallet — `₹0` is a figure the partner would have to believe, and the
  // service already refuses a malformed `totals` instead of defaulting it.
  if (!data) return <PartnerSectionLoading label="Loading your earnings…" kind="dashboard" module="earnings" />;

  const totals = data.totals;

  return (
    <div data-partner-module="earnings" className="space-y-5">
      <PartnerModuleHeader
        tone="gradient"
        eyebrow="Growth Partner wallet"
        title="Earnings"
        description="Recurring subscription commissions on the shops you onboarded, with the clearance hold each row is still inside."
        icon={Wallet}
        actions={
          <>
            <PartnerModuleButton variant="secondary" onClick={query.reload} disabled={refreshing} title="Reload the ledger">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </PartnerModuleButton>
            <PartnerModuleButton variant="accent" accentHex={accentHex} onClick={exportStatement} data-partner-action="export-earnings">
              <Download className="h-4 w-4" />
              Export page
            </PartnerModuleButton>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-white/10 p-4 backdrop-blur">
            <p className="text-[11px] font-black uppercase tracking-wider text-pink-100">Available to withdraw</p>
            <p className="mt-1.5 text-3xl font-black">{formatPartnerMoney(totals.available_paise, currency)}</p>
          </div>
          <div className="rounded-2xl bg-white/10 p-4">
            <p className="text-[11px] font-black uppercase tracking-wider text-pink-100">In clearance</p>
            <p className="mt-1.5 text-3xl font-black">{formatPartnerMoney(totals.pending_paise, currency)}</p>
          </div>
          <div className="rounded-2xl bg-white/10 p-4">
            <p className="text-[11px] font-black uppercase tracking-wider text-pink-100">Lifetime earnings</p>
            <p className="mt-1.5 text-3xl font-black">{formatPartnerMoney(totals.lifetime_paise, currency)}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-pink-50">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5">
            <Clock className="h-3.5 w-3.5" />
            Released seven days after the subscription payment clears
          </span>
          {rows[0]?.commission_bps ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5">
              <Banknote className="h-3.5 w-3.5" />
              {formatPartnerRateBps(rows[0].commission_bps)} recurring rate frozen on each row
            </span>
          ) : null}
        </div>
      </PartnerModuleHeader>

      {error ? <PartnerInlineNotice message={`${error} — showing the last data we loaded.`} /> : null}
      {exportError ? <PartnerInlineNotice tone="error" message={exportError} /> : null}

      <PartnerStatGrid
        columns={4}
        stats={[
          { label: 'Lifetime earnings', value: formatPartnerMoney(totals.lifetime_paise, currency) },
          { label: 'Available to withdraw', value: formatPartnerMoney(totals.available_paise, currency) },
          {
            label: 'Pending clearance',
            value: formatPartnerMoney(totals.pending_paise, currency),
            hint: 'Becomes withdrawable after the hold',
          },
          { label: 'Rows on this page', value: String(rows.length), hint: `Page ${page + 1}` },
        ]}
      />

      <PartnerModuleCard
        id="transactions"
        title="Transaction history"
        description="Newest ledger rows first. Amounts are your share, not the shop's payment."
        padded={false}
        actions={
          rows.length ? (
            <PartnerModuleButton
              variant="secondary"
              onClick={() => navigate?.(partnerPortalPath('withdrawals'))}
              data-partner-action="go-to-withdrawals"
            >
              Withdraw
              <Banknote className="h-4 w-4" />
            </PartnerModuleButton>
          ) : null
        }
      >
        <PartnerTable
          caption="Partner commission transactions"
          columns={['Date', 'Earning', 'Status', 'Amount']}
          minWidth="min-w-[560px]"
          rows={rows.map((row) => (
            <PartnerTableRow key={row.id || `${row.earning_type}-${row.earned_at}`}>
              <td className="whitespace-nowrap p-4 font-bold text-slate-900">{formatPartnerDate(row.earned_at)}</td>
              <td className="p-4">
                <span className="block font-bold text-slate-900">{partnerEarningTypeLabel(row.earning_type)}</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {row.commission_bps ? `${formatPartnerRateBps(row.commission_bps)} · ` : ''}
                  {row.available_at ? `available ${formatPartnerDate(row.available_at)}` : 'inside the clearance hold'}
                </span>
              </td>
              <td className="p-4">
                <PartnerStatusPill status={row.status} label={partnerStatusLabel(row.status)} />
              </td>
              <td className="whitespace-nowrap p-4 text-right font-black text-slate-950">
                {formatPartnerMoney(row.amount_paise, currency)}
              </td>
            </PartnerTableRow>
          ))}
          empty={
            <PartnerSectionEmpty
              title="No commission rows yet"
              body="Earnings appear the moment a referred shop's subscription payment is recorded — 15% of it is credited here and released after the clearance hold."
              icon={Wallet}
              action={
                navigate ? (
                  <PartnerModuleButton variant="accent" accentHex={accentHex} onClick={() => navigate(partnerPortalPath('referral-code'))}>
                    Share my referral code
                  </PartnerModuleButton>
                ) : null
              }
            />
          }
        />
        {rows.length ? (
          <div className="px-5 pb-5">
            <PartnerPageControls
              page={page}
              rowCount={rows.length}
              pageSize={EARNINGS_PAGE_SIZE}
              hasMore={hasMore}
              onPage={setPage}
            />
          </div>
        ) : null}
      </PartnerModuleCard>

      {typeTotals.length ? (
        <PartnerModuleCard id="type-breakdown" title="Mix on this page" description="Totals cover the rows currently loaded, not the whole ledger.">
          <ul className="space-y-2">
            {typeTotals.map(([label, value]) => (
              <li key={label} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                <span className="text-sm font-bold text-slate-700">
                  {label}
                  <span className="ml-2 text-xs font-semibold text-slate-500">
                    {value.count} {value.count === 1 ? 'row' : 'rows'}
                  </span>
                </span>
                <span className="text-sm font-black text-slate-950">{formatPartnerMoney(value.amount_paise, currency)}</span>
              </li>
            ))}
          </ul>
        </PartnerModuleCard>
      ) : null}
    </div>
  );
};

export default PartnerEarningsPage;
