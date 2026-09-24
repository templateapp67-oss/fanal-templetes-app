import React, { useState } from 'react';
import { Banknote, Landmark, RefreshCw, ShieldCheck, Wallet, X } from 'lucide-react';
import {
  PARTNER_MINIMUM_PAYOUT_PAISE,
  type PartnerPayoutMethod,
} from '../../lib/partnerPortalOperations';
// The ledger's floor is still the SQL check; the amounts travel to the service
// in paise and the wallet reads come back as result objects.
import { growthPartnerService } from '../../services/growthPartner';
import { usePartnerServiceAction, usePartnerServiceQuery } from '../../lib/partnerServiceQueries';
import {
  formatPartnerDate,
  formatPartnerDateTime,
  formatPartnerMoney,
  partnerStatusLabel,
} from '../../lib/partnerPresentation';
import { PartnerToast } from '../PartnerToast';
import {
  PARTNER_INPUT_CLASS,
  PartnerField,
  PartnerInlineNotice,
  PartnerModuleButton,
  PartnerModuleCard,
  PartnerModuleHeader,
  PartnerPageControls,
  PartnerSectionEmpty,
  PartnerSectionError,
  PartnerSectionLoading,
  PartnerStatusPill,
  PartnerTable,
  PartnerTableRow,
} from './PartnerModuleKit';

// ============================================================================
// WITHDRAWALS — /partner/withdrawals
//
// The partner's cashout desk. Two reads and two writes, all server-decided:
//   • available balance comes from the earnings ledger,
//   • the ₹500 floor, the "one open request per partner" rule and the
//     available-balance ceiling are enforced inside the SQL functions, so the
//     form's validation is only a courtesy — the truth is the refusal message,
//   • cancelling is limited to the caller's own still-open request.
// The destination label is stored for the finance desk to read; no bank account
// data is collected in this form on purpose.
// ============================================================================

const PAYOUT_METHODS: Array<{ value: PartnerPayoutMethod; label: string; hint: string }> = [
  { value: 'upi', label: 'UPI ID', hint: 'e.g. partner@okbank' },
  { value: 'bank_transfer', label: 'Bank transfer (NEFT/IMPS)', hint: 'Account details are confirmed with the finance desk' },
  { value: 'paypal', label: 'PayPal', hint: 'PayPal email registered to your partner account' },
];

const REQUESTS_PAGE_SIZE = 10;
const MAX_DESTINATION_LENGTH = 120;

const OPEN_STATUSES = new Set(['pending', 'in_review']);

