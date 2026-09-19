import { useCallback, useEffect, useRef, useState } from 'react';
import {
  classifySecurityOverviewFailure,
  fetchPartnerSecurityOverviewWithRetry,
  type PartnerSecurityOverview,
  type PartnerSecurityOverviewError,
  type SecurityOverviewClient,
} from './partnerAccountSecurity';

// ============================================================================
// The /partner/account-settings security-overview read as React state.
//
// Replaces the page's hand-rolled `useEffect` + `reloadKey` combination, which
// had three defects that produced the reported bug:
//
//   1. the failure replaced the whole route, so one dead RPC hid Change Email,
//      Change Password, 2FA, Sessions and the Danger Zone;
//   2. a refresh that failed AFTER a successful load set an error nobody ever
//      rendered (the render only showed the error when there was no data), so
//      the page silently kept showing stale rows;
//   3. `resolvedClient` was an effect dependency, so any caller passing an
//      inline client object re-fetched on every render; `cancelled` also
//      skipped `setLoading(false)`, which could strand the page on "Loading…".
//
// Contract:
//   • `loading` is true ONLY for the first load (nothing to show yet) — later
//     refetches leave the last good data on screen;
//   • `error` is surfaced whether or not data exists (never silently stale);
//   • `retry()` always starts a fresh attempt and counts it;
//   • only the newest request may write state (request-id guard + unmount guard).
// ============================================================================

export interface PartnerSecurityOverviewState {
  /** The last successfully loaded overview, or null when it has never loaded. */
  overview: PartnerSecurityOverview | null;
  /** Typed failure of the latest attempt; null while the last read succeeded. */
  error: PartnerSecurityOverviewError | null;
  /** First load only — the page has nothing to render yet. */
  loading: boolean;
  /** Any fetch in flight (first load, manual retry, or a post-action refresh). */
  refreshing: boolean;
  /** How many times the read has been (re)attempted in this mount. */
  attempt: number;
  /** Re-fetch now (manual Retry, and the callback the sections call on change). */
  retry: () => void;
  /** Alias of `retry`, named for the sections that refresh after a write. */
  refresh: () => void;
}

export interface UsePartnerSecurityOverviewOptions {
  /** Total attempts per read, including the first (default 3). */
  attempts?: number;
  /** Delay before attempts 2..n (default [400, 1200] ms). */
  retryDelays?: number[];
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; error: PartnerSecurityOverviewError }) => void;
}

export function usePartnerSecurityOverview(
  client: SecurityOverviewClient,
  options: UsePartnerSecurityOverviewOptions = {},
): PartnerSecurityOverviewState {
  // The latest client is read through a ref, never as an effect dependency:
  // an injected object literal must not restart the fetch on every render.
  const clientRef = useRef(client);
  clientRef.current = client;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [overview, setOverview] = useState<PartnerSecurityOverview | null>(null);
  const [error, setError] = useState<PartnerSecurityOverviewError | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(true);
  const [attempt, setAttempt] = useState(0);

  /** Newest request wins; every older promise's result is discarded. */
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    let cancelled = false;
    const current = () => !cancelled && id === requestId.current;
    const { attempts, retryDelays, sleep, onRetry } = optionsRef.current;

    setRefreshing(true);
    fetchPartnerSecurityOverviewWithRetry(clientRef.current, {
      attempts,
      retryDelays,
      sleep,
      onRetry,
      shouldAbort: () => !current(),
    })
      .then((data) => {
        if (!current()) return;
        setOverview(data);
        setError(null);
      })
      .catch((cause) => {
        if (!current()) return;
        setError(classifySecurityOverviewFailure(cause));
      })
      .finally(() => {
        // Always clear the spinners for the newest request — even on the
        // cancelled path of a superseded one, so no attempt can strand the
        // page on "Loading…".
        if (!current()) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setRefreshing(true);
    // A new key remounts nothing; it starts a new, newest-wins request.
    setAttempt((value) => value + 1);
  }, []);

  return { overview, error, loading, refreshing, attempt, retry, refresh: retry };
}
