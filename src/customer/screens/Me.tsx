// ============================================================================
// Customer App — Profile and Location.
//
// Both screens write through `/api/customer/me/profile`, which accepts a fixed
// whitelist of columns. That whitelist is the whole safety story: `profiles` is
// shared with salon owners, and a customer form that could write `salon_name`,
// `theme_preset` or `require_deposit` would let an account edit the salon it is
// booking with. Coordinates are the subtle one — `profiles.latitude` is the
// SALON's pin when the row is a published salon, so the API refuses a customer
// geo write there and keeps it on the device instead.
// ============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, MapPin, Navigation, Save, Smartphone } from 'lucide-react';
import {
  getMyProfile,
  saveMyLocation,
  saveMyProfile,
  currentCustomerUser,
  listMyRewards,
} from '../../lib/customer/api';
import {
  CUSTOMER_LANGUAGES,
  readLanguage,
  readLocation,
  requestBrowserLocation,
  reverseGeocodeCity,
  writeLanguage,
  writeLocation,
} from '../../lib/customer/deviceStore';
import { readSearchHistory, clearSearchHistory } from '../../lib/customer/deviceStore';
import type { CustomerLocation, CustomerProfile } from '../../lib/customer/types';
import { Button, CARD_CLASS, Chip, ConnectionNotice, ErrorState, Field, LoadingRows, MUTED_CLASS, SourceChip, StatTile } from '../ui';

export interface MeScreenProps {
  userId?: string | null;
  accentHex?: string;
  /** Bumped by the shell after a sign-in so the profile re-reads. */
  refreshToken?: number;
  onRequireAuth?: () => void;
  /** Called when the city changes, so Home re-runs discovery. */
  onLocationChange?: (location: CustomerLocation) => void;
}

export const ProfileScreen: React.FC<MeScreenProps> = ({ userId, accentHex = '#C20E5A', refreshToken = 0, onRequireAuth }) => {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState<'live' | 'mock'>('live');
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    whatsapp: '',
    dateOfBirth: '',
    city: '',
    area: '',
    address: '',
    postalCode: '',
    state: '',
    landmark: '',
    avatarUrl: '',
  });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState('');
  const [saveError, setSaveError] = useState('');
  const [walletCount, setWalletCount] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void (async () => {
      const result = await getMyProfile();
      if (cancelled) return;
      if (!result.ok) {
        setFailed(true);
        setError(result.error || 'Your profile could not be loaded.');
        setLoading(false);
        return;
      }
      const row = (result.data || null) as CustomerProfile | null;
      setProfile(row);
      setMode(result.mode || 'live');
      setNotice(result.notice || '');
      setForm({
        fullName: row?.fullName || '',
        phone: row?.phone || '',
        whatsapp: row?.whatsapp || '',
        dateOfBirth: row?.dateOfBirth || '',
        city: row?.city || '',
        area: row?.area || '',
        address: row?.address || '',
        postalCode: row?.postalCode || '',
        state: row?.state || '',
        landmark: row?.landmark || '',
        avatarUrl: row?.avatarUrl || '',
      });
      setLoading(false);
      if (row?.id) {
        const rewards = await listMyRewards();
        if (!cancelled && rewards.ok) setWalletCount((rewards.data as any)?.wallets?.length || 0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshToken, reloadKey]);

  const dirty = useMemo(() => {
    if (!profile) return false;
    return (
      form.fullName !== profile.fullName ||
      form.phone !== profile.phone ||
      form.whatsapp !== profile.whatsapp ||
      (form.dateOfBirth || undefined) !== profile.dateOfBirth ||
      form.city !== profile.city ||
      form.area !== profile.area ||
      form.avatarUrl !== profile.avatarUrl ||
      form.address !== profile.address ||
      form.postalCode !== profile.postalCode ||
      form.state !== profile.state ||
      form.landmark !== profile.landmark
    );
  }, [form, profile]);

  const save = async () => {
    setSaving(true);
    setSaveError('');
    const result = await saveMyProfile(form);
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error || 'Your profile could not be saved.');
      return;
    }
    const next = result.data as CustomerProfile | null;
    if (next) setProfile(next);
    setSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    if (result.notice) setNotice(result.notice);
  };

  if (loading) return <LoadingRows rows={4} label="Loading your profile from Supabase…" />;
  if (failed) {
    return /sign in/i.test(error) ? (
      <ErrorState
        title="Sign in to open your profile"
        message={error}
        onRetry={() => onRequireAuth?.()}
        hint="Your profile is the row that links your bookings, wallet and notifications."
      />
    ) : (
      <ErrorState message={error} onRetry={() => setReloadKey((key) => key + 1)} />
    );
  }

  return (
    <div className="space-y-4">
      <ConnectionNotice mode={mode} notice={notice} />

      <div className={`${CARD_CLASS} p-5`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-lg font-extrabold text-slate-900">{profile?.fullName || form.fullName || 'Your profile'}</h1>
            <p className={`text-sm mt-0.5 ${MUTED_CLASS}`}>{profile?.email || 'No email on this account'}</p>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <SourceChip source="supabase" mode={mode} loading={loading} />
            {profile?.isCustomerRecord === false ? <Chip tone="neutral" title="This account has published a salon, so geo columns stay with the salon">owner account</Chip> : null}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-5">
          <StatTile label="Salon wallets" value={String(walletCount)} hint="one per salon you have booked" accentHex={accentHex} />
          <StatTile label="Referral code" value={profile?.referralCode || '—'} hint="share it, earn points back" />
          <StatTile label="Last saved" value={savedAt || (profile?.updatedAt ? new Date(profile.updatedAt).toLocaleDateString() : '—')} />
        </div>
      </div>

      <div className={`${CARD_CLASS} p-5 space-y-4`}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">Contact details</h2>
          {savedAt ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5" /> saved {savedAt}
            </span>
          ) : null}
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Full name" value={form.fullName} onChange={(value) => setForm({ ...form, fullName: value })} />
          <Field label="Mobile" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} type="tel" hint="Salons use this to find your booking" />
          <Field label="WhatsApp" value={form.whatsapp} onChange={(value) => setForm({ ...form, whatsapp: value })} type="tel" hint="Confirmations are sent here" />
          <Field
            label="Date of birth"
            value={form.dateOfBirth}
            onChange={(value) => setForm({ ...form, dateOfBirth: value })}
            type="date"
            hint="Your salon credits the annual birthday bonus when you check in on this day"
          />
          <Field label="Pincode" value={form.postalCode} onChange={(value) => setForm({ ...form, postalCode: value })} />
        </div>

        <h2 className="text-base font-bold text-slate-900 pt-2">Address</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="City" value={form.city} onChange={(value) => setForm({ ...form, city: value })} hint="Discovery sorts by distance from here" />
          <Field label="State" value={form.state} onChange={(value) => setForm({ ...form, state: value })} />
          <Field label="Street address" value={form.address} onChange={(value) => setForm({ ...form, address: value })} />
          <Field label="Landmark" value={form.landmark} onChange={(value) => setForm({ ...form, landmark: value })} />
          <Field
            label="Area or locality"
            value={form.area}
            onChange={(value) => setForm({ ...form, area: value })}
            hint="Saved to profiles.address_line2 — the same column a salon uses for its second address line"
          />
          <Field
            label="Profile photo URL"
            value={form.avatarUrl}
            onChange={(value) => setForm({ ...form, avatarUrl: value })}
            hint="Saved to profiles.owner_photo_url. On an account that publishes a salon this column belongs to the salon page, so it stays untouched."
          />
          <LanguageRow customerId={userId} />
        </div>

        {saveError ? <p className="text-sm font-semibold text-rose-700">{saveError}</p> : null}
        <div className="flex items-center gap-3 pt-1">
          <Button onClick={save} busy={saving} disabled={!dirty} accentHex={accentHex}>
            <Save className="w-4 h-4" /> {dirty ? 'Save changes' : 'Saved'}
          </Button>
          {!dirty && !savedAt ? <span className={`text-xs ${MUTED_CLASS}`}>Nothing to save yet.</span> : null}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------
