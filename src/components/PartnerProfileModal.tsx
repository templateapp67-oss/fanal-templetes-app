import React, { useEffect, useRef, useState } from 'react';
import type { SalonProfile } from '../types';
import { supabase, isMockSupabase } from '../lib/supabaseClient';
import { compressPartnerAvatar, normalizeWhatsApp } from '../lib/partnerProfile';

export function PartnerProfileModal({ profile, onSaved, onClose }: {
  profile: SalonProfile; onSaved: (patch: Partial<SalonProfile>) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState({ name: profile.ownerName, whatsapp: profile.whatsapp || '', postal: profile.postalCode || '', city: profile.city || '', area: '', dob: '', notifications: false });
  const [avatar, setAvatar] = useState(profile.ownerPhotoUrl || '');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    (async () => {
      if (isMockSupabase) throw new Error('Connect Supabase and sign in to save your profile.');
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('Please sign in again.');
      const { data, error } = await supabase.rpc('get_partner_profile');
      if (error) throw error;
      if (active && data) {
        setForm(f => ({ name: data.name ?? f.name, whatsapp: data.whatsapp ?? f.whatsapp, postal: data.postal ?? f.postal, city: data.city ?? f.city, dob: data.dob || '', area: data.area || '', notifications: data.notifications === true }));
        if (data.avatar) setAvatar(data.avatar);
      }
      if (active) setLoading(false);
    })().catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
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
      if (!/^[1-9]\d{5}$/.test(form.postal)) throw new Error('Enter a valid 6-digit Indian PIN code.');
      if (!form.name.trim() || !form.city.trim() || !form.area.trim()) throw new Error('Complete all required fields.');
      if (!form.dob || form.dob > new Date().toISOString().slice(0, 10)) throw new Error('Enter a valid date of birth.');
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) throw new Error('Please sign in again.');
      let photo = avatar;
      if (blob) {
        uploaded = `${user.id}/${crypto.randomUUID()}.webp`;
        const result = await supabase.storage.from('partner-avatars').upload(uploaded, blob, { contentType: 'image/webp', upsert: false });
        if (result.error) { uploaded = null; throw result.error; }
        photo = supabase.storage.from('partner-avatars').getPublicUrl(uploaded).data.publicUrl;
      }
      if (!photo) throw new Error('Please upload an avatar image.');
      const result = await supabase.rpc('save_partner_profile', { p_name: form.name.trim(), p_whatsapp: whatsapp, p_postal: form.postal, p_city: form.city.trim(), p_avatar: photo, p_dob: form.dob, p_area: form.area.trim(), p_notifications: form.notifications });
      if (result.error) throw result.error;
      uploaded = null;
      onSaved({ ownerName: form.name.trim(), whatsapp, postalCode: form.postal, city: form.city.trim(), ownerPhotoUrl: photo });
      onClose();
    } catch (e: any) {
      if (uploaded) await supabase.storage.from('partner-avatars').remove([uploaded]);
      setError(e.message || 'Profile could not be saved. Please retry.');
    } finally { setBusy(false); }
  }
  return <dialog ref={dialog} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }} aria-labelledby="partner-title" className="m-auto w-[min(94vw,520px)] max-h-[90dvh] rounded-3xl p-0 backdrop:bg-black/50">
    <div className="flex justify-between items-center bg-pink-50 p-5"><div><h2 id="partner-title" className="font-bold">User Profile Settings</h2><p className="text-xs text-slate-500">Manage partner account & location details</p></div><button type="button" disabled={busy} onClick={onClose} aria-label="Close profile settings">✕</button></div>
    <form onSubmit={save} className="p-5 space-y-5">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <fieldset disabled={loading || busy} className="space-y-5 disabled:opacity-60">
        <div className="flex items-center gap-4 rounded-2xl bg-slate-50 p-4">
          {avatar && <img src={avatar} alt="Partner avatar" className="w-20 h-20 rounded-full object-cover" />}
          <label className="text-sm font-semibold">Partner Avatar Image *<input type="file" accept="image/jpeg,image/png,image/webp" className="block mt-2 w-full text-xs" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; setBusy(true); setError(''); try { setBlob(await compressPartnerAvatar(file)); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }} /><span className="block text-xs font-normal text-slate-500 mt-2">Max 5 MB. Automatically compressed to 500px.</span></label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {([['name', 'Full Name', 'text'], ['whatsapp', 'WhatsApp Number', 'tel'], ['dob', 'Date of Birth (DOB)', 'date'], ['postal', 'PIN Code / Postal Code', 'text'], ['city', 'City', 'text'], ['area', 'Area / Locality', 'text']] as const).map(([key, label, type]) => <label key={key} className="text-xs font-semibold text-slate-700">{label} *<input required type={type} value={form[key]} maxLength={key === 'postal' ? 6 : 120} max={key === 'dob' ? new Date().toISOString().slice(0, 10) : undefined} inputMode={key === 'postal' ? 'numeric' : undefined} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className="block mt-2 w-full rounded-xl border border-slate-200 p-3 font-normal" /></label>)}
        </div>
        <label className="flex gap-3 items-center rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm"><input type="checkbox" checked={form.notifications} onChange={e => setForm(f => ({ ...f, notifications: e.target.checked }))} /><span>WhatsApp Booking Confirmations<span className="block text-xs text-slate-500">Save your preference for booking alerts. Delivery requires a connected WhatsApp provider.</span></span></label>
        <button className="w-full rounded-xl bg-[#C20E5A] p-3 font-bold text-white" type="submit">{busy ? 'Saving…' : 'Save Profile'}</button>
      </fieldset>
    </form>
  </dialog>;
}
