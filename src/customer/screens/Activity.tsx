// ============================================================================
// Activity: notifications, favourites, and the data-source panel.
//
// The third tab is the one that makes this app auditable: it shows, per logical
// customer entity, which physical table backs it, whether that table exists in
// this Supabase project, roughly how many rows it holds, and what the mapping
// had to fake or derive. It is the same report `npm run verify` asserts on,
// reading `/api/customer/connection` — so "all 18 entities are connected" is a
// statement the screen can prove rather than claim.
// ============================================================================

import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Bell,
  BellOff,
  Check,
  Database,
  Heart,
  Info,
  MapPin,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import type { CustomerFavourite } from '../../lib/customer/types';
import {
  customerConnectionReport,
  customerMappingBadges,
  listFavourites,
  listMyNotifications,
  listMyReviews,
  markMyNotificationsRead,
  mappingNote,
  normalizeCustomerErrorMessage,
  toggleFavourite,
} from '../../lib/customer/api';
import { CUSTOMER_SCHEMA_GAPS, CUSTOMER_SCHEMA_MAP, RLS_REALITY } from '../../lib/customer/schema';
import { Button, CARD_CLASS, Chip, EmptyState, ErrorState, LoadingRows, MUTED_CLASS, SectionTitle, SourceChip, dayLabel, useCustomerQuery, useCustomerRealtime } from '../ui';

export interface ActivityProps {
  userId?: string | null;
  email?: string | null;
  accentHex?: string;
  refreshToken?: number;
  /** Deep link (`/app/notifications`) opens the matching tab instead of the default. */
  initialTab?: Tab;
  onOpenSalon?: (salonId: string) => void;
  onOpenBooking?: (bookingId: string) => void;
}

type Tab = 'notifications' | 'favourites' | 'data';

