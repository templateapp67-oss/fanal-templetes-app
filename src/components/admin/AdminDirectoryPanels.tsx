// ============================================================================
// The operator's working surface: area directory, payout desk and the work /
// audit report.
//
// Role rules, all three layers (SQL, route, UI):
//   • The directory is scoped to the caller's work area in SQL. A manager who
//     edits the `area` query param gets their own area back, not another one.
//   • Approve / Unapprove / Ban are available to any admin inside their area;
//     Soft delete / Restore / area reassignment are Super Admin only, and the
//     RPCs enforce that even if these buttons were removed from the DOM.
//   • Bank/UPI corrections and payout processing are Admin/Super Admin only
//     (`canManageMoney`), mirrored by `private.can_manage_partner_money()`.
//   • Export is Super Admin only and is audited. The button is not rendered for
//     anybody else — and `admin_export_partner_directory()` refuses them anyway.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  assignPartnerArea,
  exportPartnerDirectoryCsv,
  downloadCsv,
  fetchAuditLogs,
  fetchPartnerDirectory,
  fetchPayoutRequests,
  fetchReportSummary,
  formatRupees,
  dialHref,
  whatsappHref,
  waTemplateForPartner,
  processPartnerPayout,
  rewardForecast,
  type AdminPayoutRequest,
  setPartnerState,
  updatePartnerBankDetails,
  type AdminAccess,
  type AdminApiError,
  type AuditLogRow,
  type DirectoryPartner,
  type ModerationAction,
  type ReportSummary,
} from '../../lib/adminApi';
import { RoleGate, SuperAdminOnly, roleLabel } from './AdminSecurity';

const card = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm';
const input = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200';
const quiet = 'rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50';
const danger = 'rounded-xl border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50';
const primary = 'rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60';
const positive = 'rounded-xl border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50';

