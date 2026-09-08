// ============================================================================
// Real-time customer state.
//
// WHAT THIS IS ACTUALLY SOLVING
// -----------------------------
// A customer staring at a slot grid must not be able to pick a time another
// customer booked five seconds ago, and the notifications badge must move
// without a reload. The obvious tool is Supabase Realtime — but Realtime
// enforces RLS on the subscriber, and this schema has no customer SELECT policy
// on `bookings` (every policy is `owner_id = auth.uid()`). A customer channel on
// `bookings` therefore receives nothing at all, forever, silently.
//
// So this module uses the one table whose existing policy already admits the
// customer — `in_app_notifications`, selectable when
// `user_email = auth.jwt() ->> 'email'` — as the real-time **signal**, and
// re-reads the private tables through the trusted API when a signal arrives.
// The result is the same user-visible behaviour with zero policy changes:
//
//   salon confirms / cancels / proposes a reschedule
//     → server writes a notification row
//     → Realtime pushes it to this customer (RLS allows it)
//     → we refetch bookings + the slot grid for the affected salon/date
//
// Everything degrades to adaptive polling when there is no session, the
// realtime socket drops, or the app runs against the mock client, and a
// mutation in this tab invalidates immediately (no waiting for the next tick).
// ============================================================================

import { supabase, isMockSupabase } from '../supabaseClient';
import { onCustomerDataInvalidate } from './api';

export type RealtimeChannel = 'bookings' | 'notifications' | 'slots' | 'rewards';

export interface RealtimeOptions {
  /** Poll fallback interval while the tab is visible. */
  pollMs?: number;
  /** Poll interval while the tab is hidden (slower, still converges). */
  hiddenPollMs?: number;
  /** Only react to signals for this salon (booking screens scope their slots). */
  salonId?: string;
  /** Called on mount and on every refresh trigger. */
  onChange: (reason: string) => void | Promise<void>;
}

export interface RealtimeHandle {
  close: () => void;
  /** Which transport is live right now — surfaced in the UI connection chip. */
  transport: () => 'supabase-realtime' | 'poll';
}

const NOTIFICATION_TABLE = 'in_app_notifications';

/**
 * Text patterns in a notification that mean "your booking data changed".
 * Matching on the message the server writes (see buildStatusNotifications in
 * server/bookingRoutes.ts) keeps this working without a payload column.
 */
const BOOKING_SIGNAL_RE = /booking|appointment|reschedul|cancel|confirm|slot|review/i;
const REWARD_SIGNAL_RE = /reward|point|redeem|coupon|offer|wallet/i;

export function notificationTouches(notification: any, channels: RealtimeChannel[]): boolean {
  const text = `${notification?.title ?? ''} ${notification?.message ?? ''}`;
  return channels.some((channel) => {
    if (channel === 'bookings' || channel === 'slots') return BOOKING_SIGNAL_RE.test(text);
    if (channel === 'rewards') return REWARD_SIGNAL_RE.test(text);
    return true;
  });
}

/**
 * Subscribe to live changes for one customer.
 *
 * `email` is the customer's own address (from the verified session); it is used
 * only as a Realtime filter, never as an identity claim for data reads — those
 * still come from the bearer token on the server.
 */
export function subscribeToCustomerUpdates(
  channels: RealtimeChannel[],
  email: string | null | undefined,
  options: RealtimeOptions
): RealtimeHandle {
  const pollMs = Math.max(5000, options.pollMs ?? 20000);
  const hiddenPollMs = Math.max(pollMs, options.hiddenPollMs ?? 60000);
  let transport: 'supabase-realtime' | 'poll' = 'poll';
  let closed = false;
  let timer: any = null;
  let channel: any = null;

  const fire = (reason: string) => {
    if (closed) return;
    void Promise.resolve(options.onChange(reason)).catch(() => {
      // A refresh that fails is invisible here on purpose: the screen's own
      // error state already reports it, and throwing inside a realtime
      // callback would kill the subscription.
    });
  };

  const interval = () => (isDocumentVisible() ? pollMs : hiddenPollMs);

  const schedule = () => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      // Re-checked at fire time rather than at scheduling time: the realtime
      // channel may confirm AFTER the first poll was armed, and a timer that
      // keeps firing next to a live socket doubles every refresh.
      if (!closed && transport !== 'supabase-realtime') {
        fire('poll');
        schedule();
      }
    }, interval());
  };

  const wantsRealtime = !isMockSupabase && !!email && channels.length > 0;

  if (wantsRealtime) {
    try {
      const client: any = supabase as any;
      channel = client
        .channel(`customer:${String(email).toLowerCase()}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: NOTIFICATION_TABLE,
            filter: `user_email=eq.${String(email)}`,
          },
          (payload: any) => {
            const next = payload?.new ?? payload?.old;
            if (!notificationTouches(next, channels)) return;
            fire('realtime');
          }
        )
        .subscribe((status: string) => {
          if (closed) return;
          if (status === 'SUBSCRIBED') {
            transport = 'supabase-realtime';
            if (timer) {
              clearTimeout(timer);
              timer = null;
            }
            return;
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            // RLS may refuse the subscription (or the socket may be blocked by
            // a proxy). Fall back to polling instead of going quiet — a
            // silently dead realtime channel is exactly how a customer ends up
            // booking a slot that was taken a minute ago.
            transport = 'poll';
            fire('realtime-fallback');
            schedule();
          }
        });
    } catch {
      transport = 'poll';
    }
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    const onVisible = () => {
      // Coming back to the tab is when a stale screen is noticed. Refresh, then
      // re-time the poller for the new visibility state.
      if (isDocumentVisible()) fire('tab-focus');
      schedule();
    };
    document.addEventListener('visibilitychange', onVisible);
  }

  const release = onCustomerDataInvalidate((reason) => {
    // A local write (booking created, favourite toggled, offer redeemed) must
    // not wait for the next tick.
    fire(reason || 'local-write');
    schedule();
  });

  // Always arm the poller: it is the safety net while the socket is still
  // connecting, and it stops itself once `SUBSCRIBED` lands.
  schedule();

  return {
    transport: () => transport,
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      release();
      if (channel) {
        try {
          void (supabase as any).removeChannel(channel);
        } catch {
          // ignore — the socket is going away with the screen anyway
        }
      }
    },
  };
}

function isDocumentVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
}

/**
 * Signature of a slot grid, used to decide whether a poll changed anything.
 * Only re-rendering on a real change is what makes a 5-second poll cheap.
 */
export function slotsSignature(input: {
  salonId: string;
  date: string;
  slots: { time: string; staffId: string; available: boolean }[];
}): string {
  const parts = (input.slots || [])
    .map((slot) => `${slot.time}:${slot.staffId}:${slot.available ? '1' : '0'}`)
    .sort();
  return `${input.salonId}|${input.date}|${parts.join(',')}`;
}

/** Debounce so a burst of signals (booking + notification + reward rows) is one refresh. */
export function createCoalescedRefresh(
  run: (reason: string) => void | Promise<void>,
  waitMs = 400
): (reason: string) => void {
  let timer: any = null;
  let pendingReason = '';
  return (reason: string) => {
    pendingReason = pendingReason ? `${pendingReason}+${reason}` : reason;
    if (timer) return;
    timer = setTimeout(() => {
      const localReason = pendingReason;
      pendingReason = '';
      timer = null;
      void Promise.resolve(run(localReason)).catch(() => undefined);
    }, waitMs);
  };
}
