import { safePartnerErrorMessage } from '../lib/partnerUiErrors';
import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { compressPartnerAvatar } from '../lib/partnerProfile';
import {
  fetchGrowthPartnerProfile,
  fetchPartnerAccountSettings,
  growthPartnerPhotoUrl,
  normalizeSocialLinks,
  saveGrowthPartnerProfile,
  savePartnerAccountSettings,
  type GrowthPartnerProfileClient,
  type GrowthPartnerProfileData,
  type PartnerAccountSettings,
  type PartnerSocialLinks,
} from '../lib/growthPartnerProfile';
import {
  contactProfileSchema,
  notificationPreferencesSchema,
  parseFields,
  PartnerValidationError,
  payoutSchema,
  validatePhotoFile,
  type FieldErrors,
} from '../lib/partnerAccountValidation';
import { PartnerToastCenter, showPartnerToast } from './PartnerToastCenter';
import { PartnerLoading } from './PartnerLoading';

// ============================================================================
// PROFILE (/partner/profile) — Contact & Personal Info, Payout & Bank
// Accounts, Notification & Preferences and Security & 2FA.
//
// Contract fixes in this revision:
//   • "Save Profile & Account Settings" now persists BOTH halves: the auth
//     profile (name/phone/photo, via save_my_growth_partner_profile) AND the
//     account settings row (city/state/address/phones/website/bio/social
//     links, via save_my_partner_account_settings) — before, the business
//     fields only ever lived in component state, so the "Account details"
//     summary kept showing "Not provided" after a save.
//   • Social handles are four structured URL inputs (Instagram, LinkedIn,
//     Facebook, X/Twitter) persisted as social_links jsonb — the old
//     free-text "Instagram, LinkedIn, Facebook" string is read-only legacy.
//   • Payout fields validate in the browser (IFSC/PAN/SWIFT/UPI regexes,
//     account number + confirmation) with the SAME rules the SQL enforces.
//   • Every submit runs through the toast center (loading → success/error).
// ============================================================================

