import { readPartnerProfile } from '../lib/readPartnerProfile';
import React, { useEffect, useRef, useState } from 'react';
import type { SalonProfile } from '../types';
import { supabase, isMockSupabase } from '../lib/supabaseClient';
import { compressPartnerAvatar, normalizeWhatsApp } from '../lib/partnerProfile';
import { queueOwnerWrite } from '../lib/ownerEditorState';
import { AuthModal } from './AuthModal';

export function PartnerProfileModal({ profile, onSaved, onClose, editable = false }: {
  editable?: boolean; profile: SalonProfile; onSaved: (patch: Partial<SalonProfile>) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const dirty = useRef(false);
  const [form, setForm] = useState({
    ownerName: profile.ownerName,
    whatsapp: profile.whatsapp || '',
    postalCode: profile.postalCode || '',
    city: profile.city || '',
    areaLocality: profile.areaLocality || '',
    phone: profile.phone || '',
    email: profile.email || '',
    address: profile.address || '',
    state: profile.state || '',
    landmark: profile.landmark || '',
    dob: profile.dob || '',
    notifications: profile.whatsappNotificationsEnabled ?? false
  });
  const [avatar, setAvatar] = useState(profile.ownerPhotoUrl || '');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState('');
  const [isAuthOpen, setIsAuthOpen] = useState(false);

  useEffect(() => { dialog.current?.showModal(); }, []);

  useEffect(() => {
    if (dirty.current) return;
    setForm(f => ({
      ...f,
      ownerName: profile.ownerName,
      whatsapp: profile.whatsapp || '',
      postalCode: profile.postalCode || '',
      city: profile.city || '',
      areaLocality: profile.areaLocality ?? f.areaLocality,
      phone: profile.phone || '',
      email: profile.email || '',
      address: profile.address || '',
      state: profile.state || '',
      landmark: profile.landmark || '',
      dob: profile.dob ?? f.dob,
      notifications: profile.whatsappNotificationsEnabled ?? f.notifications,
    }));
    setAvatar(profile.ownerPhotoUrl || '');
  }, [profile]);

  useEffect(() => {
    let active = true;
    setError('');

    // If Supabase is in mock mode or there is no authenticated owner ID yet:
    // Do not throw an unrecoverable error. The form is already initialized with local profile
    // values, and the user can view/edit their profile immediately without being blocked.
    if (isMockSupabase || !profile.ownerId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    (async () => {
      try {
        const { data, error: fetchErr } = await readPartnerProfile(profile.ownerId);
        if (fetchErr) throw fetchErr;
        if (active) {
          setForm(f => ({
            ...f,
            dob: data?.dob || f.dob || '',
            areaLocality: profile.areaLocality ?? data?.area ?? f.areaLocality ?? '',
            notifications: data?.notifications === true,
          }));
          if (data?.avatar && !avatar) {
            setAvatar(data.avatar);
          }
        }
      } catch (e: any) {
        if (active) {
          console.warn('[PartnerProfileModal] Cloud profile sync notice:', e.message);
          setError(e.message || 'Could not load cloud profile details.');
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, [loadAttempt, profile.ownerId]);

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

      let currentUser = null;
      if (!isMockSupabase) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          currentUser = user;
        } catch {
          currentUser = null;
        }
      }

      let photo = avatar;
      let image = blob;
      if (!image && avatar.startsWith('data:image/')) {
        try {
          image = await (await fetch(avatar)).blob();
        } catch {
          // preserve photo
        }
      }

      // If user is authenticated with Supabase, upload to storage
      if (image && currentUser && !isMockSupabase) {
        const extension = image.type === 'image/png' ? 'png' : image.type === 'image/jpeg' ? 'jpg' : 'webp';
        uploaded = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;
        const result = await supabase.storage.from('partner-avatars').upload(uploaded, image, { contentType: image.type, upsert: false });
        if (result.error) {
          uploaded = null;
          console.warn('[PartnerProfileModal] Storage upload warning:', result.error.message);
        } else {
          photo = supabase.storage.from('partner-avatars').getPublicUrl(uploaded).data.publicUrl;
        }
      } else if (image && (!currentUser || isMockSupabase)) {
        // In local/guest mode, convert to data URL so the avatar is preserved locally
        try {
          photo = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(image!);
          });
        } catch {
          // fallback to current avatar
        }
      }

      if (!photo) throw new Error('Please upload an avatar image.');

      const { dob, notifications, ...shared } = form;
      const patch: Partial<SalonProfile> = {
        ...shared,
        ownerName: form.ownerName.trim(),
        whatsapp,
        city: form.city.trim(),
        areaLocality: form.areaLocality.trim(),
        ownerPhotoUrl: photo,
        dob,
        whatsappNotificationsEnabled: notifications,
      };

      // Persist to Supabase RPC if authenticated
      if (currentUser && !isMockSupabase) {
        await queueOwnerWrite(async () => {
          const result = await supabase.rpc('save_partner_profile_details', {
            p_details: { ...patch, subdomain: profile.subdomain, dob, notifications }
          });
          if (result.error) throw result.error;
          uploaded = null;
          const verification = await supabase.rpc('get_partner_profile');
          if (verification.error) throw verification.error;
          if (verification.data?.dob !== dob || verification.data?.avatar !== photo) {
            throw new Error('Saved profile could not be verified. Please retry.');
          }
        });
      }

      uploaded = null;
      onSaved(patch);
      onClose();
    } catch (e: any) {
      if (uploaded && !isMockSupabase) {
        try { await supabase.storage.from('partner-avatars').remove([uploaded]); } catch { /* preserve original save error */ }
      }
      setError(e.message || 'Profile could not be saved. Please retry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <dialog
        ref={dialog}
        onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}
        aria-labelledby="partner-title"
        className="m-auto w-[min(94vw,560px)] max-h-[90dvh] rounded-3xl p-0 backdrop:bg-black/50 shadow-2xl border-0"
      >
        <div className="flex flex-col max-h-[90dvh]">
          <div className="flex shrink-0 justify-between items-center bg-pink-50 p-5">
            <div>
              <h2 id="partner-title" className="font-bold text-gray-900">
                {editable ? "Profile Settings" : "User Profile"}
              </h2>
              <p className="text-xs text-slate-500">
                {editable
                  ? "Your saved profile · contact, date of birth & photo"
                  : "Details from Contact & Location — no duplicate entry needed"}
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              aria-label="Close profile settings"
              className="text-gray-400 hover:text-gray-600 text-lg p-1"
            >
              ✕
            </button>
          </div>

          <form id="partner-profile-form" onSubmit={save} className="p-5 space-y-4 overflow-y-auto min-h-0">
            {!profile.ownerId && !isMockSupabase && (
              <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-xs">
                <div>
                  <span className="font-bold">Guest Mode:</span> Details save to your current session. Sign in to sync across devices.
                </div>
                <button
                  type="button"
                  onClick={() => setIsAuthOpen(true)}
                  className="px-3 py-1.5 bg-[#C20E5A] text-white font-bold rounded-lg shrink-0 hover:bg-[#A30B4A] transition-colors"
                >
                  Sign In
                </button>
              </div>
            )}

            {isMockSupabase && (
              <div className="bg-blue-50 border border-blue-200 text-blue-900 rounded-xl p-3 text-xs">
                <span className="font-bold">Local Workspace:</span> Profile changes are saved directly to your local salon catalog.
              </div>
            )}

            {error && (
              <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center justify-between gap-2">
                <span>{error}</span>
                <button
                  type="button"
                  className="underline font-bold text-red-800 shrink-0 hover:text-red-900"
                  onClick={() => { setError(''); setLoadAttempt(v => v + 1); }}
                >
                  Retry loading
                </button>
              </div>
            )}

            {loading && !error && (
              <p role="status" className="text-xs text-slate-500 animate-pulse">
                Loading saved profile…
              </p>
            )}

            <fieldset disabled={!editable || loading || busy} className="space-y-5 disabled:opacity-60">
              <div className="flex items-center gap-4 rounded-2xl bg-slate-50 p-4">
                {avatar && (
                  <img
                    src={avatar}
                    alt="Partner avatar"
                    className="w-20 h-20 rounded-full object-cover border-2 border-pink-200"
                  />
                )}
                <label className="text-sm font-semibold text-slate-800">
                  Partner Avatar Image{' '}
                  {editable && (
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="block mt-2 w-full text-xs"
                      onChange={async e => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        dirty.current = true;
                        setBusy(true);
                        setError('');
                        try {
                          setBlob(await compressPartnerAvatar(file));
                        } catch (e: any) {
                          setError(e.message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                  )}
                  <span className="block text-xs font-normal text-slate-500 mt-2">
                    Max 5 MB. Automatically compressed to 500px.
                  </span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {([
                  ['ownerName', 'Full Name', 'text', true],
                  ['whatsapp', 'WhatsApp Number', 'tel', true],
                  ['dob', 'Date of Birth (DOB)', 'date', true],
                  ['postalCode', 'PIN Code / Postal Code', 'text', true],
                  ['city', 'City', 'text', true],
                  ['areaLocality', 'Area / Locality', 'text', true],
                  ['phone', 'Phone Number', 'tel', false],
                  ['email', 'Contact Email', 'email', false],
                  ['address', 'Physical Address', 'text', false],
                  ['state', 'State', 'text', false],
                  ['landmark', 'Landmark', 'text', false]
                ] as const).map(([key, label, type, required]) => (
                  <label key={key} className="text-xs font-semibold text-slate-700">
                    {label}
                    {required ? ' *' : ''}
                    <input
                      required={required}
                      type={type}
                      value={form[key]}
                      maxLength={key === 'postalCode' ? 6 : key === 'address' ? 1000 : 160}
                      max={key === 'dob' ? new Date().toISOString().slice(0, 10) : undefined}
                      inputMode={key === 'postalCode' ? 'numeric' : undefined}
                      onChange={e => {
                        dirty.current = true;
                        setForm(f => ({ ...f, [key]: e.target.value }));
                      }}
                      className="block mt-2 w-full rounded-xl border border-slate-200 p-3 font-normal text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#C20E5A]/20 focus:border-[#C20E5A]"
                    />
                  </label>
                ))}
              </div>

              <label className="flex gap-3 items-center rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.notifications}
                  onChange={e => {
                    dirty.current = true;
                    setForm(f => ({ ...f, notifications: e.target.checked }));
                  }}
                  className="rounded text-[#C20E5A] focus:ring-[#C20E5A]"
                />
                <span>
                  WhatsApp Booking Confirmations
                  <span className="block text-xs text-slate-500">
                    Save your booking alert preference.
                  </span>
                </span>
              </label>
            </fieldset>
          </form>

          <div className="shrink-0 border-t bg-white p-4">
            {editable ? (
              <button
                form="partner-profile-form"
                disabled={loading || busy}
                className="w-full rounded-xl bg-[#C20E5A] p-3 font-bold text-white disabled:opacity-50 hover:bg-[#A30B4A] transition-colors"
                type="submit"
              >
                {busy ? 'Saving…' : 'Save Contact Details'}
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-xl bg-slate-100 p-3 text-slate-700 hover:bg-slate-200 transition-colors font-medium"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </dialog>

      {isAuthOpen && (
        <AuthModal
          isOpen={isAuthOpen}
          onClose={() => setIsAuthOpen(false)}
          onSuccess={() => {
            setIsAuthOpen(false);
            setLoadAttempt(v => v + 1);
          }}
        />
      )}
    </>
  );
}
