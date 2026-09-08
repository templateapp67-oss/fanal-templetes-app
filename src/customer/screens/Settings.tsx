// ============================================================================
// Settings — account, device data, and an export of everything the API will
// admit to knowing about this customer.
//
// Deliberately small. A settings screen is where a half-wired app grows fake
// toggles, and this schema has no column for notification preferences, theme, or
// privacy switches: `profiles` holds contact + address + geo and nothing else. So
// the only controls here are the ones that change real state:
//
//   • language          → this device (no column exists anywhere for it)
//   • device data       → cleared for real (search history, pins, location)
//   • export            → the customer's own rows, fetched through the API
//   • sign out          → the session
//
// The export is a genuine capability rather than a courtesy: the app is the only
// place a customer can see their bookings, reviews and ledger rows at all, and a
// copy of them costs one round of requests.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  customerBackendConnected,
  getMyProfile,
  listMyBookings,
  listFavourites,
  listMyNotifications,
  listMyQrPayments,
  listMyReviews,
  listMyRewards,
  listMyMemberships,
  listMyReferrals,
} from '../../lib/customer/api';
import {
  clearSearchHistory,
  CUSTOMER_LANGUAGES,
  readFavouritePins,
  readLanguage,
  readLocation,
  readSearchHistory,
  writeFavouritePins,
  writeLanguage,
  writeLocation,
} from '../../lib/customer/deviceStore';
import type { CustomerProfile } from '../../lib/customer/types';
import { Check, Download, Globe, LogOut, Smartphone, Trash2 } from 'lucide-react';
import { Button, CARD_CLASS, Chip, ErrorState, LoadingRows, MUTED_CLASS, SectionTitle, SourceChip } from '../ui';