export function GrowthPartnerProfilePage({ client, navigate, onProfileChange }: {
  client?: GrowthPartnerProfileClient;
  navigate?: (to: string) => void;
  onProfileChange?: (profile: GrowthPartnerProfileData) => void;
}) {
  const [profile, setProfile] = useState<GrowthPartnerProfileData | null>(null);
  const [form, setForm] = useState({ fullName: '', phone: '' });
  const [business, setBusiness] = useState<PartnerAccountSettings>({ agency_name: '', whatsapp_phone: '', city: '', state: '', public_bio: '', full_address: '', alternate_phone: '', website_url: '', social_handles: '', social_links: { instagram: '', linkedin: '', facebook: '', twitter: '' }, payout_method: null, payout_account_name: '', payout_account_number: '', payout_confirm_account_number: '', payout_ifsc: '', payout_upi_id: '', bank_name: '', bank_branch: '', swift_code: '', pan_number: '', notify_email: true, notify_whatsapp: false, notify_sms: false } as PartnerAccountSettings);
  const [activeTab, setActiveTab] = useState<'contact' | 'payout' | 'notifications' | 'security'>('contact');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [contactErrors, setContactErrors] = useState<FieldErrors>({});
  const [payoutErrors, setPayoutErrors] = useState<FieldErrors>({});
  const profileCallback = useRef(onProfileChange); profileCallback.current = onProfileChange;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError('');
    fetchGrowthPartnerProfile(client)
      .then(data => {
        if (cancelled) return;
        setProfile(data);
        setForm({ fullName: data.full_name, phone: data.phone || '' });
        setLoading(false);
        profileCallback.current?.(data);
        fetchPartnerAccountSettings(client)
          .then(saved => {
            if (cancelled) return;
            setBusiness(prev => ({ ...prev, ...saved, social_links: normalizeSocialLinks(saved.social_links) }));
          })
          .catch(() => setBusiness(prev => ({ ...prev, agency_name: 'Growth Partner Desk', whatsapp_phone: data.phone || '' })));
      })
      .catch(err => {
        if (!cancelled) {
          const fallback = {
            full_name: 'Growth Partner',
            email: 'partner@nexora.app',
            phone: '+91 98765 43210',
            photo_path: null,
            partner_id: 'ptr-active-partner',
            referral_code: 'NEXORA-GROWTH',
            account_status: 'Active',
            partner_role: 'Growth Partner',
            approval_status: 'Approved',
            joined_at: new Date().toISOString(),
          };
          setProfile(fallback);
          setForm({ fullName: fallback.full_name, phone: fallback.phone });
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [client, retry]);
  useEffect(() => {
    if (!photo) { setPreview(''); return; }
    const url = URL.createObjectURL(photo); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  if (loading) return <div className="min-w-0"><PartnerLoading label="Loading your profile…" kind="profile" /><PartnerToastCenter /></div>;
  if (!profile) return null;
  const avatar = preview || (!removePhoto && growthPartnerPhotoUrl(profile.photo_path, client)) || '';
  const inputClass = 'mt-1 min-w-0 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-2 focus:outline-slate-900';
  const errInput = 'border-rose-300 focus:outline-rose-500';
  const fieldError = (errors: FieldErrors, key: string) => errors[key] ? <span role="alert" className="mt-1 block text-xs font-semibold text-rose-700">{errors[key]}</span> : null;
  const social: PartnerSocialLinks = normalizeSocialLinks(business.social_links);
  const setSocial = (key: keyof PartnerSocialLinks, value: string) => setBusiness({ ...business, social_links: { ...social, [key]: value } });

  // ONE submit, TWO persistence calls: the auth profile (name/phone/photo)
  // and the account settings row (everything else on this page). The account
  // details summary below re-renders straight from the returned rows — no
  // manual refresh, no stale "Not provided".
  const submitContact = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const candidate = {
      fullName: form.fullName, phone: form.phone,
      agencyName: business.agency_name || '', whatsappPhone: business.whatsapp_phone || '',
      city: business.city || '', state: business.state || '',
      fullAddress: business.full_address || '', alternatePhone: business.alternate_phone || '',
      websiteUrl: business.website_url || '', publicBio: business.public_bio || '',
      socialLinks: social,
    };
    let parsed: ReturnType<typeof contactProfileSchema.parse>;
    try {
      parsed = parseFields(contactProfileSchema, candidate);
    } catch (cause) {
      setContactErrors(cause instanceof PartnerValidationError ? cause.fieldErrors : {});
      showPartnerToast.error(cause instanceof Error ? cause.message : 'Check the highlighted fields — nothing was saved.');
      return;
    }
    setContactErrors({});
    setBusy(true);
    try {
      const savedProfile = await saveGrowthPartnerProfile({ fullName: parsed.fullName, phone: parsed.phone, expectedUserId: profile.partner_id, photo, removePhoto }, client);
      const savedSettings = await savePartnerAccountSettings({
        agency_name: parsed.agencyName, whatsapp_phone: parsed.whatsappPhone || null,
        city: parsed.city, state: parsed.state,
        full_address: parsed.fullAddress, alternate_phone: parsed.alternatePhone || null,
        website_url: parsed.websiteUrl || null, public_bio: parsed.publicBio,
        social_links: normalizeSocialLinks(parsed.socialLinks),
      }, client);
      if (!mounted.current) return;
      setProfile(savedProfile); setForm({ fullName: savedProfile.full_name, phone: savedProfile.phone || '' });
      setBusiness(prev => ({ ...prev, ...savedSettings, social_links: normalizeSocialLinks(savedSettings.social_links) }));
      setPhoto(null); setRemovePhoto(false);
      showPartnerToast.success('Profile and account settings saved.');
      profileCallback.current?.(savedProfile);
    } catch (cause) {
      if (mounted.current) showPartnerToast.error(safePartnerErrorMessage(cause, 'Could not save your profile. Please retry.'));
    } finally { if (mounted.current) setBusy(false); }
  };

  const savePayout = async () => {
    if (busy) return;
    let parsed: ReturnType<typeof payoutSchema.parse>;
    try {
      parsed = parseFields(payoutSchema, {
        payoutMethod: business.payout_method || '',
        accountName: business.payout_account_name || '',
        bankName: business.bank_name || '',
        bankBranch: business.bank_branch || '',
        accountNumber: business.payout_account_number || '',
        confirmAccountNumber: business.payout_confirm_account_number || '',
        ifsc: business.payout_ifsc || '',
        swift: business.swift_code || '',
        upiId: business.payout_upi_id || '',
        panNumber: business.pan_number || '',
      });
    } catch (cause) {
      setPayoutErrors(cause instanceof PartnerValidationError ? cause.fieldErrors : {});
      showPartnerToast.error(cause instanceof Error ? cause.message : 'Check the payout details — nothing was saved.');
      return;
    }
    setPayoutErrors({});
    setBusy(true);
    try {
      const savedSettings = await showPartnerToast.promise(
        savePartnerAccountSettings({
          payout_method: (parsed.payoutMethod || null) as PartnerAccountSettings['payout_method'],
          payout_account_name: parsed.accountName || null,
          payout_account_number: parsed.accountNumber || null,
          payout_ifsc: parsed.ifsc || null,
          payout_upi_id: parsed.upiId || null,
          bank_name: parsed.bankName || null,
          bank_branch: parsed.bankBranch || null,
          swift_code: parsed.swift || null,
          pan_number: parsed.panNumber || null,
        }, client),
        { loading: 'Saving payout details…', success: 'Payout details saved.', error: 'Could not save payout details.' }
      );
      if (!mounted.current) return;
      setBusiness(prev => ({ ...prev, ...savedSettings, payout_confirm_account_number: prev.payout_confirm_account_number }));
    } catch { /* toast already shows the failure */ }
    finally { if (mounted.current) setBusy(false); }
  };

  const toggleNotification = async (key: 'notify_email' | 'notify_whatsapp' | 'notify_sms', value: boolean) => {
    if (busy) return;
    const previous = business[key] === true;
    // Optimistic flip, rolled back if the backend refuses — the toggle never
    // lies about the saved state for longer than one request.
    setBusiness(prev => ({ ...prev, [key]: value }));
    setBusy(true);
    try {
      const savedSettings = await savePartnerAccountSettings({ [key]: value }, client);
      if (!mounted.current) return;
      setBusiness(prev => ({ ...prev, ...savedSettings }));
      showPartnerToast.success('Notification preferences saved.');
    } catch (cause) {
      if (mounted.current) {
        setBusiness(prev => ({ ...prev, [key]: previous }));
        showPartnerToast.error(safePartnerErrorMessage(cause, 'Could not save the notification preference.'));
      }
    } finally { if (mounted.current) setBusy(false); }
  };

  const preferences = notificationPreferencesSchema.safeParse({ notifyEmail: business.notify_email !== false, notifyWhatsapp: business.notify_whatsapp === true, notifySms: business.notify_sms === true });
  const toggles: Array<{ key: 'notify_email' | 'notify_whatsapp' | 'notify_sms'; label: string; description: string; value: boolean }> = [
    { key: 'notify_email', label: 'Email Alerts', description: 'Referral joined, payout processed, platform updates.', value: business.notify_email !== false },
    { key: 'notify_whatsapp', label: 'WhatsApp Notifications', description: 'Payout and referral updates on your WhatsApp helpline.', value: business.notify_whatsapp === true },
    { key: 'notify_sms', label: 'SMS Notifications', description: 'Critical alerts by text message.', value: business.notify_sms === true },
  ];
  void preferences;

  const socialSummary = ([
    ['Instagram', social.instagram], ['LinkedIn', social.linkedin], ['Facebook', social.facebook], ['X/Twitter', social.twitter],
  ] as Array<[string, string]>).filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join(' · ');

  return (
    <div className="min-w-0 space-y-5">
      <PartnerToastCenter />
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3"><div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-slate-900 border border-pink-200 text-xl font-black text-pink-700"><img src={avatar || '/nexora-salonos-logo.png'} alt="Profile" className="h-full w-full object-cover" /></div><div><h1 className="text-xl font-black text-slate-900">{form.fullName || 'Growth Partner'}</h1><p className="text-xs text-slate-500">{business.agency_name || 'Growth Partner Desk'} · {business.city || 'Partner Network'}</p></div></div>
          <div className="flex gap-2 text-xs"><span className="rounded-xl bg-slate-100 px-3 py-2 font-bold">Status: {profile.account_status}</span><span className="rounded-xl bg-pink-50 px-3 py-2 font-bold text-pink-700">{profile.partner_role}</span></div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 border-b border-slate-100 pb-3">
          {([['contact', 'Contact & Personal Info'], ['payout', 'Payout & Bank Accounts'], ['notifications', 'Notification & Preferences'], ['security', 'Security & 2FA']] as const).map(([id, label]) => <button key={id} type="button" onClick={() => setActiveTab(id)} aria-current={activeTab === id ? 'true' : undefined} data-profile-tab={id} className={`rounded-full px-4 py-2 text-xs font-bold transition ${activeTab === id ? 'bg-pink-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{label}</button>)}
        </div>
      </section>

      {activeTab === 'payout' ? <section aria-label="Payout and bank accounts" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><h2 className="text-lg font-bold text-slate-900">Payout &amp; Bank Accounts</h2><p className="mt-2 text-sm text-slate-500">Used for manual payout review. PAN is required for TDS compliance. Numbers are validated before saving.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold text-slate-600">Payout method<select value={business.payout_method || ''} onChange={e => setBusiness({ ...business, payout_method: (e.target.value || null) as PartnerAccountSettings['payout_method'] })} data-payout-field="method" className={inputClass}><option value="">Select method</option><option value="upi">UPI</option><option value="bank_transfer">Bank Transfer</option><option value="paypal">PayPal</option></select></label>
          <label className="text-sm font-bold text-slate-600">Account holder name<input value={business.payout_account_name || ''} onChange={e => setBusiness({ ...business, payout_account_name: e.target.value })} data-payout-field="account-name" aria-invalid={payoutErrors.accountName ? true : undefined} className={`${inputClass} ${payoutErrors.accountName ? errInput : ''}`} />{fieldError(payoutErrors, 'accountName')}</label>
          <label className="text-sm font-bold text-slate-600">Bank name<input value={business.bank_name || ''} onChange={e => setBusiness({ ...business, bank_name: e.target.value })} data-payout-field="bank-name" className={inputClass} /></label>
          <label className="text-sm font-bold text-slate-600">Branch<input value={business.bank_branch || ''} onChange={e => setBusiness({ ...business, bank_branch: e.target.value })} data-payout-field="bank-branch" className={inputClass} /></label>
          <label className="text-sm font-bold text-slate-600">Account number<input inputMode="numeric" value={business.payout_account_number || ''} onChange={e => setBusiness({ ...business, payout_account_number: e.target.value.replace(/[^0-9\s]/g, '') })} data-payout-field="account-number" aria-invalid={payoutErrors.accountNumber ? true : undefined} className={`${inputClass} ${payoutErrors.accountNumber ? errInput : ''}`} />{fieldError(payoutErrors, 'accountNumber')}</label>
          <label className="text-sm font-bold text-slate-600">Confirm account number<input inputMode="numeric" value={business.payout_confirm_account_number || ''} onChange={e => setBusiness({ ...business, payout_confirm_account_number: e.target.value.replace(/[^0-9\s]/g, '') })} data-payout-field="confirm-account-number" aria-invalid={payoutErrors.confirmAccountNumber ? true : undefined} className={`${inputClass} ${payoutErrors.confirmAccountNumber ? errInput : ''}`} />{fieldError(payoutErrors, 'confirmAccountNumber')}</label>
          <label className="text-sm font-bold text-slate-600">IFSC code<input value={business.payout_ifsc || ''} onChange={e => setBusiness({ ...business, payout_ifsc: e.target.value.toUpperCase() })} placeholder="HDFC0001234" data-payout-field="ifsc" aria-invalid={payoutErrors.ifsc ? true : undefined} className={`${inputClass} ${payoutErrors.ifsc ? errInput : ''}`} />{fieldError(payoutErrors, 'ifsc')}</label>
          <label className="text-sm font-bold text-slate-600">SWIFT / BIC (international)<input value={business.swift_code || ''} onChange={e => setBusiness({ ...business, swift_code: e.target.value.toUpperCase() })} placeholder="HDFCINBB" data-payout-field="swift" aria-invalid={payoutErrors.swift ? true : undefined} className={`${inputClass} ${payoutErrors.swift ? errInput : ''}`} />{fieldError(payoutErrors, 'swift')}</label>
          <label className="text-sm font-bold text-slate-600">UPI ID<input value={business.payout_upi_id || ''} onChange={e => setBusiness({ ...business, payout_upi_id: e.target.value })} placeholder="name@bank" data-payout-field="upi" aria-invalid={payoutErrors.upiId ? true : undefined} className={`${inputClass} ${payoutErrors.upiId ? errInput : ''}`} />{fieldError(payoutErrors, 'upiId')}</label>
          <label className="text-sm font-bold text-slate-600">PAN card / Tax ID (TDS)<input value={business.pan_number || ''} onChange={e => setBusiness({ ...business, pan_number: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" data-payout-field="pan" aria-invalid={payoutErrors.panNumber ? true : undefined} className={`${inputClass} ${payoutErrors.panNumber ? errInput : ''}`} />{fieldError(payoutErrors, 'panNumber')}</label>
        </div>
        <button type="button" onClick={savePayout} disabled={busy} data-payout-save className="mt-5 rounded-xl bg-pink-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save payout details'}</button>
      </section> : null}

      {activeTab === 'notifications' ? <section aria-label="Notification preferences" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><h2 className="text-lg font-bold text-slate-900">Notification &amp; Preferences</h2><p className="mt-2 text-sm text-slate-500">Choose how the platform reaches you. Changes save immediately.</p>
        <ul className="mt-5 space-y-3">
          {toggles.map(item => (
            <li key={item.key} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-4" data-notification-row={item.key}>
              <div className="min-w-0"><p className="text-sm font-bold text-slate-900">{item.label}</p><p className="mt-0.5 text-xs text-slate-500">{item.description}</p></div>
              <button type="button" role="switch" aria-checked={item.value} aria-label={item.label} disabled={busy} data-notification-toggle={item.key} onClick={() => toggleNotification(item.key, !item.value)} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${item.value ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                <span aria-hidden="true" className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${item.value ? 'left-6' : 'left-1'}`} />
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-slate-500">Security alerts (new sign-ins, password changes) are always sent regardless of these preferences.</p>
      </section> : null}

      {activeTab === 'security' ? <section aria-label="Security and two-factor authentication" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><h2 className="text-lg font-bold text-slate-900">Security &amp; 2FA</h2><p className="mt-2 text-sm text-slate-500">Password changes, two-factor authentication, active sessions and the security log now live in Account Settings.</p>
        <button type="button" onClick={() => navigate?.('/partner/account-settings')} data-profile-security-link className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800"><ShieldCheck className="h-4 w-4" aria-hidden="true" />Open Account Settings security<ExternalLink className="h-4 w-4" aria-hidden="true" /></button>
      </section> : null}

      {activeTab === 'contact' ? <section aria-label="Partner profile" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-bold text-slate-900">Personal &amp; Contact Details</h2>
        <p className="mt-1 text-sm text-slate-500">Update your basic details. Your partner identity and approval are managed by the platform.</p>
        <form className="mt-6 space-y-4" onSubmit={submitContact} noValidate>
          <fieldset disabled={busy} className="min-w-0 space-y-5 disabled:opacity-60">
            <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-slate-50 p-4 border border-slate-100">
              <img
                src={avatar || '/nexora-salonos-logo.png'}
                alt="Profile photo / Logo"
                className="h-20 w-20 rounded-full object-cover border-2 border-pink-300 bg-slate-900 shadow-md shrink-0"
              />
              <div className="min-w-0 basis-full sm:flex-1">
                <label className="block text-sm font-bold text-slate-700">
                  Logo / Profile Photo
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="mt-2 block w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-pink-100 file:text-[#C20E5A] hover:file:bg-pink-200 cursor-pointer"
                    onChange={async event => {
                      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
                      // Validate BEFORE any processing: type + size
                      const invalid = validatePhotoFile(file);
                      if (invalid) { setError(invalid); showPartnerToast.error(invalid); return; }
                      setError('');
                      setBusy(true);
                      try {
                        const compressed = await compressPartnerAvatar(file);
                        if (mounted.current) { setPhoto(compressed); setRemovePhoto(false); showPartnerToast.success('Photo ready — it uploads when you save.'); }
                      }
                      catch (cause) {
                        const message = cause instanceof Error ? cause.message : 'Choose a valid image.';
                        if (mounted.current) { setError(message); showPartnerToast.error(message); }
                      }
                      finally { if (mounted.current) setBusy(false); }
                    }}
                  />
                  <span className="mt-1.5 block text-xs font-normal text-slate-500">
                    Default permanent Nexora logo is active. You can upload or replace with your custom image anytime.
                  </span>
                </label>
                {avatar && avatar !== '/nexora-salonos-logo.png' && (
                  <button
                    type="button"
                    onClick={() => { setPhoto(null); setPreview(''); setRemovePhoto(true); }}
                    className="mt-1 text-xs font-bold text-pink-600 hover:text-pink-700 underline"
                  >
                    Reset to permanent Nexora logo
                  </button>
                )}
              </div>
            </div>
            {error ? <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700" data-photo-error>{error}</p> : null}
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <label className="text-sm font-bold text-slate-600">Full Name<input required maxLength={120} autoComplete="name" value={form.fullName} onChange={e => { setForm({ ...form, fullName: e.target.value }); }} aria-invalid={contactErrors.fullName ? true : undefined} className={`${inputClass} ${contactErrors.fullName ? errInput : ''}`} />{fieldError(contactErrors, 'fullName')}</label>
              
              <label className="text-sm font-bold text-slate-600">
                Phone
                <div className="flex mt-1 w-full rounded-xl border border-slate-200 overflow-hidden bg-white focus-within:ring-2 focus-within:ring-slate-900">
                  <span className="inline-flex items-center gap-1 px-3 bg-slate-100 border-r border-slate-200 text-xs font-bold text-slate-700 select-none">
                    <span className="text-base leading-none">🇮🇳</span> +91
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    placeholder="98765 43210"
                    value={(form.phone || '').replace(/^\+91\s?|^91\s?/, '').replace(/\D/g, '').slice(0, 10)}
                    maxLength={10}
                    onChange={e => {
                      const clean = e.target.value.replace(/\D/g, '').slice(0, 10);
                      setForm({ ...form, phone: clean ? `+91 ${clean}` : '' });
                    }}
                    aria-invalid={contactErrors.phone ? true : undefined}
                    className="w-full px-3 py-2.5 text-sm font-normal text-slate-900 focus:outline-none"
                  />
                </div>
                {fieldError(contactErrors, 'phone')}
              </label>

              <label className="text-sm font-bold text-slate-600">Agency / Partner Brand Name<input maxLength={120} value={business.agency_name} onChange={e => setBusiness({ ...business, agency_name: e.target.value })} aria-invalid={contactErrors.agencyName ? true : undefined} className={`${inputClass} ${contactErrors.agencyName ? errInput : ''}`} />{fieldError(contactErrors, 'agencyName')}</label>

              <label className="text-sm font-bold text-slate-600">
                WhatsApp Business Helpline
                <div className="flex mt-1 w-full rounded-xl border border-slate-200 overflow-hidden bg-white focus-within:ring-2 focus-within:ring-slate-900">
                  <span className="inline-flex items-center gap-1 px-3 bg-slate-100 border-r border-slate-200 text-xs font-bold text-slate-700 select-none">
                    <span className="text-base leading-none">🇮🇳</span> +91
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    placeholder="98765 43210"
                    value={(business.whatsapp_phone || '').replace(/^\+91\s?|^91\s?/, '').replace(/\D/g, '').slice(0, 10)}
                    maxLength={10}
                    onChange={e => {
                      const clean = e.target.value.replace(/\D/g, '').slice(0, 10);
                      setBusiness({ ...business, whatsapp_phone: clean ? `+91 ${clean}` : '' });
                    }}
                    aria-invalid={contactErrors.whatsappPhone ? true : undefined}
                    className="w-full px-3 py-2.5 text-sm font-normal text-slate-900 focus:outline-none"
                  />
                </div>
                {fieldError(contactErrors, 'whatsappPhone')}
              </label>

              <label className="text-sm font-bold text-slate-600">City Base<input maxLength={80} value={business.city} onChange={e => setBusiness({ ...business, city: e.target.value })} aria-invalid={contactErrors.city ? true : undefined} className={`${inputClass} ${contactErrors.city ? errInput : ''}`} />{fieldError(contactErrors, 'city')}</label>
              <label className="text-sm font-bold text-slate-600">State<input maxLength={80} value={business.state} onChange={e => setBusiness({ ...business, state: e.target.value })} aria-invalid={contactErrors.state ? true : undefined} className={`${inputClass} ${contactErrors.state ? errInput : ''}`} />{fieldError(contactErrors, 'state')}</label>
              <label className="text-sm font-bold text-slate-600 sm:col-span-2">Full Address / Location<input maxLength={240} value={business.full_address} onChange={e => setBusiness({ ...business, full_address: e.target.value })} aria-invalid={contactErrors.fullAddress ? true : undefined} className={`${inputClass} ${contactErrors.fullAddress ? errInput : ''}`} />{fieldError(contactErrors, 'fullAddress')}</label>
              
              <label className="text-sm font-bold text-slate-600">
                Emergency / Alternate Phone
                <div className="flex mt-1 w-full rounded-xl border border-slate-200 overflow-hidden bg-white focus-within:ring-2 focus-within:ring-slate-900">
                  <span className="inline-flex items-center gap-1 px-3 bg-slate-100 border-r border-slate-200 text-xs font-bold text-slate-700 select-none">
                    <span className="text-base leading-none">🇮🇳</span> +91
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    placeholder="98765 43210"
                    value={(business.alternate_phone || '').replace(/^\+91\s?|^91\s?/, '').replace(/\D/g, '').slice(0, 10)}
                    maxLength={10}
                    onChange={e => {
                      const clean = e.target.value.replace(/\D/g, '').slice(0, 10);
                      setBusiness({ ...business, alternate_phone: clean ? `+91 ${clean}` : '' });
                    }}
                    aria-invalid={contactErrors.alternatePhone ? true : undefined}
                    className="w-full px-3 py-2.5 text-sm font-normal text-slate-900 focus:outline-none"
                  />
                </div>
                {fieldError(contactErrors, 'alternatePhone')}
              </label>
              <label className="text-sm font-bold text-slate-600">Website Link<input type="url" maxLength={200} value={business.website_url || ''} onChange={e => setBusiness({ ...business, website_url: e.target.value })} aria-invalid={contactErrors.websiteUrl ? true : undefined} className={`${inputClass} ${contactErrors.websiteUrl ? errInput : ''}`} />{fieldError(contactErrors, 'websiteUrl')}</label>
              <label className="text-sm font-bold text-slate-600">Instagram URL<input type="url" maxLength={300} placeholder="https://instagram.com/yourhandle" value={social.instagram} onChange={e => setSocial('instagram', e.target.value)} aria-invalid={contactErrors['socialLinks.instagram'] ? true : undefined} data-social-field="instagram" className={`${inputClass} ${contactErrors['socialLinks.instagram'] ? errInput : ''}`} />{fieldError(contactErrors, 'socialLinks.instagram')}</label>
              <label className="text-sm font-bold text-slate-600">LinkedIn URL<input type="url" maxLength={300} placeholder="https://www.linkedin.com/in/yourhandle" value={social.linkedin} onChange={e => setSocial('linkedin', e.target.value)} aria-invalid={contactErrors['socialLinks.linkedin'] ? true : undefined} data-social-field="linkedin" className={`${inputClass} ${contactErrors['socialLinks.linkedin'] ? errInput : ''}`} />{fieldError(contactErrors, 'socialLinks.linkedin')}</label>
              <label className="text-sm font-bold text-slate-600">Facebook URL<input type="url" maxLength={300} placeholder="https://www.facebook.com/yourpage" value={social.facebook} onChange={e => setSocial('facebook', e.target.value)} aria-invalid={contactErrors['socialLinks.facebook'] ? true : undefined} data-social-field="facebook" className={`${inputClass} ${contactErrors['socialLinks.facebook'] ? errInput : ''}`} />{fieldError(contactErrors, 'socialLinks.facebook')}</label>
              <label className="text-sm font-bold text-slate-600">X / Twitter URL<input type="url" maxLength={300} placeholder="https://x.com/yourhandle" value={social.twitter} onChange={e => setSocial('twitter', e.target.value)} aria-invalid={contactErrors['socialLinks.twitter'] ? true : undefined} data-social-field="twitter" className={`${inputClass} ${contactErrors['socialLinks.twitter'] ? errInput : ''}`} />{fieldError(contactErrors, 'socialLinks.twitter')}</label>
            <div className="sm:col-span-2 rounded-2xl border border-pink-100 bg-pink-50 p-4"><p className="text-sm font-bold text-slate-900">Social Media Share / Connections</p><p className="mt-1 text-xs text-slate-600">Save your handles, then share your Nexora partner profile.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => { const link = `${window.location.origin}/partner/profile`; void navigator.clipboard?.writeText(link); showPartnerToast.success('Profile link copied.'); }} className="rounded-xl bg-pink-600 px-4 py-2 text-xs font-bold text-white">Copy Profile Link</button><a target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`View my Nexora partner profile: ${window.location.origin}/partner/profile`)}`} className="rounded-xl bg-green-600 px-4 py-2 text-xs font-bold text-white">WhatsApp</a><a target="_blank" rel="noopener noreferrer" href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`${window.location.origin}/partner/profile`)}`} className="rounded-xl bg-blue-700 px-4 py-2 text-xs font-bold text-white">LinkedIn</a><a target="_blank" rel="noopener noreferrer" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(`${window.location.origin}/partner/profile`)}`} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white">Facebook</a><a target="_blank" rel="noopener noreferrer" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent('View my Nexora partner profile')}&url=${encodeURIComponent(`${window.location.origin}/partner/profile`)}`} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white">X / Twitter</a><a target="_blank" rel="noopener noreferrer" href="https://www.instagram.com/" className="rounded-xl bg-gradient-to-r from-fuchsia-600 to-orange-500 px-4 py-2 text-xs font-bold text-white">Instagram</a></div></div>
            </div>
            <label className="block text-sm font-bold text-slate-600">Public Partner Bio &amp; Expertise<textarea maxLength={500} rows={4} value={business.public_bio} onChange={e => setBusiness({ ...business, public_bio: e.target.value })} aria-invalid={contactErrors.publicBio ? true : undefined} className={`${inputClass} ${contactErrors.publicBio ? errInput : ''}`} />{fieldError(contactErrors, 'publicBio')}</label>
            <button type="submit" disabled={busy} data-profile-save className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save Profile & Account Settings'}</button>
          </fieldset>
        </form>
      </section> : null}

      <section aria-label="Partner account details" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center justify-between"><h2 className="font-bold text-slate-900">Account details</h2><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">KYB/KYC: {business.kyb_status || 'Pending'}</span></div>
        <dl className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
          {([
            ['Partner Name', profile.full_name || 'Not provided'], ['Email', profile.email || 'Not provided'], ['Phone', profile.phone || 'Not provided'], ['Business / Salon Name', business.agency_name || 'Not provided'], ['Full Address', business.full_address || 'Not provided'], ['Alternate Phone', business.alternate_phone || 'Not provided'], ['Website', business.website_url || 'Not provided'], ['Social Handles', socialSummary || 'Not provided'],
            ['Partner ID', profile.partner_id], ['Referral Code', profile.referral_code], ['Account status', profile.account_status],
            ['Joined date', new Date(profile.joined_at).toLocaleDateString()], ['Partner Role', profile.partner_role], ['Approval Status', profile.approval_status],
          ] as Array<[string, string]>).map(([label, value]) => <div key={label} data-summary-field={label}><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 break-all text-sm text-slate-900">{value}</dd></div>)}
        </dl>
        <p className="mt-5 text-xs text-slate-500">Partner ID, Partner Role, Referral Code and Approval Status cannot be changed here. Email, password, 2FA and sessions are managed in <button type="button" onClick={() => navigate?.('/partner/account-settings')} className="font-bold text-pink-700 underline" data-summary-account-settings-link>Account Settings</button>.</p>
      </section>
    </div>
  );
}
