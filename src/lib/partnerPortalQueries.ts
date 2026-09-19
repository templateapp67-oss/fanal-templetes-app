import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================================
// Data hooks for the Growth Partner portal's operational sections.
//
// Each promoted page (Earnings, Withdrawals, Marketing Materials, Partner
// Levels, Leaderboards, Notifications, Support) reads through one hook so the
// four states a real dashboard has are impossible to skip: first load, refresh
// of existing data, failure with a retry, and "the backend answered zero rows".
// The hooks own no business rules — they wrap the calls in
// `partnerPortalOperations.ts` and keep last-good data on screen when a
// refresh fails, exactly like the partner dashboard sections do.
// ============================================================================

export interface PartnerQueryState<T> {
  data: T | null;
  /** True until the FIRST response for the current inputs (skeleton territory). */
  loading: boolean;
  /** True when a reload runs while previous data is still shown. */
  refreshing: boolean;
  error: string | null;
  /** Error code from the operation (schema_not_applied, partner_only, …). */
  errorCode: string | null;
  /** Re-run the current query (keeps the previous data visible). */
  reload: () => void;
  /** Apply a local update after a mutation (e.g. marking a row read). */
  patch: (update: (current: T | null) => T | null) => void;
}

/**
 * The message a section should print for a failure.
 *
 * `usePartnerQuery`/`usePartnerAction` already store a formatted STRING, and a
 * page may hand that string straight to an error card — a plain string has no
 * `.message`, so reading only the object shape used to turn every real refusal
 * ("Minimum withdrawal is ₹500.") into the generic fallback. Both shapes are
 * honoured; only a genuinely empty one falls back.
 */
export function partnerQueryErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error.trim() || GENERIC_SECTION_ERROR;
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const message = (error as any)?.message;
  if (typeof message === 'string' && message.trim()) return message.trim();
  return GENERIC_SECTION_ERROR;
}

const GENERIC_SECTION_ERROR = 'This section could not load. Please try again.';

export function partnerQueryErrorCode(error: unknown): string | null {
  const code = (error as any)?.code;
  return typeof code === 'string' && code ? code : null;
}

/**
 * Run `load` on mount and whenever `deps` change. `load` is read through a ref
 * so pages can pass an inline arrow without re-fetching on every render — the
 * `deps` array is the single, explicit trigger.
 */
export function usePartnerQuery<T>(load: () => Promise<T>, deps: unknown[] = []): PartnerQueryState<T> {
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    refreshing: boolean;
    error: string | null;
    errorCode: string | null;
  }>({ data: null, loading: true, refreshing: false, error: null, errorCode: null });
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
      errorCode: null,
    }));
    (async () => {
      try {
        const data = await loadRef.current();
        if (!cancelled) setState({ data, loading: false, refreshing: false, error: null, errorCode: null });
      } catch (error) {
        if (cancelled) return;
        // A failed refresh keeps whatever the partner could already see.
        setState((previous) => ({
          ...previous,
          loading: false,
          refreshing: false,
          error: partnerQueryErrorMessage(error),
          errorCode: partnerQueryErrorCode(error),
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  const patch = useCallback((update: (current: any) => any) => {
    setState((previous) => ({ ...previous, data: update(previous.data) }));
  }, []);

  return { ...state, reload, patch };
}

export interface PartnerActionState<Result> {
  /** Run the action. Resolves with the result, or null when it failed. */
  run: (...args: any[]) => Promise<Result | null>;
  pending: boolean;
  error: string | null;
  result: Result | null;
  /** Clear a stale error before the user retries (e.g. on input change). */
  reset: () => void;
}

/**
 * One-shot mutation with pending + inline-error handling. Deliberately does not
 * auto-dismiss: a refused payout request should stay readable until the partner
 * edits the form, not vanish on the next render.
 */
export function usePartnerAction<Result = unknown>(
  action: (...args: any[]) => Promise<Result>
): PartnerActionState<Result> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    try {
      const value = await actionRef.current(...args);
      if (mounted.current) {
        setResult(value);
        setPending(false);
      }
      return value;
    } catch (err) {
      if (mounted.current) {
        setError(partnerQueryErrorMessage(err));
        setPending(false);
      }
      return null;
    }
  }, []);

  const reset = useCallback(() => setError(null), []);

  return { run, pending, error, result, reset };
}
