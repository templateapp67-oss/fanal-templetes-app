import React, { useRef, useState } from 'react';
import type { SalonProfile } from '../types';
import { WebsiteLocationMap, websiteLocation } from './WebsiteLocationMap';
import { geocodeOpenStreetMap } from '../utils/openStreetMapGeocoding';

interface InteractiveMapSetupProps {
  profile: SalonProfile;
  setProfile: React.Dispatch<React.SetStateAction<SalonProfile>>;
  themePrimaryColor?: string;
}

/** Controlled fields: mounting, receiving a newer cloud profile, or viewing
 * the map never writes a snapshot of old local inputs back to the owner. */
export function InteractiveMapSetup({ profile, setProfile, themePrimaryColor = '#0f172a' }: InteractiveMapSetupProps) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const current = useRef(profile); current.current = profile;
  React.useEffect(() => () => { request.current++; }, []);
  const update = (patch: Partial<SalonProfile>) => {
    request.current++; setBusy(false); setStatus('');
    setProfile(p => ({ ...p, ...patch, latitude: undefined, longitude: undefined }));
  };
  const locate = async () => {
    const address = websiteLocation(profile).address;
    if (!address.trim()) { setStatus('Enter your studio address first.'); return; }
    const owner = profile.ownerId;
    const version = ++request.current;
    setBusy(true); setStatus('Looking up this address…');
    try {
      const result = await geocodeOpenStreetMap(address);
      if (version !== request.current || current.current.ownerId !== owner || websiteLocation(current.current).address !== address) return;
      if (result) {
        setProfile(p => p.ownerId === owner && websiteLocation(p).address === address ? { ...p, latitude: result.lat, longitude: result.lng } : p);
        setStatus('Address located. Check the map before publishing.');
      } else setStatus('Using your saved address on the map. An exact GPS pin could not be verified.');
    } catch { if (version === request.current) setStatus('Using your saved address. Location lookup is unavailable.'); }
    finally { if (version === request.current) setBusy(false); }
  };
  return <section className="space-y-4 rounded-2xl bg-white p-4 text-slate-900">
    <div><h3 className="font-bold">Salon Address &amp; Localization Setup</h3><p className="mt-1 text-xs text-slate-500">The saved address is shown immediately; OpenStreetMap displays the location without an API key.</p></div>
    <label className="block text-xs font-bold">Street address<textarea aria-label="Studio street address" value={profile.address || ''} onChange={e => update({ address: e.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm" /></label>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{([
      ['Shop / Flat / Suite No.', 'shopFlatNo'], ['Area / Locality', 'areaLocality'], ['City', 'city'], ['State', 'state'], ['Postal code', 'postalCode'], ['Landmark', 'landmark'],
    ] as const).map(([label, key]) => <label key={key} className="text-xs font-bold">{label}<input aria-label={label} value={profile[key] || ''} onChange={e => update({ [key]: e.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 p-2 text-sm" /></label>)}</div>
    <button type="button" disabled={busy} onClick={locate} style={{ backgroundColor: themePrimaryColor }} className="rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-60">{busy ? 'Looking up address…' : 'Confirm Address & Place Marker Pin'}</button>
    {status && <p role="status" className="text-xs text-slate-600">{status}</p>}
    <WebsiteLocationMap profile={profile} />
  </section>;
}