function Note({ message, tone = 'error' }: { message: string | null; tone?: 'error' | 'ok' }) {
  if (!message) return null;
  const classes = tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900';
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-3 py-2 text-sm ${classes}`}>
      {message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
const SUMMARY_CARDS: Array<{ key: keyof ReportSummary; label: string; hint?: string }> = [
  { key: 'total_partners', label: 'Partners' },
  { key: 'active_partners', label: 'Active' },
  { key: 'inactive_partners', label: 'Inactive' },
  { key: 'banned_partners', label: 'Banned' },
  { key: 'onboarded_salons', label: 'Salons onboarded' },
  { key: 'pending_verifications', label: 'Partner verifications pending' },
  { key: 'pending_manager_applications', label: 'Manager applications pending' },
  { key: 'pending_payouts', label: 'Payout requests open' },
];

export function AdminOverviewPanel({ access }: { access: AdminAccess }) {
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchReportSummary(null)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((failure: AdminApiError) => {
        if (!cancelled) setError(failure?.message || 'The report could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className={card}>
        <h2 className="text-base font-semibold text-slate-900">
          {access.role === 'super_admin' ? 'All territories' : `Your territory: ${access.workArea ?? 'not assigned'}`}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Signed in as {roleLabel(access.role)}. Work tracking counts every partner, the salons they onboarded and the
          approvals waiting on you.
        </p>
        <Note message={error} />
        {summary ? (
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SUMMARY_CARDS.map((entry) => (
              <div key={String(entry.key)} className="rounded-xl bg-slate-50 p-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{entry.label}</dt>
                <dd className="mt-1 text-2xl font-semibold text-slate-900">{Number(summary[entry.key] ?? 0)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-4 text-sm text-slate-500">Loading the report…</p>
        )}
        {summary?.areas?.length ? (
          <p className="mt-4 text-xs text-slate-500">
            Territories in the directory: {summary.areas.filter((area) => area !== 'Unassigned').join(', ') || 'none assigned yet'}
            {summary.partners_with_work_area < summary.total_partners
              ? ` · ${summary.total_partners - summary.partners_with_work_area} partner(s) still need a territory`
              : ''}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Directory
// ---------------------------------------------------------------------------
function PartnerRow({
  partner,
  access,
  showDeleted,
  onChanged,
  onError,
}: {
  key?: React.Key;
  partner: DirectoryPartner;
  access: AdminAccess;
  showDeleted: boolean;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [bank, setBank] = useState({
    payout_method: String(partner.bank_details?.payout_method || 'upi'),
    payout_account_name: String(partner.bank_details?.payout_account_name || ''),
    payout_account_number: String(partner.bank_details?.payout_account_number || ''),
    payout_ifsc: String(partner.bank_details?.payout_ifsc || ''),
    payout_upi_id: String(partner.bank_details?.payout_upi_id || ''),
  });
  const [area, setArea] = useState(partner.work_area || '');

  const forecast = rewardForecast(partner.milestones || []);
  const nextMilestone = (partner.milestones || []).find((milestone) => !milestone.unlocked);

  const act = async (action: ModerationAction) => {
    setBusy(action);
    try {
      await setPartnerState(partner.id, action, reason || undefined);
      onChanged(`${partner.full_name || partner.referral_code} → ${action.replace('_', ' ')} recorded in the audit log.`);
      setReason('');
    } catch (failure) {
      onError((failure as AdminApiError)?.message || 'That action was refused.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">
            {partner.full_name || 'Unnamed partner'}{' '}
            <span className="font-normal text-slate-500">· {partner.referral_code}</span>
          </p>
          <p className="text-xs text-slate-600">
            {partner.work_area || 'No territory'} · {partner.onboarded_salons} salons · {partner.active_referrals} active
            referrals · {formatRupees(partner.lifetime_paise)} lifetime
            {partner.open_payouts ? ` · ${partner.open_payouts} open payout` : ''}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`rounded-full px-2 py-0.5 font-medium ${
                partner.deleted_at
                  ? 'bg-slate-200 text-slate-700'
                  : partner.banned_at
                    ? 'bg-rose-100 text-rose-800'
                    : partner.is_active
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
              }`}
            >
              {partner.deleted_at ? 'deleted' : partner.banned_at ? 'banned' : partner.is_active ? 'active' : 'inactive'}
            </span>
            {partner.status ? <span className="text-slate-500">status: {partner.status}</span> : null}
            {partner.ban_reason ? <span className="text-slate-500">· {partner.ban_reason}</span> : null}
          </p>
          {forecast ? (
            <p className="mt-1 text-xs font-medium text-indigo-700">
              {forecast}
              {nextMilestone ? ` (${partner.onboarded_salons}/${nextMilestone.threshold} salons)` : ''}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dialHref(partner.phone) ? (
            <a className={quiet} href={dialHref(partner.phone) as string}>
              Call
            </a>
          ) : null}
          {whatsappHref(partner.whatsapp || partner.phone) ? (
            <a
              className={positive}
              href={whatsappHref(partner.whatsapp || partner.phone) as string}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp
            </a>
          ) : null}
          <button type="button" className={quiet} onClick={() => setOpen((value) => !value)}>
            {open ? 'Close' : 'Manage'}
          </button>
        </div>
      </div>

      {open ? (
        <div className="mt-3 space-y-4 rounded-xl bg-slate-50 p-3">
          <div className="flex flex-wrap gap-2">
            <RoleGate access={access} capability="moderatePartners">
              {partner.is_active ? (
                <button type="button" className={quiet} disabled={busy !== null} onClick={() => void act('unapprove')}>
                  Unapprove
                </button>
              ) : (
                <button type="button" className={positive} disabled={busy !== null} onClick={() => void act('approve')}>
                  Approve
                </button>
              )}
              {partner.banned_at ? (
                <button type="button" className={positive} disabled={busy !== null} onClick={() => void act('unban')}>
                  Unban
                </button>
              ) : (
                <button
                  type="button"
                  className={danger}
                  disabled={busy !== null || reason.trim().length < 3}
                  onClick={() => void act('ban')}
                >
                  Ban
                </button>
              )}
            </RoleGate>
            <SuperAdminOnly access={access}>
              {partner.deleted_at || showDeleted ? (
                <button type="button" className={positive} disabled={busy !== null} onClick={() => void act('restore')}>
                  Restore
                </button>
              ) : (
                <button
                  type="button"
                  className={danger}
                  disabled={busy !== null || reason.trim().length < 3}
                  onClick={() => void act('soft_delete')}
                >
                  Delete profile
                </button>
              )}
            </SuperAdminOnly>
            <RoleGate access={access} capability="moderatePartners">
              <input
                className={`${input} max-w-xs`}
                placeholder="Reason (required to ban or delete)"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={300}
              />
            </RoleGate>
          </div>

          <SuperAdminOnly access={access}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-700">Work area</span>
                <input className={`${input} w-48`} value={area} onChange={(event) => setArea(event.target.value)} />
              </label>
              <button
                type="button"
                className={quiet}
                disabled={area.trim().length < 2}
                onClick={async () => {
                  try {
                    await assignPartnerArea(partner.id, area.trim());
                    onChanged(`${partner.full_name || partner.referral_code} assigned to ${area.trim()}.`);
                  } catch (failure) {
                    onError((failure as AdminApiError)?.message || 'That territory could not be assigned.');
                  }
                }}
              >
                Assign territory
              </button>
            </div>
          </SuperAdminOnly>

          <RoleGate
            access={access}
            capability="manageMoney"
            fallback={
              <p className="text-xs text-slate-500">
                Payout details are visible as {partner.bank_details?.account_last4 ? `····${partner.bank_details.account_last4}` : 'masked'}.
                Only an Admin or Super Admin can change them.
              </p>
            }
          >
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-700">Payout method</span>
                <select
                  className={input}
                  value={bank.payout_method}
                  onChange={(event) => setBank({ ...bank, payout_method: event.target.value })}
                >
                  <option value="upi">UPI</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="paypal">PayPal</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-700">Account holder</span>
                <input
                  className={input}
                  value={bank.payout_account_name}
                  onChange={(event) => setBank({ ...bank, payout_account_name: event.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-700">Account number</span>
                <input
                  className={input}
                  value={bank.payout_account_number}
                  onChange={(event) => setBank({ ...bank, payout_account_number: event.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-700">IFSC</span>
                <input
                  className={input}
                  value={bank.payout_ifsc}
                  onChange={(event) => setBank({ ...bank, payout_ifsc: event.target.value.toUpperCase() })}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-700">UPI ID</span>
                <input
                  className={input}
                  value={bank.payout_upi_id}
                  onChange={(event) => setBank({ ...bank, payout_upi_id: event.target.value })}
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  className={primary}
                  onClick={async () => {
                    try {
                      await updatePartnerBankDetails(partner.id, bank);
                      onChanged(`Payout details updated for ${partner.full_name || partner.referral_code} (audited).`);
                    } catch (failure) {
                      onError((failure as AdminApiError)?.message || 'Those payout details were refused.');
                    }
                  }}
                >
                  Save payout details
                </button>
              </div>
            </div>
          </RoleGate>
        </div>
      ) : null}
    </li>
  );
}

export function AdminPartnerDirectoryPanel({ access }: { access: AdminAccess }) {
  const [status, setStatus] = useState('all');
  const [area, setArea] = useState('');
  const [search, setSearch] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [partners, setPartners] = useState<DirectoryPartner[]>([]);
  const [total, setTotal] = useState(0);
  const [scopeArea, setScopeArea] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [template, setTemplate] = useState(
    'Hi {{name}}, this is Nexora. Your {{area}} partner account ({{code}}) has an update.'
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchPartnerDirectory({
        area: area || null,
        status: status === 'all' ? null : status,
        search: search || null,
        limit: 100,
        includeDeleted,
      });
      setPartners(payload.items);
      setTotal(payload.total);
      setScopeArea(payload.work_area);
      setSelected(new Set());
    } catch (failure) {
      setError((failure as AdminApiError)?.message || 'The partner directory could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [area, status, search, includeDeleted]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selectedPartners = useMemo(() => partners.filter((partner) => selected.has(partner.id)), [partners, selected]);

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Territory</span>
            <input
              className={`${input} w-44`}
              placeholder={scopeArea ?? 'All areas'}
              value={area}
              onChange={(event) => setArea(event.target.value)}
              disabled={access.role !== 'super_admin'}
            />
            {access.role !== 'super_admin' ? (
              <span className="mt-1 block text-[11px] text-slate-500">Locked to your assigned territory</span>
            ) : null}
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-700">Status</span>
            <select className={`${input} w-40`} value={status} onChange={(event) => setStatus(event.target.value)}>
              {['all', 'active', 'inactive', 'banned', 'pending', 'deleted'].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="block grow">
            <span className="mb-1 block text-xs font-medium text-slate-700">Search</span>
            <input
              className={input}
              placeholder="Name, email, phone or referral code"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <SuperAdminOnly access={access}>
            <label className="flex items-center gap-2 pb-2 text-xs text-slate-600">
              <input type="checkbox" checked={includeDeleted} onChange={(event) => setIncludeDeleted(event.target.checked)} />
              Include deleted
            </label>
          </SuperAdminOnly>
          <button type="button" className={quiet} onClick={() => void reload()}>
            Refresh
          </button>
          <SuperAdminOnly access={access}>
            <button
              type="button"
              className={primary}
              onClick={async () => {
                try {
                  const csv = await exportPartnerDirectoryCsv({ area: area || null, status: status === 'all' ? null : status });
                  downloadCsv(csv);
                  setNotice('Export downloaded. The export itself is written to the audit log.');
                } catch (failure) {
                  setError((failure as AdminApiError)?.message || 'The export was refused.');
                }
              }}
            >
              Export CSV
            </button>
          </SuperAdminOnly>
        </div>
        <div className="mt-3 space-y-2">
          <Note message={error} />
          <Note message={notice} tone="ok" />
          <p className="text-xs text-slate-500">
            Showing {partners.length} of {total} partner(s)
            {access.role === 'super_admin' ? '' : ` in ${scopeArea ?? 'your territory'}`}. Copy protection and the
            watermark are on for your role.
          </p>
        </div>
      </div>

      {selectedPartners.length > 0 ? (
        <div className={card}>
          <h3 className="text-sm font-semibold text-slate-900">
            Bulk WhatsApp — {selectedPartners.length} partner(s) selected
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            Each button opens WhatsApp with the message personalised for that partner. Placeholders:{' '}
            <code>{'{{name}}'}</code>, <code>{'{{area}}'}</code>, <code>{'{{code}}'}</code>.
          </p>
          <textarea
            className={`${input} mt-2 h-20`}
            value={template}
            onChange={(event) => setTemplate(event.target.value)}
            maxLength={600}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {selectedPartners.map((partner) => {
              const href = whatsappHref(partner.whatsapp || partner.phone, waTemplateForPartner(template, partner));
              return href ? (
                <a key={partner.id} className={positive} href={href} target="_blank" rel="noreferrer">
                  {partner.full_name || partner.referral_code}
                </a>
              ) : (
                <span key={partner.id} className="rounded-xl border border-dashed border-slate-300 px-3 py-1.5 text-xs text-slate-400">
                  {partner.full_name || partner.referral_code} — no number
                </span>
              );
            })}
          </div>
          <button type="button" className={`${quiet} mt-2`} onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      ) : null}

      <div className={card}>
        {loading ? (
          <p className="text-sm text-slate-500">Loading partners…</p>
        ) : partners.length === 0 ? (
          <p className="text-sm text-slate-600">
            No partners match those filters. {access.role === 'super_admin' ? 'Try another territory.' : 'Partners appear here once a Super Admin assigns them to your territory.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {partners.map((partner) => (
              <li key={partner.id} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-5"
                  aria-label={`Select ${partner.full_name || partner.referral_code}`}
                  checked={selected.has(partner.id)}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.target.checked) next.add(partner.id);
                    else next.delete(partner.id);
                    setSelected(next);
                  }}
                />
                <div className="min-w-0 grow">
                  <PartnerRow
                    partner={partner}
                    access={access}
                    showDeleted={includeDeleted}
                    onChanged={(message) => {
                      setNotice(message);
                      void reload();
                    }}
                    onError={setError}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payout desk
// ---------------------------------------------------------------------------
export function AdminPayoutsPanel({ access }: { access: AdminAccess }) {
  const [status, setStatus] = useState<'open' | 'paid' | 'rejected' | 'all'>('open');
  const [rows, setRows] = useState<AdminPayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [utrDraft, setUtrDraft] = useState<Record<string, string>>({});
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchPayoutRequests(status));
    } catch (failure) {
      setError((failure as AdminApiError)?.message || 'Payout requests could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const process = async (row: AdminPayoutRequest, action: 'mark_paid' | 'reject') => {
    try {
      await processPartnerPayout(row.id, action, {
        utr: utrDraft[row.id],
        note: noteDraft[row.id] || (action === 'reject' ? 'Rejected by the payout desk' : undefined),
      });
      setNotice(
        action === 'mark_paid'
          ? `${formatRupees(row.amount_paise)} marked paid for ${row.partner_name || row.partner_code}. The partner is notified and the UTR is on record.`
          : `Request from ${row.partner_name || row.partner_code} rejected.`
      );
      await reload();
    } catch (failure) {
      setError((failure as AdminApiError)?.message || 'That payout action was refused.');
    }
  };

  return (
    <div className={card}>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Payout desk</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Mark a request paid with its UTR — the partner is notified and the action is audited. Rejections need a reason.
          </p>
        </div>
        <select className={`${input} w-40`} value={status} onChange={(event) => setStatus(event.target.value as any)}>
          <option value="open">Open</option>
          <option value="paid">Paid</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
      </header>
      <div className="space-y-3">
        <Note message={error} />
        <Note message={notice} tone="ok" />
        <RoleGate
          access={access}
          capability="manageMoney"
          fallback={
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Only an Admin or Super Admin can process a payout. You can see the queue, not move money.
            </p>
          }
        >
          {loading ? (
            <p className="text-sm text-slate-500">Loading payout requests…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-600">No {status === 'all' ? '' : `${status} `}payout requests.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((row) => (
                <li key={row.id} className="space-y-2 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {formatRupees(row.amount_paise)} · {row.partner_name || row.partner_code}
                      </p>
                      <p className="text-xs text-slate-600">
                        {row.payout_method} → {row.destination_label} · {row.work_area || 'no territory'} ·{' '}
                        {new Date(row.requested_at).toLocaleString('en-IN')}
                      </p>
                      {row.provider_reference ? (
                        <p className="text-xs text-emerald-700">UTR {row.provider_reference}</p>
                      ) : null}
                      {row.rejection_reason ? <p className="text-xs text-rose-700">Rejected: {row.rejection_reason}</p> : null}
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{row.status}</span>
                  </div>
                  {row.status === 'pending' || row.status === 'in_review' ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-slate-700">UTR / reference</span>
                        <input
                          className={`${input} w-48`}
                          value={utrDraft[row.id] || ''}
                          onChange={(event) => setUtrDraft({ ...utrDraft, [row.id]: event.target.value })}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-slate-700">Reason (to reject)</span>
                        <input
                          className={`${input} w-56`}
                          value={noteDraft[row.id] || ''}
                          onChange={(event) => setNoteDraft({ ...noteDraft, [row.id]: event.target.value })}
                        />
                      </label>
                      <button
                        type="button"
                        className={primary}
                        disabled={(utrDraft[row.id] || '').trim().length < 6}
                        onClick={() => void process(row, 'mark_paid')}
                      >
                        Mark paid
                      </button>
                      <button
                        type="button"
                        className={danger}
                        disabled={(noteDraft[row.id] || '').trim().length < 3}
                        onClick={() => void process(row, 'reject')}
                      >
                        Reject
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </RoleGate>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Work / audit report
// ---------------------------------------------------------------------------
const ACTION_LABELS: Record<string, string> = {
  partner_approve: 'Partner approved',
  partner_unapprove: 'Partner unapproved',
  partner_ban: 'Partner banned',
  partner_unban: 'Partner unbanned',
  partner_soft_delete: 'Partner profile deleted',
  partner_restore: 'Partner restored',
  partner_area_assigned: 'Territory assigned',
  partner_bank_details_updated: 'Payout details changed',
  partner_payout_paid: 'Payout marked paid',
  partner_payout_rejected: 'Payout rejected',
  partner_status_changed: 'Status changed',
  partner_directory_exported: 'Directory exported',
  manager_application_submitted: 'Manager application submitted',
  manager_application_approved: 'Manager approved',
  manager_application_rejected: 'Manager rejected',
  manager_onboarding_link_created: 'Onboarding link created',
  manager_onboarding_link_revoked: 'Onboarding link revoked',
};

export function AdminAuditPanel({ access }: { access: AdminAccess }) {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchAuditLogs({ limit: 100 }), fetchReportSummary(null)])
      .then(([rows, report]) => {
        if (cancelled) return;
        setLogs(rows);
        setSummary(report);
      })
      .catch((failure: AdminApiError) => {
        if (!cancelled) setError(failure?.message || 'The audit trail could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className={card}>
        <h2 className="text-base font-semibold text-slate-900">Work tracking</h2>
        <p className="mt-1 text-sm text-slate-600">
          Active vs inactive partners, salons onboarded and the verifications still waiting.
        </p>
        {summary ? (
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              ['Active partners', summary.active_partners],
              ['Inactive / banned', summary.inactive_partners + summary.banned_partners],
              ['Salons onboarded', summary.onboarded_salons],
              ['Partner verifications pending', summary.pending_verifications],
              ['Manager applications pending', summary.pending_manager_applications],
              ['Payout requests open', summary.pending_payouts],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl bg-slate-50 p-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                <dd className="mt-1 text-xl font-semibold text-slate-900">{Number(value)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      <div className={card}>
        <h2 className="text-base font-semibold text-slate-900">Audit trail</h2>
        <p className="mt-1 text-sm text-slate-600">
          Every status change, payout approval and profile modification, newest first.
          {access.role === 'super_admin' ? ' You see every territory.' : ` You see your territory (${access.workArea ?? 'unassigned'}).`}
        </p>
        <div className="mt-3 space-y-3">
          <Note message={error} />
          {loading ? (
            <p className="text-sm text-slate-500">Loading the trail…</p>
          ) : logs.length === 0 ? (
            <p className="text-sm text-slate-600">Nothing has been recorded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {logs.map((row) => (
                <li key={row.id} className="py-2">
                  <p className="font-medium text-slate-900">{ACTION_LABELS[row.action] || row.action}</p>
                  <p className="text-xs text-slate-600">
                    {row.actor_email || 'system'} ({row.actor_role}) · {row.work_area || 'no territory'} ·{' '}
                    {new Date(row.created_at).toLocaleString('en-IN')}
                    {row.reason ? ` · ${row.reason}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
