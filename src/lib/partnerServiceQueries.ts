import { useCallback, useEffect, useRef, useState } from 'react';
import { isServiceFailure, type GrowthPartnerResult, type GrowthPartnerServiceError } from '../services/growthPartner';
import type { PartnerAreaFailure } from './partnerAreaFailure';

// ============================================================================
// Hooks for the Growth Partner service facade.
//
// The service returns `{ ok: true, data } | { ok: false, error }` and never
// rejects. These hooks consume that shape directly (no try/catch, no reading a
// message out of a thrown value) and expose the SAME state names the older
// throw-based hooks expose — `data`, `loading`, `refreshing`, `error`,
// `errorCode`, `reload`, `patch` — plus `failure`: the classified cause, which
// a screen hands to `PartnerAreaFailurePanel` so it can say who has to act.
//
// Kept separate from `partnerPortalQueries.ts` because that module is the
// throw-based path used by anything not yet on the service facade; both can
// coexist while sections migrate.
// ============================================================================

export interface PartnerServiceQueryState<T> {
  data: T | null;
  /** True until the FIRST answer for the current inputs (skeleton territory). */
  loading: boolean;
  /** True when a reload runs while previous data is still shown. */
  refreshing: boolean;
  /** Safe, user-facing copy for the failure (null while healthy). */
  error: string | null;
  /** Classified cause behind `error` — drives the failure panel. */
  failure: PartnerAreaFailure | null;
  /** PostgREST/Postgres code when the answer carried one. */
  errorCode: string | null;
  reload: () => void;
  /** Local update after a mutation (e.g. marking a row read). */
  patch: (update: (current: T | null) => T | null) => void;
}

/**
 * Run a service call on mount and whenever `deps` change.
 *
 * A failed REFRESH keeps the last good data on screen (and reports the error),
 * exactly like the throw-based hook: a partner who already sees their balance
 * must not have it replaced by an error card because one refresh failed.
 * A failed FIRST load has nothing to keep, so it shows the error.
 */
export function usePartnerServiceQuery<T>(
  load: () => Promise<GrowthPartnerResult<T>>,
  deps: unknown[] = []
): PartnerServiceQueryState<T> {
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    refreshing: boolean;
    error: string | null;
    failure: PartnerAreaFailure | null;
    errorCode: string | null;
  }>({ data: null, loading: true, refreshing: false, error: null, failure: null, errorCode: null });
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({
      data: previous.data,
      loading: previous.data === null,
      refreshing: previous.data !== null,
      error: null,
      failure: null,
      errorCode: null,
    }));
    (async () => {
      // The service resolves with a result object; a rejection could only come
      // from a bug in the loader itself, so it is treated as one more failure
      // rather than being allowed to escape into the render tree.
      const result: GrowthPartnerResult<T> = await (async () => {
        try {
          return await loadRef.current();
        } catch (thrown) {
          const { GrowthPartnerServiceError } = await import('../services/growthPartner');
          return { ok: false as const, error: GrowthPartnerServiceError.from(thrown) };
        }
      })();
      if (cancelled) return;
      if (isServiceFailure(result)) {
        const { error } = result;
        setState((previous) => ({
          ...previous,
          loading: false,
          refreshing: false,
          error: error.message,
          failure: error.failure ?? null,
          errorCode: error.code ?? null,
        }));
        return;
      }
      setState({ data: result.data, loading: false, refreshing: false, error: null, failure: null, errorCode: null });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  const patch = useCallback((update: (current: T | null) => T | null) => {
    setState((previous) => ({ ...previous, data: update(previous.data) }));
  }, []);

  return { ...state, reload, patch };
}

export interface PartnerServiceActionState<Result> {
  /** Run the action. Resolves with the data, or null when it failed. */
  run: (...args: any[]) => Promise<Result | null>;
  pending: boolean;
  /** Safe copy for the refusal (a validation message stays readable). */
  error: string | null;
  /** Classified cause behind `error`. */
  failure: PartnerAreaFailure | null;
  result: Result | null;
  reset: () => void;
}

/**
 * One-shot mutation with pending + inline-error handling, over the service
 * result shape. Deliberately does not auto-dismiss: a refused payout request
 * must stay readable until the partner edits the form.
 */
export function usePartnerServiceAction<Result = unknown>(
  action: (...args: any[]) => Promise<GrowthPartnerResult<Result>>
): PartnerServiceActionState<Result> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<PartnerAreaFailure | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const actionRef = useRef(action);
  actionRef.current = action;

  const run = useCallback(async (...args: any[]) => {
    setPending(true);
    setError(null);
    setFailure(null);
    const outcome = await actionRef.current(...args);
    if (isServiceFailure(outcome)) {
      const { error: serviceError } = outcome;
      if (mounted.current) {
        setError(serviceError.message);
        setFailure(serviceError.failure ?? null);
        setPending(false);
      }
      return null;
    }
    if (mounted.current) {
      setResult(outcome.data);
      setPending(false);
    }
    return outcome.data;
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setFailure(null);
  }, []);

  return { run, pending, error, failure, result, reset };
}
