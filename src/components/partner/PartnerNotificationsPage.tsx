import React, { useEffect, useMemo, useState } from 'react';
import { Bell, BellRing, Check, CheckCheck, RefreshCw } from 'lucide-react';
import {
  getPartnerNotificationPreferences,
  getPartnerNotifications,
  markPartnerNotificationsRead,
  updatePartnerNotificationPreferences,
} from '../../lib/partnerPortalOperations';
import { usePartnerAction, usePartnerQuery } from '../../lib/partnerPortalQueries';
import { formatPartnerDateTime } from '../../lib/partnerPresentation';
import { PartnerToast } from '../PartnerToast';
import {
  PartnerInlineNotice,
  PartnerModuleButton,
  PartnerModuleCard,
  PartnerModuleHeader,
  PartnerFilterChip,
  PartnerSectionEmpty,
  PartnerSectionError,
  PartnerSectionLoading,
} from './PartnerModuleKit';

// ============================================================================
// NOTIFICATIONS — /partner/notifications
//
// Read state is REAL here: `partner_notifications` rows carry `is_read` +
// `read_at`, `mark_my_partner_notifications_read` only ever touches the
// caller's own unread rows, and the delivery toggles read/write the partner's
// own `partner_notification_preferences` row (defaults true/true when nothing
// was saved yet — the same defaults the table declares). No invented unread
// counters, no synthetic "3 new" badge.
// ============================================================================

const NOTIFICATION_TYPES = [
  { value: 'all', label: 'All' },
  { value: 'payout', label: 'Payouts' },
  { value: 'referral', label: 'Referrals' },
  { value: 'reward', label: 'Rewards' },
  { value: 'system', label: 'System' },
];

const TYPE_LABELS: Record<string, string> = {
  payout: 'Payout',
  referral: 'Referral',
  reward: 'Reward',
  system: 'System',
};

