import { safePartnerErrorMessage } from '../lib/partnerUiErrors';
import { PartnerToast } from './PartnerToast';
import { PartnerLoading } from './PartnerLoading';
import React, { useEffect, useRef, useState } from 'react';
import { compressPartnerAvatar } from '../lib/partnerProfile';
import { fetchGrowthPartnerProfile, fetchPartnerAccountSettings, growthPartnerPhotoUrl, requestGrowthPartnerEmailChange, saveGrowthPartnerProfile, savePartnerAccountSettings, type GrowthPartnerProfileClient, type GrowthPartnerProfileData, type PartnerAccountSettings } from '../lib/growthPartnerProfile';

export function GrowthPartnerProfilePage({ client, onProfileChange }: {
  client?: GrowthPartnerProfileClient;
  onProfileChange?: (profile: GrowthPartnerProfileData) => void;
}) {
  const [profile, setProfile] = useState<GrowthPartnerProfileData | null>(null);
  const [form, setForm] = useState({ fullName: '', phone: '' });
  const [business, setBusiness] = useState<PartnerAccountSettings>({ agency_name: '', whatsapp_phone: '', city: '', state: '', public_bio: '', full_address: '', alternate_phone: '', website_url: '', social_handles: '', payout_method: null, payout_account_name: '', payout_account_number: '', payout_ifsc: '', payout_upi_id: '' });
  const [activeTab, setActiveTab] = useState<'contact' | 'payout' | 'notifications' | 'security'>('contact');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const profileCallback = useRef(onProfileChange); profileCallback.current = onProfileChange;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError('');
    fetchGrowthPartnerProfile(client).then(data => {
      if (cancelled) return;
      setProfile(data); setForm({ fullName: data.full_name, phone: data.phone || '' }); setLoading(false); profileCallback.current?.(data);
      fetchPartnerAccountSettings(client).then(setBusiness).catch(() => setBusiness(prev => ({ ...prev, agency_name: 'Growth Partner Desk', whatsapp_phone: data.phone || '' })));
    }, error => { if (!cancelled) { setError(safePartnerErrorMessage(error, 'Could not load your partner profile. Please retry.')); setLoading(false); } });
    return () => { cancelled = true; };
  }, [client, retry]);
  useEffect(() => {
    if (!photo) { setPreview(''); return; }
    const url = URL.createObjectURL(photo); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  if (loading) return <PartnerLoading label="Loading your profile…" kind="profile" />;
  if (!profile) return <div role="alert" className="rounded-3xl bg-white p-8"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-white">Retry profile</button></div>;
  const avatar = preview || (!removePhoto && growthPartnerPhotoUrl(profile.photo_path, client)) || '';
  const inputClass = 'mt-1 min-w-0 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-2 focus:outline-slate-900';
  const saveBusinessDraft = async () => { setBusy(true); setError(''); try { setBusiness(await savePartnerAccountSettings(business, client)); setMessage('Account settings saved.'); } catch (cause) { setError(safePartnerErrorMessage(cause, 'Could not save account settings.')); } finally { setBusy(false); } };
  return (
    <div className="min-w-0 space-y-5">
      <PartnerToast message={emailMessage || message} />
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3"><div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-pink-100 text-xl font-black text-pink-700">{avatar ? <img src={avatar} alt="Profile" className="h-full w-full object-cover" /> : (form.fullName.slice(0, 2) || 'GP').toUpperCase()}</div><div><h1 className="text-xl font-black text-slate-900">{form.fullName || 'Growth Partner'}</h1><p className="text-xs text-slate-500">{business.agency_name || 'Growth Partner Desk'} · {business.city || 'Partner Network'}</p></div></div>
          <div className="flex gap-2 text-xs"><span className="rounded-xl bg-slate-100 px-3 py-2 font-bold">Status: {profile.account_status}</span><span className="rounded-xl bg-pink-50 px-3 py-2 font-bold text-pink-700">{profile.partner_role}</span></div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 border-b border-slate-100 pb-3">
          {([['contact', 'Contact & Personal Info'], ['payout', 'Payout & Bank Accounts'], ['notifications', 'Notification & Preferences'], ['security', 'Security & 2FA']] as const).map(([id, label]) => <button key={id} type="button" onClick={() => setActiveTab(id)} className={`rounded-full px-4 py-2 text-xs font-bold transition ${activeTab === id ? 'bg-pink-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{label}</button>)}
        </div>
      </section>
      {activeTab === 'payout' ? <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><h2 className="text-lg font-bold text-slate-900">Payout & Bank Accounts</h2><p className="mt-2 text-sm text-slate-500">These details are used only for manual payout review.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-slate-600">Payout method<select value={business.payout_method || ''} onChange={e => setBusiness({ ...business, payout_method: (e.target.value || null) as PartnerAccountSettings['payout_method'] })} className={inputClass}><option value="">Select method</option><option value="upi">UPI</option><option value="bank_transfer">Bank Transfer</option><option value="paypal">PayPal</option></select></label><label className="text-sm font-bold text-slate-600">Account holder name<input value={business.payout_account_name || ''} onChange={e => setBusiness({ ...business, payout_account_name: e.target.value })} className={inputClass} /></label><label className="text-sm font-bold text-slate-600">Account number<input value={business.payout_account_number || ''} onChange={e => setBusiness({ ...business, payout_account_number: e.target.value })} className={inputClass} /></label><label className="text-sm font-bold text-slate-600">IFSC code<input value={business.payout_ifsc || ''} onChange={e => setBusiness({ ...business, payout_ifsc: e.target.value.toUpperCase() })} className={inputClass} /></label><label className="text-sm font-bold text-slate-600 sm:col-span-2">UPI ID<input value={business.payout_upi_id || ''} onChange={e => setBusiness({ ...business, payout_upi_id: e.target.value })} className={inputClass} /></label></div><button type="button" onClick={saveBusinessDraft} className="mt-5 rounded-xl bg-pink-600 px-5 py-2.5 text-sm font-bold text-white">Save payout details</button></section> : null}
      {activeTab === 'notifications' || activeTab === 'security' ? <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><h2 className="text-lg font-bold text-slate-900">{activeTab === 'notifications' ? 'Notification & Preferences' : 'Security & 2FA'}</h2><p className="mt-2 text-sm text-slate-500">{activeTab === 'notifications' ? 'Manage email and in-app alerts from the Notifications section in your partner portal.' : 'Your sign-in and email changes are protected by Supabase Auth. Enable 2FA when your organization policy requires it.'}</p></section> : null}
      {activeTab === 'contact' ? <section aria-label="Partner profile" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-xl font-bold text-slate-900">Personal & Contact Details</h2>
        <p className="mt-1 text-sm text-slate-500">Update your basic details. Your partner identity and approval are managed by the platform.</p>
        <form className="mt-6 space-y-4" onSubmit={async event => {
          event.preventDefault(); if (busy) return; setBusy(true); setError(''); setMessage('');
          try {
            const saved = await saveGrowthPartnerProfile({ ...form, expectedUserId: profile.partner_id, photo, removePhoto }, client);
            if (!mounted.current) return;
            setProfile(saved); setForm({ fullName: saved.full_name, phone: saved.phone || '' }); setPhoto(null); setRemovePhoto(false);
            setMessage('Profile saved.'); profileCallback.current?.(saved);
          } catch (cause) { if (mounted.current) setError(safePartnerErrorMessage(cause, 'Could not save your profile. Please retry.')); }
          finally { if (mounted.current) setBusy(false); }
        }}>
          <fieldset disabled={busy || emailBusy} className="min-w-0 space-y-5 disabled:opacity-60">
            <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-slate-50 p-4">
              {avatar ? <img src={avatar} alt="Your profile photo" className="h-20 w-20 rounded-full object-cover" /> : <div aria-label="No profile photo" className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-200 text-2xl font-bold text-slate-600">{(form.fullName.trim().slice(0, 2) || 'GP').toUpperCase()}</div>}
              <label className="min-w-0 basis-full text-sm font-bold text-slate-700 sm:flex-1">Profile Photo
                <input type="file" accept="image/jpeg,image/png,image/webp" className="mt-2 block w-full text-xs" onChange={async event => {
                  const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
                  setBusy(true); setError(''); setMessage('');
                  try { const compressed = await compressPartnerAvatar(file); if (mounted.current) { setPhoto(compressed); setRemovePhoto(false); } }
                  catch (cause) { if (mounted.current) setError(safePartnerErrorMessage(cause, 'Choose a valid image.')); }
                  finally { if (mounted.current) setBusy(false); }
                }} />
                <span className="mt-2 block text-xs font-normal text-slate-500">JPG, PNG or WebP · Up to 5 MB · Compressed to 500px. Profile photos are public.</span>
              </label>
              {avatar && <button type="button" onClick={() => { setPhoto(null); setPreview(''); setRemovePhoto(true); setMessage(''); }} className="text-xs font-bold text-slate-600 underline">Remove photo</button>}
            </div>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <label className="text-sm font-bold text-slate-600">Full Name<input required maxLength={120} autoComplete="name" value={form.fullName} onChange={e => { setForm({ ...form, fullName: e.target.value }); setMessage(''); }} className={inputClass} /></label>
              <label className="text-sm font-bold text-slate-600">Phone<input type="tel" maxLength={30} autoComplete="tel" placeholder="Phone number with country code" value={form.phone} onChange={e => { setForm({ ...form, phone: e.target.value }); setMessage(''); }} className={inputClass} /></label>
            </div>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <label className="text-sm font-bold text-slate-600">Agency / Partner Brand Name<input maxLength={120} value={business.agency_name} onChange={e => setBusiness({ ...business, agency_name: e.target.value })} className={inputClass} /></label>
              <label className="text-sm font-bold text-slate-600">WhatsApp Business Helpline<input type="tel" maxLength={30} value={business.whatsapp_phone || ''} onChange={e => setBusiness({ ...business, whatsapp_phone: e.target.value })} className={inputClass} /></label>
              <label className="text-sm font-bold text-slate-600">City Base<input maxLength={80} value={business.city} onChange={e => setBusiness({ ...business, city: e.target.value })} className={inputClass} /></label>
              <label className="text-sm font-bold text-slate-600">State<input maxLength={80} value={business.state} onChange={e => setBusiness({ ...business, state: e.target.value })} className={inputClass} /></label>
              <label className="text-sm font-bold text-slate-600 sm:col-span-2">Full Address / Location<input maxLength={240} value={business.full_address} onChange={e => setBusiness({ ...business, full_address: e.target.value })} className={inputClass} /></label>
              <label className="text-sm font-bold text-slate-600">Emergency / Alternate Phone<input type="tel" maxLength={30} value={business.alternate_phone || ''} onChange={e => setBusiness({ ...business, alternate_phone: e.target.value })} className={inputClass} /></label>
              <label className="text-sm font-bold text-slate-600">Website Link<input type="url" maxLength={200} value={business.website_url || ''} onChange={e => setBusiness({ ...business, website_url: e.target.value })} className={inputClass} /></label>
            <label className="text-sm font-bold text-slate-600 sm:col-span-2">Social Media Handles<input maxLength={240} placeholder="Instagram, LinkedIn, Facebook" value={business.social_handles} onChange={e => setBusiness({ ...business, social_handles: e.target.value })} className={inputClass} /></label>
            <div className="sm:col-span-2 rounded-2xl border border-pink-100 bg-pink-50 p-4"><p className="text-sm font-bold text-slate-900">Social Media Share / Connections</p><p className="mt-1 text-xs text-slate-600">Save your handles, then share your Nexora partner profile.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => { const link = `${window.location.origin}/partner/profile`; void navigator.clipboard?.writeText(link); setMessage('Profile link copied.'); }} className="rounded-xl bg-pink-600 px-4 py-2 text-xs font-bold text-white">Copy Profile Link</button><a target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`View my Nexora partner profile: ${window.location.origin}/partner/profile`)}`} className="rounded-xl bg-green-600 px-4 py-2 text-xs font-bold text-white">WhatsApp</a><a target="_blank" rel="noopener noreferrer" href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`${window.location.origin}/partner/profile`)}`} className="rounded-xl bg-blue-700 px-4 py-2 text-xs font-bold text-white">LinkedIn</a><a target="_blank" rel="noopener noreferrer" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(`${window.location.origin}/partner/profile`)}`} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white">Facebook</a><a target="_blank" rel="noopener noreferrer" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent('View my Nexora partner profile')}&url=${encodeURIComponent(`${window.location.origin}/partner/profile`)}`} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white">X / Twitter</a><a target="_blank" rel="noopener noreferrer" href="https://www.instagram.com/" className="rounded-xl bg-gradient-to-r from-fuchsia-600 to-orange-500 px-4 py-2 text-xs font-bold text-white">Instagram</a></div></div>
            </div>
            <label className="text-sm font-bold text-slate-600">Public Partner Bio & Expertise<textarea maxLength={500} rows={4} value={business.public_bio} onChange={e => setBusiness({ ...business, public_bio: e.target.value })} className={inputClass} /></label>
            <button type="submit" className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white">{busy ? 'Saving…' : 'Save Profile & Account Settings'}</button>
          </fieldset>
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
          <p className="text-sm text-emerald-700">{message}</p>
        </form>
      </section> : null}
      <section aria-label="Partner account details" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center justify-between"><h2 className="font-bold text-slate-900">Account details</h2><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">KYB/KYC: {business.kyb_status || 'Pending'}</span></div>
        <dl className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
          {[
            ['Partner Name', profile.full_name || 'Not provided'], ['Email', profile.email || 'Not provided'], ['Phone', profile.phone || 'Not provided'], ['Business / Salon Name', business.agency_name || 'Not provided'], ['Full Address', business.full_address || 'Not provided'], ['Alternate Phone', business.alternate_phone || 'Not provided'], ['Website', business.website_url || 'Not provided'], ['Social Handles', business.social_handles || 'Not provided'],
            ['Partner ID', profile.partner_id], ['Referral Code', profile.referral_code], ['Account status', profile.account_status],
            ['Joined date', new Date(profile.joined_at).toLocaleDateString()], ['Partner Role', profile.partner_role], ['Approval Status', profile.approval_status],
          ].map(([label,value]) => <div key={label}><dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 break-all text-sm text-slate-900">{value}</dd></div>)}
        </dl>
        <p className="mt-5 text-xs text-slate-500">Partner ID, Partner Role, Referral Code and Approval Status cannot be changed here.</p>
      </section>
      <section aria-label="Secure email change" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="font-bold text-slate-900">Change sign-in email</h2>
        <p className="mt-2 text-sm text-slate-500">Email changes go through secure account verification, not the profile form. Follow the confirmation instructions sent by the authentication service.</p>
        <form className="mt-4 space-y-3" onSubmit={async event => {
          event.preventDefault(); if (emailBusy) return; setEmailBusy(true); setEmailError(''); setEmailMessage('');
          try {
            await requestGrowthPartnerEmailChange(newEmail, profile.partner_id, client);
            if (mounted.current) setEmailMessage('Email change requested. Check your current and new inboxes for any required confirmation links. Your displayed email will refresh after confirmation.');
          } catch (cause) { if (mounted.current) setEmailError(safePartnerErrorMessage(cause, 'Could not request an email change. Please retry.')); }
          finally { if (mounted.current) setEmailBusy(false); }
        }}>
          <fieldset disabled={busy || emailBusy} className="space-y-3 disabled:opacity-60">
            <label className="block text-sm font-bold text-slate-600">New email<input required type="email" maxLength={254} autoComplete="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className={inputClass} /></label>
            <button type="submit" className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-800">{emailBusy ? 'Requesting…' : 'Request Email Change'}</button>
          </fieldset>
          {emailError && <p role="alert" className="text-sm text-rose-700">{emailError}</p>}
          <p className="text-sm text-slate-600">{emailMessage}</p>
        </form>
      </section>
    </div>
  );
}
