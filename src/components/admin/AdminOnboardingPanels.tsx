// ============================================================================
// Operator side of manager onboarding: generate the public link (Super Admin),
// then review what came back.
//
// The review panel is the ONLY place a candidate's Aadhaar/PAN/bank details are
// shown, and the SQL function behind it refuses everybody but a super admin —
// `admin_list_manager_applications()` raises 42501. Documents are opened through
// short-lived signed URLs created by the service-role client, never a public
// bucket URL.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import {
  approveManagerApplication,
  createOnboardingLink,
  listManagerApplications,
  listOnboardingLinks,
  onboardingLinkUrl,
  rejectManagerApplication,
  revokeOnboardingLink,
  type AdminApiError,
  type AdminAccess,
  type ManagerApplication,
  type OnboardingLink,
} from '../../lib/adminApi';
import { roleLabel, SuperAdminOnly } from './AdminSecurity';

const AREA_SUGGESTIONS = ['Jhotwara', 'Vaishali Nagar', 'Malviya Nagar', 'Mansarovar', 'C-Scheme', 'Jagatpura'];

function Card({ title, subtitle, children, actions }: { title: string; subtitle?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p> : null}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

const button = 'rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60';
const quietButton = 'rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100';
const dangerButton = 'rounded-xl border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50';
const input = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200';

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// 1. Onboarding link generator
// ---------------------------------------------------------------------------
export function AdminOnboardingLinksPanel({ access }: { access: AdminAccess }) {
  const [links, setLinks] = useState<OnboardingLink[]>([]);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [workArea, setWorkArea] = useState('');
  const [role, setRole] = useState<'area_manager' | 'sub_admin'>('area_manager');
  const [expiresDays, setExpiresDays] = useState(7);
  const [maxUses, setMaxUses] = useState(1);
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLinks(await listOnboardingLinks(includeClosed));
    } catch (failure) {
      setError((failure as AdminApiError)?.message || 'Onboarding links could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [includeClosed]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createOnboardingLink({
        work_area: workArea,
        role,
        expires_days: expiresDays,
        max_uses: maxUses,
        note: note || undefined,
      });
      setNotice(`${onboardingLinkUrl(created.token)}`);
      setNote('');
      await reload();
    } catch (failure) {
      setError((failure as AdminApiError)?.message || 'That onboarding link could not be created.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <SuperAdminOnly
        access={access}
        fallback={
          <Card title="Onboarding links" subtitle="Only a Super Admin can create or revoke a manager onboarding link.">
            <p className="text-sm text-slate-600">Ask a Super Admin if a new manager needs to be onboarded.</p>
          </Card>
        }
      >
        <Card
          title="Generate a manager onboarding link"
          subtitle="The candidate opens the link, fills the form and uploads documents. Submissions land in Pending verification."
        >
          <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-800">Work area / territory *</span>
              <input
                className={input}
                list="admin-area-suggestions"
                value={workArea}
                onChange={(event) => setWorkArea(event.target.value)}
                placeholder="Jhotwara"
              />
              <datalist id="admin-area-suggestions">
                {AREA_SUGGESTIONS.map((area) => (
                  <option key={area} value={area} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-800">Role</span>
              <select className={input} value={role} onChange={(event) => setRole(event.target.value as 'area_manager' | 'sub_admin')}>
                <option value="area_manager">Area Manager</option>
                <option value="sub_admin">Sub Admin</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-800">Valid for (days)</span>
              <input
                className={input}
                type="number"
                min={1}
                max={365}
                value={expiresDays}
                onChange={(event) => setExpiresDays(Number(event.target.value) || 7)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-800">Usable how many times</span>
              <input
                className={input}
                type="number"
                min={1}
                max={500}
                value={maxUses}
                onChange={(event) => setMaxUses(Number(event.target.value) || 1)}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium text-slate-800">Note for the candidate (optional)</span>
              <input className={input} value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" className={button} disabled={creating || workArea.trim().length < 2}>
                {creating ? 'Creating…' : 'Create link'}
              </button>
            </div>
          </form>
          {notice ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <p className="font-medium">Link ready — copy and share it with the candidate:</p>
              <code className="mt-1 block break-all text-xs">{notice}</code>
              <button type="button" className={`${quietButton} mt-2`} onClick={() => void navigator.clipboard?.writeText(notice)}>
                Copy link
              </button>
            </div>
          ) : null}
        </Card>
      </SuperAdminOnly>

      <Card
        title="Onboarding links"
        subtitle="A link stops working when it is revoked, expired or used up."
        actions={
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={includeClosed} onChange={(event) => setIncludeClosed(event.target.checked)} />
            Show closed links
          </label>
        }
      >
        <ErrorNote message={error} />
        {loading ? (
          <p className="text-sm text-slate-500">Loading links…</p>
        ) : links.length === 0 ? (
          <p className="text-sm text-slate-600">No onboarding links yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {links.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">
                    {link.work_area} · {roleLabel(link.role)}
                  </p>
                  <p className="text-xs text-slate-500">
                    Used {link.uses}/{link.max_uses}
                    {link.expires_at ? ` · expires ${new Date(link.expires_at).toLocaleString('en-IN')}` : ' · no expiry'}
                    {link.exhausted ? ' · closed' : link.is_active ? '' : ' · revoked'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={quietButton}
                    onClick={() => void navigator.clipboard?.writeText(onboardingLinkUrl(link.token))}
                    disabled={link.exhausted || !link.is_active}
                  >
                    Copy link
                  </button>
                  <SuperAdminOnly access={access}>
                    <button
                      type="button"
                      className={dangerButton}
                      disabled={!link.is_active}
                      onClick={async () => {
                        try {
                          await revokeOnboardingLink(link.id);
                          await reload();
                        } catch (failure) {
                          setError((failure as AdminApiError)?.message || 'That link could not be revoked.');
                        }
                      }}
                    >
                      Revoke
                    </button>
                  </SuperAdminOnly>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Application review
// ---------------------------------------------------------------------------
function ApplicationRow({
  application,
  onDone,
  onError,
}: {
  key?: React.Key;
  application: ManagerApplication;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);

  const documents: Array<[string, string | null]> = [
    ['Profile photo', application.photo_path],
    ['Aadhaar front', application.aadhaar_front_path],
    ['Aadhaar back', application.aadhaar_back_path],
    ['PAN card', application.pan_card_path],
  ];

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{application.full_name}</p>
          <p className="text-xs text-slate-600">
            {application.email} · {application.phone}
            {application.whatsapp ? ` · WhatsApp ${application.whatsapp}` : ''}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {application.work_area} · {roleLabel(application.role)} · applied{' '}
            {new Date(application.created_at).toLocaleDateString('en-IN')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={quietButton} onClick={() => setOpen((value) => !value)}>
            {open ? 'Hide documents' : 'Review documents'}
          </button>
        </div>
      </div>

      {open ? (
        <div className="mt-3 space-y-3 rounded-xl bg-slate-50 p-3">
          <div className="grid gap-1 text-xs text-slate-700 sm:grid-cols-2">
            <p>
              Aadhaar: <span className="font-medium">XXXX XXXX {application.aadhaar_last4 || '----'}</span>
            </p>
            <p>
              PAN: <span className="font-medium">{application.pan_number || 'not provided'}</span>
            </p>
            <p>
              Bank: <span className="font-medium">{application.bank_account_name || 'not provided'}</span>{' '}
              {application.bank_account_last4 ? `····${application.bank_account_last4}` : ''}{' '}
              {application.bank_ifsc || ''}
            </p>
            <p>
              UPI: <span className="font-medium">{application.upi_id || 'not provided'}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {documents.map(([label, path]) =>
              path ? (
                <a
                  key={label}
                  className={quietButton}
                  href={`/api/admin/manager-documents/${encodeURIComponent(path)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {label}
                </a>
              ) : (
                <span key={label} className="rounded-xl border border-dashed border-slate-300 px-3 py-1.5 text-xs text-slate-400">
                  {label} missing
                </span>
              )
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">Temporary password for the new account *</span>
              <input
                className={input}
                type="text"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="minimum 8 characters"
              />
              <span className="mt-1 block text-[11px] text-slate-500">
                The manager signs in with their email and this password, then changes it.
              </span>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">Note (required to reject)</span>
              <input className={input} value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={button}
              disabled={busy !== null || password.length < 8}
              onClick={async () => {
                setBusy('approve');
                try {
                  const result = await approveManagerApplication(application.id, password, note || undefined);
                  onDone(`${application.full_name} can now sign in as ${roleLabel(result.role as any)} for ${result.work_area}.`);
                  setOpen(false);
                } catch (failure) {
                  onError((failure as AdminApiError)?.message || 'That application could not be approved.');
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === 'approve' ? 'Approving…' : 'Approve & create account'}
            </button>
            <button
              type="button"
              className={dangerButton}
              disabled={busy !== null || note.trim().length < 3}
              onClick={async () => {
                setBusy('reject');
                try {
                  await rejectManagerApplication(application.id, note.trim());
                  onDone(`${application.full_name}’s application was rejected.`);
                  setOpen(false);
                } catch (failure) {
                  onError((failure as AdminApiError)?.message || 'That application could not be rejected.');
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function AdminManagerApplicationsPanel({ access }: { access: AdminAccess }) {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [items, setItems] = useState<ManagerApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listManagerApplications(status));
    } catch (failure) {
      setError((failure as AdminApiError)?.message || 'Applications could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (access.role !== 'super_admin') {
    return (
      <Card title="Manager applications" subtitle="Only a Super Admin can review documents and approve a manager.">
        <p className="text-sm text-slate-600">
          You are signed in as {roleLabel(access.role)}. Ask a Super Admin to review pending applications.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="Manager applications"
      subtitle="Pending submissions from the public onboarding link. Approving creates the staff account."
      actions={
        <select className={`${input} w-auto`} value={status} onChange={(event) => setStatus(event.target.value as any)}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
      }
    >
      <div className="space-y-3">
        <ErrorNote message={error} />
        {notice ? (
          <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {notice}
          </p>
        ) : null}
        {loading ? (
          <p className="text-sm text-slate-500">Loading applications…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-600">No {status === 'all' ? '' : `${status} `}applications.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((application) => (
              <ApplicationRow
                key={application.id}
                application={application}
                onDone={(message) => {
                  setNotice(message);
                  void reload();
                }}
                onError={setError}
              />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
