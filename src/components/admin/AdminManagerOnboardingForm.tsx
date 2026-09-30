// ============================================================================
// The PUBLIC manager onboarding form — what a candidate sees at
// /admin/onboard-manager?token=…
//
// There is no session here: possession of a valid, unused, unexpired link token
// IS the authorization. So the form is deliberately careful:
//
//   • the link is validated server-side BEFORE anything renders (area + role
//     come from the link row, never from the URL), and a dead link explains
//     itself instead of showing a form that will be refused;
//   • every refusal the SQL function raises names a field, and the message is
//     placed UNDER that field (`refusalField`) — the same field-level error
//     pattern the Growth Partner application form uses;
//   • documents go up ONE at a time through the server route (the bucket is
//     private and the candidate has no credentials), and each upload reports
//     its own failure, so a 10 MB scan does not lose the typed form.
//
// The form never submits bank details it could not validate: IFSC, PAN and
// Aadhaar formats are checked here as well as in SQL, because a round trip is a
// worse place to learn that a PAN is malformed.
// ============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  fetchOnboardingLink,
  onboardingLinkReason,
  submitManagerApplication,
  uploadOnboardingDocument,
  type AdminApiError,
  type OnboardingLinkInfo,
} from '../../lib/adminApi';

type DocumentKind = 'photo' | 'aadhaar_front' | 'aadhaar_back' | 'pan_card';

interface FormState {
  full_name: string;
  email: string;
  phone: string;
  whatsapp: string;
  aadhaar_number: string;
  pan_number: string;
  bank_account_name: string;
  bank_account_number: string;
  bank_ifsc: string;
  upi_id: string;
}

const EMPTY_FORM: FormState = {
  full_name: '',
  email: '',
  phone: '',
  whatsapp: '',
  aadhaar_number: '',
  pan_number: '',
  bank_account_name: '',
  bank_account_number: '',
  bank_ifsc: '',
  upi_id: '',
};

const DOCUMENT_LABELS: Array<{ kind: DocumentKind; label: string; hint: string }> = [
  { kind: 'photo', label: 'Profile photo', hint: 'JPG or PNG, up to 10 MB' },
  { kind: 'aadhaar_front', label: 'Aadhaar — front', hint: 'Photo or PDF scan' },
  { kind: 'aadhaar_back', label: 'Aadhaar — back', hint: 'Photo or PDF scan' },
  { kind: 'pan_card', label: 'PAN card', hint: 'Photo or PDF scan' },
];

/** Client-side mirror of the SQL checks — same messages, no round trip. */
export function validateManagerApplication(form: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (form.full_name.trim().length < 2) errors.full_name = 'Full name is required.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) errors.email = 'Enter a valid email address.';
  const phone = form.phone.replace(/[^0-9]/g, '');
  if (phone.length < 10 || phone.length > 15) errors.phone = 'Enter a valid 10-digit phone number.';
  const whatsapp = form.whatsapp.replace(/[^0-9]/g, '');
  if (whatsapp && (whatsapp.length < 10 || whatsapp.length > 15)) errors.whatsapp = 'Enter a valid WhatsApp number.';
  const aadhaar = form.aadhaar_number.replace(/[^0-9]/g, '');
  if (aadhaar && aadhaar.length !== 12) errors.aadhaar_number = 'Aadhaar number must be exactly 12 digits.';
  const pan = form.pan_number.trim().toUpperCase();
  if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) errors.pan_number = 'PAN must look like ABCDE1234F.';
  const ifsc = form.bank_ifsc.trim().toUpperCase();
  if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) errors.bank_ifsc = 'IFSC must look like HDFC0001234.';
  const account = form.bank_account_number.replace(/[^0-9]/g, '');
  if (account && account.length < 6) errors.bank_account_number = 'Account number must be at least 6 digits.';
  return errors;
}

function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-800">
        {label} {required ? <span className="text-rose-600">*</span> : null}
      </span>
      {children}
      {hint && !error ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
      {error ? (
        <span role="alert" className="mt-1 block text-xs font-medium text-rose-600">
          {error}
        </span>
      ) : null}
    </label>
  );
}