export const ActivityScreen: React.FC<ActivityProps> = ({ userId, email, accentHex = '#C20E5A', refreshToken = 0, initialTab = 'notifications', onOpenSalon, onOpenBooking }) => {
  const [tab, setTab] = useState<Tab>(initialTab);
  React.useEffect(() => setTab(initialTab), [initialTab]);
  const notifications = useCustomerQuery(() => listMyNotifications(), [userId, email, refreshToken]);
  const favourites = useCustomerQuery(() => listFavourites(userId), [userId, refreshToken]);
  const reviews = useCustomerQuery(() => listMyReviews(), [userId, refreshToken]);
  const unread = (notifications.data || []).filter((item: any) => !item.read).length;

  const items: Array<{ id: Tab; label: string; badge?: number }> = [
    { id: 'notifications', label: 'Notifications', badge: unread },
    { id: 'favourites', label: 'Favourites', badge: (favourites.data || []).length },
    { id: 'data', label: 'Data sources' },
  ];

  return (
    <div className="space-y-4">
      <SectionTitle title="Activity" subtitle="Notifications come from `in_app_notifications`; favourites are your booking history plus this device's pins." />
      <div className="flex gap-1.5" role="tablist">
        {items.map((item) => {
          const active = item.id === tab;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.id)}
              className={`flex-1 px-3 py-2 rounded-2xl text-xs font-bold border transition ${
                active ? 'border-transparent text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
              style={active ? { backgroundColor: accentHex } : undefined}
            >
              {item.label}
              {item.badge ? <span className="ml-1.5 inline-block px-1.5 rounded-full bg-white/20 text-[10px]">{item.badge}</span> : null}
            </button>
          );
        })}
      </div>

      {tab === 'notifications' ? (
        <NotificationsPanel state={notifications} email={email} accentHex={accentHex} onOpenBooking={onOpenBooking} onOpenSalon={onOpenSalon} />
      ) : null}
      {tab === 'favourites' ? (
        <FavouritesPanel state={favourites} reviews={reviews.data || []} userId={userId} accentHex={accentHex} onOpenSalon={onOpenSalon} />
      ) : null}
      {tab === 'data' ? <DataPanel /> : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
const NotificationsPanel: React.FC<{
  state: { data: any[] | null; loading: boolean; failed: boolean; error: string; notice: string; mode: 'live' | 'mock'; reload: () => void };
  email?: string | null;
  accentHex: string;
  onOpenBooking?: (id: string) => void;
  onOpenSalon?: (id: string) => void;
}> = ({ state, email, accentHex, onOpenBooking, onOpenSalon }) => {
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState('');
  const realtime = useCustomerRealtime(['notifications'], email, () => state.reload());
  const rows = state.data || [];

  async function markRead() {
    setMarking(true);
    setError('');
    const result = await markMyNotificationsRead();
    setMarking(false);
    if (!result.ok) return void setError(normalizeCustomerErrorMessage(result));
    state.reload();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Chip tone="neutral" title="Realtime arrives as a wake signal on this table only; the payload is always re-read through the API">
          {realtime.transport === 'supabase-realtime' ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> listening
            </>
          ) : (
            <>
              <RefreshCw className="w-3 h-3" /> polling
            </>
          )}
        </Chip>
        <Button variant="ghost" busy={marking} onClick={markRead} disabled={!rows.some((row: any) => !row.read)} accentHex={accentHex}>
          <Check className="w-4 h-4" /> Mark all read
        </Button>
      </div>
      {error ? <p className="text-xs font-semibold text-rose-600">{error}</p> : null}
      {state.loading ? <LoadingRows rows={3} label="Loading your notifications…" /> : null}
      {state.failed ? <ErrorState message={state.error} onRetry={state.reload} /> : null}
      {!state.loading && !state.failed && !rows.length ? (
        <EmptyState
          icon={<BellOff className="w-6 h-6 text-slate-400" />}
          title="No notifications yet"
          body="Booking confirmations, cancellations and reward credits land here, matched on the email of your signed-in account."
        />
      ) : null}
      <div className="space-y-2">
        {rows.map((item) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className={`${CARD_CLASS} p-3.5 ${item.read ? 'opacity-70' : 'border-l-4'}`}
            style={item.read ? undefined : { borderLeftColor: accentHex }}
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 w-8 h-8 rounded-xl bg-slate-100 grid place-items-center shrink-0">
                <Bell className="w-4 h-4 text-slate-500" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-900">{item.title}</p>
                <p className={`text-xs mt-0.5 ${MUTED_CLASS}`}>{item.message}</p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <p className="text-[11px] text-slate-400">
                    {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}
                  </p>
                  {item.bookingId && onOpenBooking ? (
                    <button type="button" onClick={() => onOpenBooking(item.bookingId)} className="text-[11px] font-bold text-slate-700 underline">
                      Open booking
                    </button>
                  ) : null}
                  {item.salonId && onOpenSalon && !item.bookingId ? (
                    <button type="button" onClick={() => onOpenSalon(item.salonId)} className="text-[11px] font-bold text-slate-700 underline">
                      Open salon
                    </button>
                  ) : null}
                  <SourceChip source={item.source} title="in_app_notifications row addressed to your email" />
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
      {state.notice ? <p className="text-[11px] text-amber-700">{state.notice}</p> : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Favourites
// ---------------------------------------------------------------------------
const FavouritesPanel: React.FC<{
  state: { data: CustomerFavourite[] | null; loading: boolean; failed: boolean; error: string; reload: () => void; setData: (next: CustomerFavourite[]) => void };
  reviews: any[];
  userId?: string | null;
  accentHex: string;
  onOpenSalon?: (id: string) => void;
}> = ({ state, reviews, userId, accentHex, onOpenSalon }) => {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const rows = state.data || [];

  async function unpin(item: CustomerFavourite) {
    if (item.origin !== 'pinned') return;
    setBusy(item.id);
    setError('');
    const result = await toggleFavourite(userId, {
      salonId: item.salonId,
      staffId: item.staffId,
      serviceId: item.serviceId,
      kind: item.kind,
      salonName: item.salonName,
      staffName: item.staffName,
      serviceName: item.serviceName,
      pinned: false,
    });
    setBusy('');
    if (!result.ok) return void setError(normalizeCustomerErrorMessage(result));
    state.setData(result.data || []);
  }

  return (
    <div className="space-y-3">
      <div className={`${CARD_CLASS} p-3.5 flex items-start gap-3`}>
        <Info className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />
        <p className={`text-xs ${MUTED_CLASS}`}>
          The current schema has no favourites table, so this list is two things: salons, staff and services you have actually booked (derived from your
          `bookings` rows and their service lines) and anything you pinned on <em>this device</em>. Pinned entries do not follow you to another phone —
          that is a mapping gap, not a bug in this screen.
        </p>
      </div>
      {error ? <p className="text-xs font-semibold text-rose-600">{error}</p> : null}
      {state.loading ? <LoadingRows rows={2} label="Reading your booking history…" /> : null}
      {state.failed ? <ErrorState message={state.error} onRetry={state.reload} /> : null}
      {!state.loading && !state.failed && !rows.length ? (
        <EmptyState
          icon={<Heart className="w-6 h-6 text-slate-400" />}
          title="No favourites yet"
          body="Book once and the salon shows up here automatically, or pin a salon, a stylist or a service from its row — the heart is on every one."
        />
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((item) => (
          <div key={item.id} className={`${CARD_CLASS} p-3.5`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 truncate">
                  {item.kind === 'salon' ? item.salonName : item.kind === 'staff' ? item.staffName || 'A stylist' : item.serviceName || 'A service'}
                  {item.kind !== 'salon' && item.salonName ? <span className={`text-xs font-medium ${MUTED_CLASS}`}> · {item.salonName}</span> : null}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">{item.kind === 'service' ? 'service' : item.kind}</p>
                <p className={`text-xs mt-0.5 ${MUTED_CLASS}`}>
                  {item.visits} visit{item.visits === 1 ? '' : 's'}
                  {item.lastVisit ? ` · last ${dayLabel(item.lastVisit)}` : ''}
                </p>
              </div>
              <Chip tone={item.origin === 'pinned' ? 'accent' : 'neutral'} title={item.origin === 'pinned' ? 'Pinned on this device' : 'Derived from a real booking'}>
                {item.origin === 'pinned' ? 'pinned' : 'booked'}
              </Chip>
            </div>
            <div className="flex items-center gap-2 mt-2.5">
              {onOpenSalon && item.salonId ? (
                <button type="button" onClick={() => onOpenSalon(item.salonId)} className="text-xs font-bold text-slate-700">
                  Open salon →
                </button>
              ) : null}
              {item.origin === 'pinned' ? (
                <Button variant="ghost" busy={busy === item.id} onClick={() => unpin(item)} className="ml-auto !px-2 !py-1 text-xs" accentHex={accentHex}>
                  Remove
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {reviews.length ? (
        <div className={`${CARD_CLASS} p-4`}>
          <p className="text-sm font-bold text-slate-900 mb-2">Your reviews</p>
          <p className={`text-xs ${MUTED_CLASS} mb-2`}>Stored on the booking row's metadata — the same text the salon sees in their dashboard.</p>
          <ul className="divide-y divide-slate-100">
            {reviews.slice(0, 6).map((review: any) => (
              <li key={review.id} className="py-2">
                <p className="text-xs text-slate-700">
                  <span className="font-bold">{review.salonName || 'Salon'}</span> · {review.rating}★
                  {review.visitedOn ? ` · ${dayLabel(review.visitedOn)}` : ''}
                </p>
                {review.text ? <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{review.text}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Data sources — the "is it really connected?" panel
// ---------------------------------------------------------------------------
const DataPanel: React.FC = () => {
  const state = useCustomerQuery(() => customerConnectionReport(), []);
  const badges = useMemo(() => customerMappingBadges(), []);
  const report = state.data;
  const tables = report?.tables || {};
  const connected = report?.mode === 'live';

  const rows = CUSTOMER_SCHEMA_MAP.map((entry) => {
    const physical = entry.tables;
    const allExist = physical.length > 0 && physical.every((table) => tables[table]?.exists !== false);
    const rowsSeen = physical.reduce((sum: number, table: string) => {
      const count = tables[table]?.rows;
      return typeof count === 'number' ? sum + count : sum;
    }, 0);
    return { entry, allExist, rowsSeen };
  });
  const summary = useMemo(() => {
    const backed = rows.filter((row) => row.entry.kind === 'table').length;
    const derived = rows.filter((row) => row.entry.kind === 'derived').length;
    const jsonb = rows.filter((row) => row.entry.kind === 'jsonb').length;
    const device = rows.filter((row) => row.entry.kind === 'device').length;
    const missing = rows.filter((row) => !row.allExist).length;
    return { backed, derived, jsonb, device, missing, total: rows.length };
  }, [rows]);

  return (
    <div className="space-y-3">
      {state.loading ? <LoadingRows rows={3} label="Asking the API which tables answer…" /> : null}
      {state.failed ? <ErrorState message={state.error} onRetry={state.reload} hint="This panel reads /api/customer/connection only — nothing is written." /> : null}

      {!state.loading && !state.failed ? (
        <>
          <div className={`${CARD_CLASS} p-4`}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <p className="text-sm font-extrabold text-slate-900">
                {connected ? 'Connected to Supabase' : 'Not connected to Supabase'}
              </p>
              {!connected ? <WifiOff className="w-4 h-4 text-amber-600" /> : <Database className="w-4 h-4 text-emerald-600" />}
            </div>
            <p className={`text-xs ${MUTED_CLASS}`}>
              {connected
                ? 'Every customer screen below reads through the app API with your signed-in token; the server uses the service-role client and scopes rows to your account id.'
                : 'This deployment has no Supabase credentials. The customer app answers with an explicit "not connected" state instead of sample data.'}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
              <MiniStat label="Entities" value={String(summary.total)} />
              <MiniStat label="Direct tables" value={String(summary.backed)} />
              <MiniStat label="Derived / jsonb" value={`${summary.derived + summary.jsonb}`} />
              <MiniStat label="Device-only" value={String(summary.device)} />
            </div>
          </div>

          <div className={`${CARD_CLASS} overflow-hidden`}>
            <p className="text-sm font-bold text-slate-900 px-4 pt-4 pb-2">The 18 customer entities</p>
            <div className="divide-y divide-slate-100">
              {rows.map(({ entry, allExist, rowsSeen }) => (
                <div key={entry.logical} className="px-4 py-2.5 flex items-start gap-3">
                  <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${allExist ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{entityLabel(entry.logical)}</p>
                    <p className="text-[11px] text-slate-500 break-all">
                      <span className="font-mono">{badges[entry.logical] || entry.kind}</span>
                      {entry.kind === 'table' && typeof tables[entry.tables[0]]?.rows === 'number' ? ` · ${tables[entry.tables[0]].rows} rows` : ''}
                      {entry.kind !== 'table' && rowsSeen ? ` · from ${rowsSeen} rows` : ''}
                    </p>
                    {mappingNote(entry.logical) ? <p className="text-[11px] text-slate-400 mt-0.5">{mappingNote(entry.logical)}</p> : null}
                  </div>
                  <Chip tone={entry.kind === 'table' ? 'success' : entry.kind === 'device' ? 'warn' : 'neutral'}>{entry.kind}</Chip>
                </div>
              ))}
            </div>
          </div>

          <div className={`${CARD_CLASS} p-4`}>
            <p className="text-sm font-bold text-slate-900 mb-1 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-600" />
              What the schema cannot store ({CUSTOMER_SCHEMA_GAPS.length})
            </p>
            <ul className="space-y-1.5 mt-2">
              {CUSTOMER_SCHEMA_GAPS.map((gap) => (
                <li key={gap.logical} className="text-xs text-slate-600 flex gap-2">
                  <span className="text-slate-400 shrink-0">—</span>
                  <span>
                    <span className="font-semibold text-slate-800">{entityLabel(gap.logical)}:</span> {gap.why}.{' '}
                    <span className="text-slate-400">If you ever want it stored properly: {gap.needs}.</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className={`${CARD_CLASS} p-4`}>
            <p className="text-sm font-bold text-slate-900 mb-2 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-slate-400" /> Row-level security as the API sees it
            </p>
            <ul className="space-y-1.5">
              {Object.entries(RLS_REALITY)
                .filter(([, value]) => Array.isArray(value))
                .map(([scope, tables]) => (
                  <li key={scope} className="text-xs text-slate-600 flex items-start gap-2">
                    <Chip tone={scope === 'customerScoped' ? 'danger' : scope === 'recipientScoped' ? 'warn' : 'neutral'}>{scope}</Chip>
                    <span className="font-mono text-[11px] break-all">{(tables as string[]).join(', ') || '— none —'}</span>
                  </li>
                ))}
            </ul>
            <p className="text-[11px] text-slate-400 mt-2">{RLS_REALITY.note}</p>
            <p className={`text-xs mt-2 ${MUTED_CLASS}`}>
              Policies are owner-scoped, so a customer's browser reading Supabase directly would get zero rows. That is why the customer app calls the API and
              the API scopes by your account id — no policy was changed to build this.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={state.reload} className="text-xs font-bold text-slate-500 inline-flex items-center gap-1">
              <RefreshCw className="w-3.5 h-3.5" /> Re-probe tables
            </button>
            <span className="text-[11px] text-slate-400 inline-flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> head-count only, nothing written
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
};

/** `booking_services` → `Booking services`: the schema's own names, prettified. */
function entityLabel(logical: string): string {
  return String(logical || '')
    .split('_')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

const MiniStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-2xl bg-slate-50 px-3 py-2">
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
    <p className="text-lg font-extrabold text-slate-900">{value}</p>
  </div>
);
