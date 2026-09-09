import React, { useEffect, useRef, useState } from 'react';
import type { SalonProfile } from '../types';
import { supabase, isMockSupabase } from '../lib/supabaseClient';
import { compressPartnerAvatar, normalizeWhatsApp } from '../lib/partnerProfile';
import { queueOwnerWrite } from '../lib/ownerEditorState';

export function PartnerProfileModal({ profile, onSaved, onClose }: {
  profile: SalonProfile; onSaved: (patch: Partial<SalonProfile>) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const dirty = useRef(false);
  const [form, setForm] = useState({ ownerName: profile.ownerName, whatsapp: profile.whatsapp || '', postalCode: profile.postalCode || '', city: profile.city || '', areaLocality: profile.areaLocality || '', phone: profile.phone || '', email: profile.email || '', address: profile.address || '', state: profile.state || '', landmark: profile.landmark || '', dob: '', notifications: false });
  const [avatar, setAvatar] = useState(profile.ownerPhotoUrl || '');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (dirty.current) return;
    setForm(f => ({ ...f, ownerName: profile.ownerName, whatsapp: profile.whatsapp || '', postalCode: profile.postalCode || '', city: profile.city || '', areaLocality: profile.areaLocality ?? f.areaLocality, phone: profile.phone || '', email: profile.email || '', address: profile.address || '', state: profile.state || '', landmark: profile.landmark || '' }));
    setAvatar(profile.ownerPhotoUrl || '');
  }, [profile]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    (async () => {
      if (isMockSupabase) throw new Error('Connect Supabase and sign in to save your profile.');
      const { data, error } = await supabase.rpc('get_partner_profile');
      if (error) throw error;
      // Shared fields come from the live editor, including unsaved Contact &
      // Location changes. Fetch only private fields, never overwrite those edits.
      if (active) {
        setForm(f => ({ ...f, dob: data?.dob || '', areaLocality: profile.areaLocality ?? data?.area ?? '', notifications: data?.notifications === true }));
        setLoading(false);
      }
    })().catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [loadAttempt]);
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setAvatar(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    let uploaded: string | null = null;
    try {
      const whatsapp = normalizeWhatsApp(form.whatsapp);
      if (!/^[1-9]\d{5}$/.test(form.postalCode)) throw new Error('Enter a valid 6-digit Indian PIN code.');
      if (!form.ownerName.trim() || !form.city.trim() || !form.areaLocality.trim()) throw new Error('Complete all required fields.');
      if (!form.dob || form.dob > new Date().toISOString().slice(0, 10)) throw new Error('Enter a valid date of birth.');
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) throw new Error('Please sign in again.');
      let photo = avatar;
      let image = blob;
      if (!image && avatar.startsWith('data:image/')) image = await (await fetch(avatar)).blob();
      if (image) {
        const extension = image.type === 'image/png' ? 'png' : image.type === 'image/jpeg' ? 'jpg' : 'webp';
        uploaded = `${user.id}/${crypto.randomUUID()}.${extension}`;
        const result = await supabase.storage.from('partner-avatars').upload(uploaded, image, { contentType: image.type, upsert: false });
        if (result.error) { uploaded = null; throw result.error; }
        photo = supabase.storage.from('partner-avatars').getPublicUrl(uploaded).data.publicUrl;
      }
      if (!photo) throw new Error('Please upload an avatar image.');
      const { dob, notifications, ...shared } = form;
      const patch = { ...shared, ownerName: form.ownerName.trim(), whatsapp, city: form.city.trim(), areaLocality: form.areaLocality.trim(), ownerPhotoUrl: photo };
      await queueOwnerWrite(async () => {
        const result = await supabase.rpc('save_partner_profile_details', { p_details: { ...patch, subdomain: profile.subdomain, dob, notifications } });
        if (result.error) throw result.error;
      });
      uploaded = null;
      onSaved(patch);
      onClose();
    } catch (e: any) {
      if (uploaded) { try { await supabase.storage.from('partner-avatars').remove([uploaded]); } catch { /* preserve original save error */ } }
      setError(e.message || 'Profile could not be saved. Please retry.');
    } finally { setBusy(false); }
  }
  return <dialog ref={dialog} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }} aria-labelledby="partner-title" className="m-auto w-[min(94vw,560px)] max-h-[90dvh] rounded-3xl p-0 backdrop:bg-black/50">
    <div className="flex flex-col max-h-[90dvh]">
      <div className="flex shrink-0 justify-between items-center bg-pink-50 p-5"><div><h2 id="partner-title" className="font-bold">User Profile Settings</h2><p className="text-xs text-slate-500">Synced with Contact & Location</p></div><button type="button" disabled={busy} onClick={onClose} aria-label="Close profile settings">✕</button></div>
      <form id="partner-profile-form" onSubmit={save} className="p-5 space-y-5 overflow-y-auto min-h-0">
        {error && <p role="alert" className="text-sm text-red-700">{error} {loading && <button type="button" className="underline" onClick={() => setLoadAttempt(v => v + 1)}>Retry loading</button>}</p>}
        {loading && !error && <p role="status" className="text-sm">Loading saved profile…</p>}
        <fieldset disabled={loading || busy} className="space-y-5 disabled:opacity-60">
          <div className="flex items-center gap-4 rounded-2xl bg-slate-50 p-4">
            {avatar && <img src={avatar} alt="Partner avatar" className="w-20 h-20 rounded-full object-cover" />}
            <label className="text-sm font-semibold">Partner Avatar Image *<input type="file" accept="image/jpeg,image/png,image/webp" className="block mt-2 w-full text-xs" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; dirty.current = true; setBusy(true); setError(''); try { setBlob(await compressPartnerAvatar(file)); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }} /><span className="block text-xs font-normal text-slate-500 mt-2">Max 5 MB. Automatically compressed to 500px.</span></label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {([['ownerName', 'Full Name', 'text', true], ['whatsapp', 'WhatsApp Number', 'tel', true], ['dob', 'Date of Birth (DOB)', 'date', true], ['postalCode', 'PIN Code / Postal Code', 'text', true], ['city', 'City', 'text', true], ['areaLocality', 'Area / Locality', 'text', true], ['phone', 'Phone Number', 'tel', false], ['email', 'Contact Email', 'email', false], ['address', 'Physical Address', 'text', false], ['state', 'State', 'text', false], ['landmark', 'Landmark', 'text', false]] as const).map(([key, label, type, required]) => <label key={key} className="text-xs font-semibold text-slate-700">{label}{required ? ' *' : ''}<input required={required} type={type} value={form[key]} maxLength={key === 'postalCode' ? 6 : key === 'address' ? 1000 : 160} max={key === 'dob' ? new Date().toISOString().slice(0, 10) : undefined} inputMode={key === 'postalCode' ? 'numeric' : undefined} onChange={e => { dirty.current = true; setForm(f => ({ ...f, [key]: e.target.value })); }} className="block mt-2 w-full rounded-xl border border-slate-200 p-3 font-normal" /></label>)}
          </div>
          <label className="flex gap-3 items-center rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm"><input type="checkbox" checked={form.notifications} onChange={e => { dirty.current = true; setForm(f => ({ ...f, notifications: e.target.checked })); }} /><span>WhatsApp Booking Confirmations<span className="block text-xs text-slate-500">Save your booking alert preference.</span></span></label>
        </fieldset>
      </form>
      <div className="shrink-0 border-t bg-white p-4"><button form="partner-profile-form" disabled={loading || busy} className="w-full rounded-xl bg-[#C20E5A] p-3 font-bold text-white disabled:opacity-50" type="submit">{busy ? 'Saving…' : 'Save Profile'}</button></div>
    </div>
  </dialog>;
}