/**
 * Language is the one profile field this schema cannot hold: no table has a
 * column for it, and inventing one is out of bounds. So it is stored on the
 * device, applied to `document.lang` immediately, and labelled as such instead of
 * pretending to be a row.
 */
const LanguageRow: React.FC<{ customerId?: string | null }> = ({ customerId }) => {
  const [language, setLanguage] = useState(() => readLanguage(customerId));
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = language;
  }, [language]);

  return (
    <div className="sm:col-span-2">
      <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Language</label>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {CUSTOMER_LANGUAGES.map((entry) => (
          <button
            key={entry.code}
            type="button"
            onClick={() => {
              setLanguage(entry.code);
              setSaved(writeLanguage(customerId, entry.code));
            }}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer border ${
              language === entry.code ? 'bg-slate-900 text-white border-transparent' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 mt-1.5">
        {saved ? 'Saved on this device' : 'Saved on this device'} · kept in this browser, because no table in the current schema has a language column. The
        app\'s own copy is English.
      </p>
    </div>
  );
};

export const LocationScreen: React.FC<MeScreenProps & { onDone?: () => void }> = ({
  userId,
  accentHex = '#C20E5A',
  refreshToken = 0,
  onLocationChange,
  onDone,
}) => {
  const [location, setLocation] = useState<CustomerLocation | null>(() => readLocation(userId));
  const [cityDraft, setCityDraft] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');
  const [recentSearches, setRecentSearches] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRecentSearches(readSearchHistory(userId).length);
    void (async () => {
      const stored = readLocation(userId);
      if (stored) {
        if (!cancelled) {
          setLocation(stored);
          setCityDraft(stored.city);
        }
        return;
      }
      // Fall back to the city on the customer's own profile row.
      const profile = await getMyProfile();
      if (!cancelled && profile.ok && (profile.data as CustomerProfile | null)?.city) {
        const fromProfile = (profile.data as CustomerProfile).city;
        setLocation({ city: fromProfile, latitude: null, longitude: null, label: fromProfile, source: 'profile', updatedAt: new Date().toISOString() });
        setCityDraft(fromProfile);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshToken]);

  const detect = async () => {
    setDetecting(true);
    setDetectError('');
    const fix = await requestBrowserLocation();
    if (!fix.ok) {
      setDetecting(false);
      setDetectError(fix.error);
      return;
    }
    const city = await reverseGeocodeCity(fix.latitude, fix.longitude);
    const next: CustomerLocation = {
      city: city || cityDraft || '',
      latitude: fix.latitude,
      longitude: fix.longitude,
      label: city ? `Near ${city}` : 'Current position',
      source: 'gps',
      updatedAt: new Date().toISOString(),
    };
    setLocation(next);
    setCityDraft(next.city);
    writeLocation(userId, next);
    setDetecting(false);
    setSavedNotice(city ? `Found ${city}, ${fix.accuracyMeters}m accuracy.` : 'Got your position — the nearest published salons will be listed first.');
  };

  const saveCity = async () => {
    const clean = cityDraft.trim();
    if (!clean) {
      setDetectError('Type a city so we can find salons near you.');
      return;
    }
    const next: CustomerLocation = {
      city: clean,
      // Coordinates are kept when we have them; a manual city must not wipe the
      // GPS fix that makes distance sorting work.
      latitude: location?.source === 'gps' ? location.latitude : null,
      longitude: location?.source === 'gps' ? location.longitude : null,
      label: clean,
      source: 'manual',
      updatedAt: new Date().toISOString(),
    };
    setSaving(true);
    writeLocation(userId, next);
    setLocation(next);
    onLocationChange?.(next);
    // Persist to the profile row too, so the city survives a new device.
    const result = await saveMyLocation(next);
    setSaving(false);
    setSavedNotice(
      result.ok
        ? result.notice && /not writable|device/i.test(result.notice)
          ? `${clean} saved on this device. Distance sorting works; the city was not written to your shared profile row.`
          : `${clean} saved to your profile.`
        : `Saved on this device only — ${result.error || 'the profile update failed'}`
    );
  };

  return (
    <div className="space-y-4">
      <div className={`${CARD_CLASS} p-5`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-extrabold text-slate-900 inline-flex items-center gap-2">
              <MapPin className="w-4.5 h-4.5" style={{ color: accentHex }} /> Your location
            </h1>
            <p className={`text-sm mt-1 ${MUTED_CLASS}`}>
              {location?.city
                ? `Showing salons near ${location.city}${location.latitude !== null ? ' — sorted by distance' : ' — sorted by name until you share a position'}.`
                : 'Share a location to sort salons by distance and to pre-fill your home-visit address.'}
            </p>
          </div>
          <SourceChip source={location?.source === 'profile' ? 'supabase' : 'device'} title={location?.source === 'profile' ? 'city from your profile row' : 'kept on this device, plus your profile city'} />
        </div>

        <div className="grid sm:grid-cols-[1fr_auto_auto] gap-3 mt-5 items-end">
          <Field label="City or area" value={cityDraft} onChange={setCityDraft} placeholder="e.g. Indiranagar, Bengaluru" />
          <Button onClick={saveCity} busy={saving} variant="secondary">
            <Save className="w-4 h-4" /> Save city
          </Button>
          <Button onClick={detect} busy={detecting} accentHex={accentHex}>
            <Navigation className="w-4 h-4" /> Use GPS
          </Button>
        </div>

        {detectError ? <p className="text-sm font-semibold text-rose-700 mt-3">{detectError}</p> : null}
        {savedNotice ? (
          <p className="text-sm font-semibold text-emerald-700 mt-3 inline-flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> {savedNotice}
          </p>
        ) : null}

        <div className="grid sm:grid-cols-3 gap-3 mt-5">
          <StatTile label="Coordinates" value={location?.latitude !== null && location?.latitude !== undefined ? `${location.latitude.toFixed(3)}, ${Number(location.longitude).toFixed(3)}` : 'not shared'} hint={location?.source === 'gps' ? 'from this device GPS' : 'tap Use GPS for distance sorting'} />
          <StatTile label="Last updated" value={location?.updatedAt ? new Date(location.updatedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'} />
          <StatTile label="Saved searches" value={String(recentSearches)} hint="this device only — no history table exists" />
        </div>
      </div>

      <div className={`${CARD_CLASS} p-5`}>
        <h2 className="text-sm font-bold text-slate-900 inline-flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-slate-400" /> Why the pin is not always stored
        </h2>
        <p className={`text-sm mt-2 ${MUTED_CLASS}`}>
          <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">profiles.latitude</code> is the <em>salon’s</em> coordinate on the shared
          profiles table. Writing your GPS fix there would move that salon on every map and distance sort in the app, so the API accepts the pin only on a
          customer row and keeps it on this device otherwise. City, address and pincode are saved to your record normally.
        </p>
      </div>

      {onDone ? (
        <div className="flex justify-end">
          <Button onClick={onDone} accentHex={accentHex}>
            Continue to salons
          </Button>
        </div>
      ) : null}
    </div>
  );
};