export const SettingsScreen: React.FC<{
  userId?: string | null;
  email?: string;
  accentHex?: string;
  refreshToken?: number;
  onSignOut?: () => void;
  onOpenData?: () => void;
  onOpenProfile?: () => void;
}> = ({ userId, email = '', accentHex = '#C20E5A', refreshToken = 0, onSignOut, onOpenData, onOpenProfile }) => {
  const [exporting, setExporting] = useState(false);
  const [exportState, setExportState] = useState({ text: '', kind: 'info' as 'info' | 'ok' | 'error' });
  const [cleared, setCleared] = useState('');
  const [language, setLanguage] = useState(() => readLanguage(userId));
  const [, bump] = useState(0);

  const device = useMemo(() => {
    void refreshToken;
    void bump;
    return {
      searches: readSearchHistory(userId).length,
      pins: readFavouritePins(userId).length,
      location: readLocation(userId)?.city || '',
    };
    // Re-read whenever the tab regains focus so a clear in another screen shows up.
  }, [userId, refreshToken, cleared]);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = language;
  }, [language]);

  const connected = customerBackendConnected();

  /**
   * Pull the customer's own rows and hand them over as one JSON file. Every
   * request is a route this app already uses on screen — no endpoint exists that
   * this export can reach and the UI cannot.
   */
  const exportData = useCallback(async () => {
    if (!userId) {
      setExportState({ text: 'Sign in and the export can gather your rows.', kind: 'error' });
      return;
    }
    setExporting(true);
    setExportState({ text: '', kind: 'info' });
    try {
      const [profile, bookings, reviews, rewards, qr, memberships, referrals, notifications, favourites] = await Promise.all([
        getMyProfile(),
        listMyBookings({}),
        listMyReviews(),
        listMyRewards(),
        listMyQrPayments(),
        listMyMemberships(),
        listMyReferrals(),
        listMyNotifications(),
        listFavourites(userId),
      ]);
      const payload = {
        exportedAt: new Date().toISOString(),
        source: connected ? 'supabase via /api/customer' : 'not connected — the API returned empty',
        profile: profile.ok ? profile.data : { error: profile.error },
        bookings: bookings.ok ? bookings.data : { error: bookings.error },
        reviews: reviews.ok ? reviews.data : { error: reviews.error },
        rewards: rewards.ok ? rewards.data : { error: rewards.error },
        qrPayments: qr.ok ? qr.data : { error: qr.error },
        memberships: memberships.ok ? memberships.data : { error: memberships.error },
        referrals: referrals.ok ? referrals.data : { error: referrals.error },
        notifications: notifications.ok ? notifications.data : { error: notifications.error },
        favourites: favourites.ok ? favourites.data : { error: favourites.error },
        device: {
          note: 'Favourite pins, recent searches and the picked location are stored in this browser, not in Supabase — the schema has no table for them.',
          language: readLanguage(userId),
          location: readLocation(userId),
          pins: readFavouritePins(userId),
          recentSearches: readSearchHistory(userId),
        },
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `nexora-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Revoke on a delay: some browsers cancel the download if it goes too early.
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      const count = (bookings.ok ? (bookings.data || []).length : 0) + (notifications.ok ? (notifications.data || []).length : 0);
      setExportState({ text: `Downloaded. ${count} booking and notification row(s) counted at the time of export.`, kind: 'ok' });
    } catch (err: any) {
      setExportState({ text: err?.message || 'The export could not be assembled.', kind: 'error' });
    } finally {
      setExporting(false);
    }
  }, [connected, userId]);

  const clearDeviceData = useCallback(
    (what: 'searches' | 'pins' | 'location' | 'all') => {
      if (what === 'searches' || what === 'all') clearSearchHistory(userId);
      if (what === 'pins' || what === 'all') writeFavouritePins(userId, []);
      if (what === 'location' || what === 'all') writeLocation(userId, null);
      setCleared(`${what} cleared at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    },
    [userId]
  );

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Settings"
        subtitle="Only the switches this schema can actually hold are here."
        right={<SourceChip source={connected ? 'supabase' : 'device'} mode={connected ? 'live' : 'mock'} title={connected ? 'Reads go through the API' : 'No Supabase credentials in this deployment'} />}
      />

      <div className={`${CARD_CLASS} p-4`}>
        <p className="text-sm font-bold text-slate-900">Account</p>
        <p className={`text-xs mt-0.5 ${MUTED_CLASS}`}>{email || 'Not signed in — sign in to sync bookings, wallet and notifications.'}</p>
        {userId ? <p className="text-[11px] text-slate-400 mt-1 font-mono">id {userId}</p> : null}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Chip tone={connected ? 'success' : 'warn'}>{connected ? 'database connected' : 'not connected'}</Chip>
          {onOpenProfile ? (
            <Button variant="secondary" onClick={onOpenProfile}>
              Edit profile
            </Button>
          ) : null}
          {onOpenData ? (
            <Button variant="secondary" onClick={onOpenData}>
              Data sources
            </Button>
          ) : null}
        </div>
      </div>

      <div className={`${CARD_CLASS} p-4`}>
        <div className="flex items-start gap-3">
          <Globe className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900">Language</p>
            <p className={`text-xs mt-0.5 ${MUTED_CLASS}`}>
              Stored on this device and applied to the page immediately. The schema has no language column, so it does not follow you to another phone — and
              the app&apos;s own copy is English today.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {CUSTOMER_LANGUAGES.map((entry) => (
                <button
                  key={entry.code}
                  type="button"
                  onClick={() => {
                    setLanguage(entry.code);
                    writeLanguage(userId, entry.code);
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer border ${
                    language === entry.code ? 'text-white border-transparent' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}
                  style={language === entry.code ? { backgroundColor: accentHex } : undefined}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className={`${CARD_CLASS} p-4`}>
        <div className="flex items-start gap-3">
          <Smartphone className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900">On this device</p>
            <p className={`text-xs mt-0.5 ${MUTED_CLASS}`}>
              Three things live in this browser because the current schema has no table for them: recent searches, favourite pins and the location you
              picked. Clearing them affects only this device.
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
              <Chip tone="neutral">{device.searches} recent search{device.searches === 1 ? '' : 'es'}</Chip>
              <Chip tone="neutral">{device.pins} pin{device.pins === 1 ? '' : 's'}</Chip>
              <Chip tone="neutral">{device.location ? `location: ${device.location}` : 'no location set'}</Chip>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Button variant="secondary" onClick={() => clearDeviceData('searches')}>
                <Trash2 className="w-3.5 h-3.5" /> Clear searches
              </Button>
              <Button variant="secondary" onClick={() => clearDeviceData('pins')}>
                <Trash2 className="w-3.5 h-3.5" /> Remove pins
              </Button>
              <Button variant="secondary" onClick={() => clearDeviceData('location')}>
                <Trash2 className="w-3.5 h-3.5" /> Forget location
              </Button>
            </div>
            {cleared ? (
              <p className="text-[11px] font-semibold text-emerald-700 mt-2 inline-flex items-center gap-1">
                <Check className="w-3 h-3" /> {cleared}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className={`${CARD_CLASS} p-4`}>
        <p className="text-sm font-bold text-slate-900">Your data</p>
        <p className={`text-xs mt-0.5 ${MUTED_CLASS}`}>
          One JSON file with the rows this app can read for you: profile, bookings, reviews, wallet and ledger, QR payments, membership, referrals,
          notifications and favourites — plus the device-only half, labelled as such.
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Button busy={exporting} onClick={exportData} disabled={!userId} accentHex={accentHex}>
            <Download className="w-4 h-4" /> Export as JSON
          </Button>
          {exportState.text ? (
            <span className={`text-[11px] font-semibold ${exportState.kind === 'error' ? 'text-rose-700' : 'text-emerald-700'}`}>{exportState.text}</span>
          ) : null}
        </div>
        {!userId ? <p className="text-[11px] text-slate-500 mt-2">Sign in to export — these rows are keyed to your account.</p> : null}
      </div>

      {onSignOut ? (
        <button
          type="button"
          onClick={onSignOut}
          className={`${CARD_CLASS} w-full px-4 py-3 text-left flex items-center justify-between gap-3 hover:border-slate-300 cursor-pointer`}
        >
          <span className="text-sm">
            <span className="font-bold text-slate-900">Sign out</span>
            <span className={`block ${MUTED_CLASS}`}>Clears this device&apos;s session. Your rows stay in Supabase.</span>
          </span>
          <LogOut className="w-4 h-4 text-slate-400 shrink-0" />
        </button>
      ) : null}
    </div>
  );
};