const inputClass =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200';

export function AdminManagerOnboardingForm({ token }: { token: string }) {
  const [link, setLink] = useState<OnboardingLinkInfo | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [documents, setDocuments] = useState<Partial<Record<DocumentKind, string>>>({});
  const [documentErrors, setDocumentErrors] = useState<Partial<Record<DocumentKind, string>>>({});
  const [uploading, setUploading] = useState<DocumentKind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ id: string; work_area: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setLink({ valid: false, reason: 'not_found' });
      return;
    }
    fetchOnboardingLink(token)
      .then((info) => {
        if (cancelled) return;
        setLink(info);
        if (!info.valid) setLinkError(onboardingLinkReason(info));
      })
      .catch((error: AdminApiError) => {
        if (!cancelled) setLinkError(error?.message || 'This onboarding link could not be checked.');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const requiredDocuments = useMemo(() => Array.from(new Set(DOCUMENT_LABELS.map((entry) => entry.kind))), []);

  const handleUpload = async (kind: DocumentKind, file: File | undefined) => {
    if (!file) return;
    setUploading(kind);
    setDocumentErrors((current) => ({ ...current, [kind]: undefined }));
    try {
      const result = await uploadOnboardingDocument(token, kind, file);
      setDocuments((current) => ({ ...current, [kind]: result.path }));
    } catch (error) {
      setDocumentErrors((current) => ({
        ...current,
        [kind]: (error as AdminApiError)?.message || 'That document could not be uploaded.',
      }));
    } finally {
      setUploading(null);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);
    const errors = validateManagerApplication(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setFormError('Please correct the highlighted fields.');
      return;
    }
    setSubmitting(true);
    try {
      const record = await submitManagerApplication(token, {
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.replace(/[^0-9]/g, ''),
        whatsapp: form.whatsapp.replace(/[^0-9]/g, '') || undefined,
        photo_path: documents.photo ?? null,
        aadhaar_number: form.aadhaar_number.replace(/[^0-9]/g, ''),
        aadhaar_front_path: documents.aadhaar_front ?? null,
        aadhaar_back_path: documents.aadhaar_back ?? null,
        pan_number: form.pan_number.trim().toUpperCase(),
        pan_card_path: documents.pan_card ?? null,
        bank_account_name: form.bank_account_name.trim() || undefined,
        bank_account_number: form.bank_account_number.replace(/[^0-9]/g, '') || undefined,
        bank_ifsc: form.bank_ifsc.trim().toUpperCase() || undefined,
        upi_id: form.upi_id.trim() || undefined,
      });
      setSubmitted({ id: record.id, work_area: record.work_area });
    } catch (error) {
      const failure = error as AdminApiError;
      if (failure?.field) {
        setFieldErrors((current) => ({ ...current, [failure.field as string]: failure.message }));
      }
      setFormError(failure?.message || 'Your application could not be submitted. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!link && !linkError) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl items-center justify-center p-6">
        <p role="status" className="text-sm text-slate-600">
          Checking this onboarding link…
        </p>
      </main>
    );
  }

  if (linkError) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl items-center justify-center p-6">
        <div className="w-full rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
          <h1 className="text-lg font-semibold text-rose-900">This onboarding link cannot be used</h1>
          <p className="mt-2 text-sm text-rose-800">{linkError}</p>
        </div>
      </main>
    );
  }

  if (submitted) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl items-center justify-center p-6">
        <div className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <h1 className="text-lg font-semibold text-emerald-900">Application submitted</h1>
          <p className="mt-2 text-sm text-emerald-800">
            Your details for <span className="font-medium">{submitted.work_area}</span> are now with the Super Admin for
            verification. You will be contacted on the phone number you provided once the documents are reviewed.
          </p>
          <p className="mt-3 text-xs text-emerald-700">Reference: {submitted.id}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-3xl bg-slate-50 p-4 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Manager onboarding</h1>
        <p className="mt-1 text-sm text-slate-600">
          You are applying for <span className="font-medium text-slate-900">{link?.work_area}</span> as a{' '}
          <span className="font-medium text-slate-900">
            {link?.role === 'sub_admin' ? 'Sub Admin' : 'Area Manager'}
          </span>
          . Documents are reviewed by the Super Admin and are stored privately.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        {formError ? (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {formError}
          </p>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Personal details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required error={fieldErrors.full_name}>
              <input
                className={inputClass}
                value={form.full_name}
                onChange={(event) => setForm({ ...form, full_name: event.target.value })}
                autoComplete="name"
              />
            </Field>
            <Field label="Email address" required error={fieldErrors.email}>
              <input
                className={inputClass}
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                autoComplete="email"
              />
            </Field>
            <Field label="Phone number" required error={fieldErrors.phone}>
              <input
                className={inputClass}
                inputMode="numeric"
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                autoComplete="tel"
              />
            </Field>
            <Field label="WhatsApp number" hint="Leave blank if it is the same as your phone" error={fieldErrors.whatsapp}>
              <input
                className={inputClass}
                inputMode="numeric"
                value={form.whatsapp}
                onChange={(event) => setForm({ ...form, whatsapp: event.target.value })}
              />
            </Field>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Identity documents</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Aadhaar number" hint="12 digits" error={fieldErrors.aadhaar_number}>
              <input
                className={inputClass}
                inputMode="numeric"
                value={form.aadhaar_number}
                onChange={(event) => setForm({ ...form, aadhaar_number: event.target.value })}
              />
            </Field>
            <Field label="PAN card number" hint="e.g. ABCDE1234F" error={fieldErrors.pan_number}>
              <input
                className={inputClass}
                value={form.pan_number}
                onChange={(event) => setForm({ ...form, pan_number: event.target.value.toUpperCase() })}
              />
            </Field>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {DOCUMENT_LABELS.map((entry) => (
              <label key={entry.kind} className="block rounded-xl border border-dashed border-slate-300 p-3">
                <span className="block text-sm font-medium text-slate-800">{entry.label}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{entry.hint}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  className="mt-2 block w-full text-xs text-slate-600"
                  onChange={(event) => void handleUpload(entry.kind, event.target.files?.[0])}
                />
                {uploading === entry.kind ? <span className="mt-1 block text-xs text-slate-500">Uploading…</span> : null}
                {documents[entry.kind] ? (
                  <span className="mt-1 block text-xs font-medium text-emerald-700">Uploaded ✓</span>
                ) : null}
                {documentErrors[entry.kind] ? (
                  <span role="alert" className="mt-1 block text-xs font-medium text-rose-600">
                    {documentErrors[entry.kind]}
                  </span>
                ) : null}
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Payout details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Account holder name" error={fieldErrors.bank_account_name}>
              <input
                className={inputClass}
                value={form.bank_account_name}
                onChange={(event) => setForm({ ...form, bank_account_name: event.target.value })}
              />
            </Field>
            <Field label="Bank account number" error={fieldErrors.bank_account_number}>
              <input
                className={inputClass}
                inputMode="numeric"
                value={form.bank_account_number}
                onChange={(event) => setForm({ ...form, bank_account_number: event.target.value })}
              />
            </Field>
            <Field label="IFSC" hint="e.g. HDFC0001234" error={fieldErrors.bank_ifsc}>
              <input
                className={inputClass}
                value={form.bank_ifsc}
                onChange={(event) => setForm({ ...form, bank_ifsc: event.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="UPI ID" hint="Optional, if you prefer UPI payouts">
              <input
                className={inputClass}
                value={form.upi_id}
                onChange={(event) => setForm({ ...form, upi_id: event.target.value })}
              />
            </Field>
          </div>
        </section>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            {requiredDocuments.length} document slots · stored in a private bucket readable only by the Super Admin.
          </p>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit for verification'}
          </button>
        </div>
      </form>
    </main>
  );
}