export const PartnerNotificationsPage: React.FC<{ accentHex?: string }> = ({ accentHex }) => {
  const [type, setType] = useState('all');
  const [notice, setNotice] = useState({ id: 0, message: '' });
  const [prefs, setPrefs] = useState<{ email_enabled: boolean; in_app_enabled: boolean } | null>(null);

  const feed = usePartnerQuery(() => getPartnerNotifications(type, { limit: 50 }), [type]);
  const preferences = usePartnerQuery(() => getPartnerNotificationPreferences(), []);
  const markAll = usePartnerAction(() => markPartnerNotificationsRead());
  const markOne = usePartnerAction((id: string) => markPartnerNotificationsRead([id]));
  const savePrefs = usePartnerAction((next: { email_enabled: boolean; in_app_enabled: boolean }) =>
    updatePartnerNotificationPreferences(next)
  );

  // Seed the toggles from the stored row, and only from the stored row: local
  // edits win until the partner saves or the row is reloaded.
  useEffect(() => {
    if (preferences.data) setPrefs({ email_enabled: preferences.data.email_enabled, in_app_enabled: preferences.data.in_app_enabled });
  }, [preferences.data]);

  const items = feed.data?.items ?? [];
  const unread = feed.data?.unread_count ?? 0;
  const current = prefs ?? { email_enabled: true, in_app_enabled: true };
  const dirty = useMemo(() => {
    if (!prefs || !preferences.data) return false;
    return prefs.email_enabled !== preferences.data.email_enabled || prefs.in_app_enabled !== preferences.data.in_app_enabled;
  }, [prefs, preferences.data]);

  const markAllRead = async () => {
    const count = await markAll.run();
    if (count === null) return;
    feed.patch((currentData) =>
      currentData
        ? { ...currentData, unread_count: 0, items: currentData.items.map((item) => ({ ...item, is_read: true })) }
        : currentData
    );
    setNotice((state) => ({ id: state.id + 1, message: count ? `Marked ${count} notification${count === 1 ? '' : 's'} as read.` : 'Nothing new to mark — your feed is already read.' }));
  };

  const markRead = async (id: string) => {
    const count = await markOne.run(id);
    if (count === null) return;
    feed.patch((currentData) =>
      currentData
        ? {
            ...currentData,
            unread_count: Math.max(currentData.unread_count - 1, 0),
            items: currentData.items.map((item) => (item.id === id ? { ...item, is_read: true } : item)),
          }
        : currentData
    );
  };

  const save = async () => {
    const saved = await savePrefs.run(current);
    if (!saved) return;
    setNotice((state) => ({ id: state.id + 1, message: 'Notification settings saved.' }));
    preferences.reload();
  };

  if (feed.loading && !feed.data) return <PartnerSectionLoading label="Loading your notifications…" kind="table" module="notifications" />;
  if (feed.error && !feed.data) {
    return <PartnerSectionError error={feed.error} onRetry={feed.reload} title="Your notifications could not load" module="notifications" />;
  }

  return (
    <div data-partner-module="notifications" className="space-y-5">
      <PartnerToast message={notice.message} noticeId={notice.id} />

      <PartnerModuleHeader
        eyebrow="Activity inbox"
        title="Notifications"
        description="Payout decisions, referral milestones and reward updates for your own partner account."
        icon={Bell}
        actions={
          <>
            <PartnerModuleButton variant="secondary" onClick={feed.reload} disabled={feed.refreshing}>
              <RefreshCw className={`h-4 w-4 ${feed.refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </PartnerModuleButton>
            <PartnerModuleButton
              variant="accent"
              accentHex={accentHex}
              onClick={markAllRead}
              disabled={unread === 0 || markAll.pending}
              data-partner-action="mark-all-read"
            >
              <CheckCheck className="h-4 w-4" />
              {markAll.pending ? 'Marking…' : 'Mark all read'}
            </PartnerModuleButton>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-200">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5">
            <BellRing className="h-3.5 w-3.5 text-pink-200" />
            {unread} unread
          </span>
          <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1.5">{items.length} in view</span>
        </div>
      </PartnerModuleHeader>

      {feed.error ? <PartnerInlineNotice message={`${feed.error} — showing the last notifications we loaded.`} /> : null}
      {markAll.error ? <PartnerInlineNotice tone="error" message={markAll.error} /> : null}
      {markOne.error ? <PartnerInlineNotice tone="error" message={markOne.error} /> : null}

      <PartnerModuleCard
        id="feed"
        title="Your notifications"
        description={type === 'all' ? 'Newest first.' : `Filtered to ${TYPE_LABELS[type]?.toLowerCase() || type} notifications.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {NOTIFICATION_TYPES.map((option) => (
              <PartnerFilterChip
                key={option.value}
                label={option.label}
                active={type === option.value}
                accentHex={accentHex}
                onSelect={() => setType(option.value)}
              />
            ))}
          </div>
        }
        padded={false}
      >
        {items.length ? (
          <ul className="divide-y divide-slate-100">
            {items.map((item) => (
              <li key={item.id} data-partner-notification={item.is_read ? 'read' : 'unread'} className="flex items-start gap-4 p-5">
                <span
                  aria-hidden="true"
                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.is_read ? 'bg-slate-200' : ''}`}
                  style={item.is_read ? undefined : { backgroundColor: accentHex }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-black text-slate-950">{item.title}</p>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-500">
                      {TYPE_LABELS[item.notification_type] || item.notification_type}
                    </span>
                    {!item.is_read ? (
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white" style={{ backgroundColor: accentHex }}>
                        New
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{item.body}</p>
                  <p className="mt-1.5 text-xs text-slate-400">{formatPartnerDateTime(item.created_at)}</p>
                </div>
                {!item.is_read ? (
                  <button
                    type="button"
                    onClick={() => void markRead(item.id)}
                    disabled={markOne.pending}
                    className="inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Mark read
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <PartnerSectionEmpty
            icon={Bell}
            title={type === 'all' ? 'Nothing in your inbox yet' : `No ${TYPE_LABELS[type]?.toLowerCase() || type} notifications yet`}
            body="This inbox fills up on its own: payout reviews, referral milestones and reward approvals write a row here. The header dropdown shows the same activity in short form."
            action={
              type !== 'all' ? (
                <PartnerModuleButton variant="secondary" onClick={() => setType('all')}>
                  Show everything
                </PartnerModuleButton>
              ) : null
            }
          />
        )}
      </PartnerModuleCard>

      <PartnerModuleCard
        id="preferences"
        title="Delivery settings"
        description="Where Nexora is allowed to reach you about your partner account."
        actions={
          <PartnerModuleButton
            variant="accent"
            accentHex={accentHex}
            onClick={save}
            disabled={!dirty || savePrefs.pending || preferences.loading}
            data-partner-action="save-notification-preferences"
          >
            {savePrefs.pending ? 'Saving…' : dirty ? 'Save settings' : 'Saved'}
          </PartnerModuleButton>
        }
      >
        {preferences.loading && !preferences.data ? (
          <p className="text-sm text-slate-500">Loading your saved settings…</p>
        ) : preferences.error && !preferences.data ? (
          <PartnerInlineNotice tone="error" message={`${preferences.error} Toggles below cannot be saved until this loads.`} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  key: 'email_enabled' as const,
                  title: 'Email',
                  body: 'Payout approvals, rejections and tier changes land in your inbox.',
                },
                {
                  key: 'in_app_enabled' as const,
                  title: 'In-app + portal',
                  body: 'The inbox above and the header bell. Turning this off does not hide past notifications.',
                },
              ].map((option) => (
                <label
                  key={option.key}
                  className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 p-4 transition-colors hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={current[option.key]}
                    onChange={(event) => setPrefs({ ...current, [option.key]: event.target.checked })}
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-current"
                    style={{ color: accentHex }}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-black text-slate-950">{option.title}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{option.body}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-400">
              {preferences.data?.updated_at
                ? `Last changed ${formatPartnerDateTime(preferences.data.updated_at)}.`
                : 'No change has been saved yet — the defaults your account was created with are shown.'}
            </p>
            {savePrefs.error ? <div className="mt-3"><PartnerInlineNotice tone="error" message={savePrefs.error} /></div> : null}
          </>
        )}
      </PartnerModuleCard>
    </div>
  );
};

export default PartnerNotificationsPage;