export const PartnerWithdrawalsPage: React.FC<{ accentHex?: string }> = ({ accentHex }) => {
  const [page, setPage] = useState(0);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PartnerPayoutMethod>('upi');
  const [destination, setDestination] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ amount?: string; destination?: string }>({});
  const [notice, setNotice] = useState({ id: 0, message: '' });
  const [cancelError, setCancelError] = useState('');

  // One row is enough here: the page wants the totals, not the transaction list.
  const balance = usePartnerServiceQuery(() => growthPartnerService.getEarnings({ limit: 1, offset: 0 }), []);
  const requests = usePartnerServiceQuery(
    () => growthPartnerService.getPayoutRequests({ limit: REQUESTS_PAGE_SIZE, offset: page * REQUESTS_PAGE_SIZE }),
    [page]
  );

  const request = usePartnerServiceAction((paise: number, payoutMethod: PartnerPayoutMethod, label: string) =>
    growthPartnerService.requestPayout({ amountPaise: paise, payoutMethod, destinationLabel: label })
  );
  const cancel = usePartnerServiceAction((requestId: string) => growthPartnerService.cancelPayoutRequest(requestId));

  // `available_paise` is ALREADY net of every payout request the desk has not
  // refused — open ones and paid ones (20260919120000 redefined the read that
  // way, because a paid payout used to leave the wallet offering the same money
  // again). So the page must not subtract the open amount a second time; it
  // shows it beside the cleared figure to explain where the difference went.
  const available = balance.data?.totals.available_paise ?? 0;
  const cleared = balance.data?.totals.cleared_paise ?? available;
  const openAmount = requests.data?.open_amount_paise ?? 0;
  const withdrawableNow = available;
  const rows = requests.data?.items ?? [];
  const hasMore = rows.length >= REQUESTS_PAGE_SIZE;
  const openRequest = rows.find((row) => OPEN_STATUSES.has(row.status));

  const submit = async () => {
    const nextErrors: { amount?: string; destination?: string } = {};
    const rupees = Number(amount);
    const paise = Math.round(rupees * 100);
    if (!amount.trim() || !Number.isFinite(rupees) || rupees <= 0) nextErrors.amount = 'Enter the amount you want to withdraw.';
    else if (paise < PARTNER_MINIMUM_PAYOUT_PAISE) {
      nextErrors.amount = `Minimum payout is ${formatPartnerMoney(PARTNER_MINIMUM_PAYOUT_PAISE)}.`;
    } else if (paise > withdrawableNow) {
      nextErrors.amount = `You can request up to ${formatPartnerMoney(withdrawableNow)} right now.`;
    }
    const label = destination.trim();
    if (label.length < 2) nextErrors.destination = 'Tell us where to send it (UPI ID, email or account reference).';
    else if (label.length > MAX_DESTINATION_LENGTH) nextErrors.destination = 'Keep that under 120 characters.';
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const created = await request.run(paise, method, label);
    if (!created) return;
    setAmount('');
    setDestination('');
    setNotice((current) => ({
      id: current.id + 1,
      message: `Payout request #${created.id.slice(0, 8)} for ${formatPartnerMoney(created.amount_paise)} is ${partnerStatusLabel(created.status).toLowerCase()}.`,
    }));
    balance.reload();
    requests.reload();
  };

  const cancelOpen = async () => {
    if (!openRequest) return;
    setCancelError('');
    const result = await cancel.run(openRequest.id);
    if (!result) {
      setCancelError(request.error || 'The request could not be withdrawn. It may already be under review.');
      return;
    }
    setNotice((current) => ({ id: current.id + 1, message: 'Payout request withdrawn — the amount is available again.' }));
    requests.reload();
    balance.reload();
  };

  if (balance.loading && !balance.data) return <PartnerSectionLoading label="Loading your payout balance…" kind="dashboard" module="withdrawals" />;
  if (balance.error && !balance.data) {
    return <PartnerSectionError error={balance.error} failure={balance.failure} onRetry={balance.reload} title="Your balance could not load" module="withdrawals" />;
  }
  if (requests.error && !requests.data && !requests.loading) {
    return <PartnerSectionError error={requests.error} failure={requests.failure} onRetry={requests.reload} title="Your payout requests could not load" module="withdrawals" />;
  }

  return (
    <div data-partner-module="withdrawals" className="space-y-5">
      <PartnerToast message={notice.message} noticeId={notice.id} />

      <PartnerModuleHeader
        eyebrow="Growth Partner wallet"
        title="Withdrawals"
        description="Move cleared commission to your own account. Requests are reviewed by the Nexora finance desk before any money moves."
        icon={Banknote}
        actions={
          <PartnerModuleButton variant="secondary" onClick={() => { balance.reload(); requests.reload(); }} title="Reload balance and requests">
            <RefreshCw className={`h-4 w-4 ${balance.refreshing || requests.refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </PartnerModuleButton>
        }
      >
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-[11px] font-black uppercase tracking-wider text-pink-200">Withdrawable now</p>
            <p className="mt-1 text-4xl font-black sm:text-5xl">{formatPartnerMoney(withdrawableNow)}</p>
            <p className="mt-2 text-xs font-bold text-slate-200">
              {formatPartnerMoney(cleared)} cleared ·{' '}
              {openAmount > 0
                ? `${formatPartnerMoney(openAmount)} reserved by an open request`
                : 'nothing reserved by an open request'}
            </p>
          </div>
          <p className="max-w-xs text-xs font-semibold leading-5 text-slate-200">
            <ShieldCheck className="mr-1.5 inline h-4 w-4 text-pink-200" />
            Only cleared rows (status “Available”) can be paid out, the minimum is {formatPartnerMoney(PARTNER_MINIMUM_PAYOUT_PAISE)},
            and one request can be open at a time.
          </p>
        </div>
      </PartnerModuleHeader>

      {balance.error ? <PartnerInlineNotice message={`${balance.error} — showing the last balance we loaded.`} /> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <PartnerModuleCard id="request" title="Request a payout" description="The finance desk pays in the partner's own recorded currency.">
          <div className="space-y-4">
            <PartnerField
              label="Amount"
              htmlFor="payout-amount"
              error={fieldErrors.amount}
              hint={`Up to ${formatPartnerMoney(withdrawableNow)} · minimum ${formatPartnerMoney(PARTNER_MINIMUM_PAYOUT_PAISE)}`}
            >
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm font-black text-slate-500">
                  ₹
                </span>
                <input
                  id="payout-amount"
                  name="amount"
                  type="number"
                  inputMode="decimal"
                  min={PARTNER_MINIMUM_PAYOUT_PAISE / 100}
                  step={1}
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    if (fieldErrors.amount) setFieldErrors((current) => ({ ...current, amount: undefined }));
                  }}
                  placeholder="1000"
                  className={`${PARTNER_INPUT_CLASS} pl-8`}
                />
              </div>
            </PartnerField>

            <PartnerField label="Payout method" htmlFor="payout-method">
              <select
                id="payout-method"
                name="method"
                value={method}
                onChange={(event) => setMethod(event.target.value as PartnerPayoutMethod)}
                className={PARTNER_INPUT_CLASS}
              >
                {PAYOUT_METHODS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-slate-500">
                {PAYOUT_METHODS.find((option) => option.value === method)?.hint}
              </p>
            </PartnerField>

            <PartnerField
              label="Destination reference"
              htmlFor="payout-destination"
              error={fieldErrors.destination}
              hint="Stored for the finance desk only — full bank details are never collected in this form."
            >
              <input
                id="payout-destination"
                name="destination"
                type="text"
                maxLength={MAX_DESTINATION_LENGTH}
                value={destination}
                onChange={(event) => {
                  setDestination(event.target.value);
                  if (fieldErrors.destination) setFieldErrors((current) => ({ ...current, destination: undefined }));
                }}
                placeholder="partner@okbank"
                className={PARTNER_INPUT_CLASS}
              />
            </PartnerField>

            {request.error ? <PartnerInlineNotice tone="error" message={request.error} /> : null}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <PartnerModuleButton
                type="button"
                variant="accent"
                accentHex={accentHex}
                onClick={submit}
                disabled={request.pending || Boolean(openRequest)}
                data-partner-action="request-payout"
              >
                <Landmark className="h-4 w-4" />
                {request.pending ? 'Submitting…' : `Request ${formatPartnerMoney(Math.max(Math.round(Number(amount) * 100) || 0, 0))}`}
              </PartnerModuleButton>
              {openRequest ? (
                <span className="text-xs font-bold text-slate-500">Finish or cancel your open request first.</span>
              ) : null}
            </div>
          </div>
        </PartnerModuleCard>

        <div className="space-y-4">
          {openRequest ? (
            <PartnerModuleCard id="open-request" title="Open request" description="Reviewed before it is paid; withdraw it any time up to review.">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-3xl font-black text-slate-950">{formatPartnerMoney(openRequest.amount_paise)}</p>
                  <p className="mt-1 text-xs font-bold text-slate-500">
                    {PAYOUT_METHODS.find((option) => option.value === openRequest.payout_method)?.label || openRequest.payout_method} ·{' '}
                    {openRequest.destination_label}
                  </p>
                  <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <PartnerStatusPill status={openRequest.status} label={partnerStatusLabel(openRequest.status)} />
                    requested {formatPartnerDateTime(openRequest.requested_at)}
                  </p>
                </div>
                <PartnerModuleButton variant="secondary" onClick={cancelOpen} disabled={cancel.pending} data-partner-action="cancel-payout">
                  <X className="h-4 w-4" />
                  {cancel.pending ? 'Withdrawing…' : 'Withdraw'}
                </PartnerModuleButton>
              </div>
              {cancel.error ? <div className="mt-3"><PartnerInlineNotice tone="error" message={cancel.error} /></div> : null}
              {cancelError ? <div className="mt-3"><PartnerInlineNotice tone="error" message={cancelError} /></div> : null}
            </PartnerModuleCard>
          ) : (
            <PartnerModuleCard id="open-request" title="Open request">
              <p className="flex items-start gap-2.5 text-sm text-slate-600">
                <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                No payout request is waiting right now. Anything you submit appears here until the finance desk reviews it.
              </p>
            </PartnerModuleCard>
          )}

          <PartnerModuleCard id="history" title="Payout history" padded={false}
            description={requests.data?.total ? `${requests.data.total} request${requests.data.total === 1 ? '' : 's'} on your account.` : undefined}>
            <PartnerTable
              caption="Partner payout requests"
              columns={['Requested', 'Amount', 'Status', 'Reference']}
              minWidth="min-w-[520px]"
              rows={rows.map((row) => (
                <PartnerTableRow key={row.id}>
                  <td className="whitespace-nowrap p-4">
                    <span className="block font-bold text-slate-900">{formatPartnerDate(row.requested_at)}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {row.paid_at ? `paid ${formatPartnerDate(row.paid_at)}` : row.reviewed_at ? `reviewed ${formatPartnerDate(row.reviewed_at)}` : 'awaiting review'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap p-4 font-black text-slate-950">{formatPartnerMoney(row.amount_paise)}</td>
                  <td className="p-4">
                    <PartnerStatusPill status={row.status} label={partnerStatusLabel(row.status)} />
                    {row.rejection_reason ? (
                      <span className="mt-1 block text-[11px] font-semibold text-rose-600">{row.rejection_reason}</span>
                    ) : null}
                  </td>
                  <td className="p-4 text-xs text-slate-500">
                    <span className="block truncate font-mono" title={row.provider_reference || row.destination_label}>
                      {row.provider_reference || row.destination_label || '—'}
                    </span>
                  </td>
                </PartnerTableRow>
              ))}
              empty={
                requests.loading && !requests.data ? (
                  <div className="p-6">
                    <PartnerSectionLoading label="Loading your payout requests…" />
                  </div>
                ) : (
                  <PartnerSectionEmpty
                    title="No payout requests yet"
                    body="Submit your first request on the left and its review status will be tracked here."
                    icon={Banknote}
                  />
                )
              }
            />
            {rows.length ? (
              <div className="px-5 pb-5">
                <PartnerPageControls page={page} rowCount={rows.length} pageSize={REQUESTS_PAGE_SIZE} hasMore={hasMore} onPage={setPage} />
              </div>
            ) : null}
          </PartnerModuleCard>
        </div>
      </div>
    </div>
  );
};

export default PartnerWithdrawalsPage;
