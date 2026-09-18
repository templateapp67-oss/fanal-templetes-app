import { safePartnerErrorMessage } from '../lib/partnerUiErrors';
import { PartnerToast } from './PartnerToast';
import { PartnerLoading } from './PartnerLoading';
import React, { useEffect, useRef, useState } from 'react';
import { compressPartnerAvatar } from '../lib/partnerProfile';
import { fetchGrowthPartnerProfile, growthPartnerPhotoUrl, requestGrowthPartnerEmailChange, saveGrowthPartnerProfile, type GrowthPartnerProfileClient, type GrowthPartnerProfileData } from '../lib/growthPartnerProfile';

export function GrowthPartnerProfilePage({ client, onProfileChange }: {
  client?: GrowthPartnerProfileClient;
  onProfileChange?: (profile: GrowthPartnerProfileData) => void;
}) {
  const [profile, setProfile] = useState<GrowthPartnerProfileData | null>(null);
  const [form, setForm] = useState({ fullName: '', phone: '' });
  const [business, setBusiness] = useState({ agency: '', whatsapp: '', city: '', state: '', bio: '' });
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
      try {
        const saved = JSON.parse(localStorage.getItem(`nexora-partner-business-${data.partner_id}`) || '{}');
        setBusiness({ agency: saved.agency || 'Growth Partner Desk', whatsapp: saved.whatsapp || data.phone || '', city: saved.city || '', state: saved.state || '', bio: saved.bio || '' });
      } catch { /* ignore unavailable local storage */ }
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
  const saveBusinessDraft = () => {
    try { localStorage.setItem(`nexora-partner-business-${profile.partner_id}`, JSON.stringify(business)); setMessage('Account settings saved.'); } catch { setError('Could not save account settings on this device.'); }
  };
  return (
    <div className="min-w-0 space-y-5">
      <PartnerToast message={emailMessage || message} />
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-pink-100 text-xl font-black text-pink-700">{(form.fullName.slice(0, 2) || 'GP').toUpperCase()}</div><div><h1 className="text-xl font-black text-slate-900">{form.fullName || 'Growth Partner'}</h1><p className="text-xs text-slate-500">Growth Partner Desk · {business.city || 'Partner Network'}</p></div></div>
          <div className="flex gap-2 text-xs"><span className="rounded-xl bg-slate-100 px-3 py-2 font-bold">Status: {profile.account_status}</span><span className="rounded-xl bg-pink-50 px-3 py-2 font-bold text-pink-700">{profile.partner_role}</span></div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 border-b border-slate-100 pb-3">
          {([['contact', 'Contact & Personal Info'], ['payout', 'Payout & Bank Accounts'], ['notifications', 'Notification & Preferences'], ['security', 'Security & 2FA']] as const).map(([id, label]) => <button key={id} type="button" onClick={() => setActiveTab(id)} className={`rounded-full px-4 py-2 text-xs font-bold transition ${activeTab === id ? 'bg-pink-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{label}</button>)}
        </div>
      </section>
      {activeTab !== 'contact' ? <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><h2 className="text-lg font-bold text-slate-900">{activeTab === 'payout' ? 'Payout & Bank Accounts' : activeTab === 'notifications' ? 'Notification & Preferences' : 'Security & 2FA'}</h2><p className="mt-2 text-sm text-slate-500">This secure workspace is ready for your account controls. Payout requests, notification preferences and authentication actions remain protected by the live partner session.</p><div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">No changes are pending in this section.</div></section> : null}
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
              <label className="text-sm font-bold text-slate-600">Agency / Partner Brand Name<input maxLength={120} value={business.agency} onChange={e => setBusiness({ ...business, agency: e.target.value })} className={inputClass} /></label>
              <label className="text-sm font-bold text-slate-600">WhatsApp Business Helpline<input type="tel" maxLength={30} value={business.whatsapp} onChange={e => setBusiness({ ...business, whatsapp: e.target.value })} className={inputClass} /></label>
              <label className="text-sm font-bold text-slate-600">City Base<input maxLength={80} value={business.city} onChange={e => setBusiness({ ...business, city: e.target.value })} className={inputClass} /></label>
              <label className="text-sm font-bold text-slate-600">State<input maxLength={80} value={business.state} onChange={e => setBusiness({ ...business, state: e.target.value })} className={inputClass} /></label>
            </div>
            <label className="text-sm font-bold text-slate-600">Public Partner Bio & Expertise<textarea maxLength={500} rows={4} value={business.bio} onChange={e => setBusiness({ ...business, bio: e.target.value })} className={inputClass} /></label>
            <button type="submit" className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white">{busy ? 'Saving…' : 'Save Profile'}</button>
            <button type="button" onClick={saveBusinessDraft} className="ml-2 rounded-xl bg-pink-600 px-5 py-2.5 text-sm font-bold text-white">Save Account Settings</button>
          </fieldset>
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
          <p className="text-sm text-emerald-700">{message}</p>
        </form>
      </section> : null}
      <section aria-label="Partner account details" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="font-bold text-slate-900">Account details</h2>
        <dl className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
          {[
            ['Partner Name', profile.full_name || 'Not provided'], ['Email', profile.email || 'Not provided'], ['Phone', profile.phone || 'Not provided'],
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
