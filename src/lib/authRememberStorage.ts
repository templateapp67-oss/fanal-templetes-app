// ============================================================================
// Remember-me aware auth storage (Growth Partner portal, PART 2).
//
// supabase-js persists the session through whatever `storage` it was given at
// client creation (browser localStorage by default). This module supplies a
// browser-only storage for the shared client that writes the session to the
// store chosen at sign-in time:
//
//   • "Remember me" CHECKED (the default): localStorage — the session survives
//     browser restarts, exactly the app's previous behavior.
//   • "Remember me" UNCHECKED: sessionStorage — the session dies with the
//     browser session, and the remembered localStorage copy of that key is
//     dropped so a stale session can never silently revive after a restart.
//
// The choice travels in a sessionStorage marker written by the login flow
// right BEFORE signInWithPassword (so the session is saved to the right store)
// and reverted when sign-in fails (a failed attempt must never destroy an
// existing remembered session). Reads always prefer sessionStorage, then
// localStorage.
//
// SECURITY: nothing here is authorization. The marker never grants or denies
// anything — it only decides WHICH browser store holds the Supabase session.
// Partner access itself is decided solely by the backend (the caller's own
// growth_partners row through RLS), never by this file.
// ============================================================================

/** Which browser store holds the session. */
export type AuthSessionLifetime = 'persistent' | 'session';

/** sessionStorage marker carrying the choice made at sign-in. */
export const AUTH_SESSION_LIFETIME_KEY = 'auth.session-lifetime';

/** The subset of Web Storage supabase-js needs (and tests can fake). */
export interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** Enumeration, used only to find remembered session tokens. */
  length?: number;
  key?(index: number): string | null;
}

/** Injectable store pair; defaults to the browser's own local/sessionStorage. */
export interface AuthStoragePair {
  local?: WebStorageLike | null;
  session?: WebStorageLike | null;
}

/** Supabase session-token keys as supabase-js names them: `sb-<ref>-auth-token`. */
const REMEMBERED_TOKEN_RE = /^sb-.+-auth-token$/;

function defaultPair(): AuthStoragePair {
  if (typeof window === 'undefined') return { local: null, session: null };
  try {
    return { local: window.localStorage ?? null, session: window.sessionStorage ?? null };
  } catch {
    // Some embedded contexts throw on storage access — behave as if absent.
    return { local: null, session: null };
  }
}

/**
 * Record the sign-in choice BEFORE the credentials are submitted, so the
 * session that signInWithPassword persists lands in the right store.
 */
export function setAuthSessionLifetime(remember: boolean, pair: AuthStoragePair = defaultPair()): void {
  pair.session?.setItem(AUTH_SESSION_LIFETIME_KEY, remember ? 'persistent' : 'session');
}

/**
 * Revert the choice (failed sign-in / logout): the next session write behaves
 * like the app's default (persistent) again, and an existing remembered
 * session is left untouched.
 */
export function clearAuthSessionLifetime(pair: AuthStoragePair = defaultPair()): void {
  pair.session?.removeItem(AUTH_SESSION_LIFETIME_KEY);
}

/** The currently recorded choice (absent marker = the default 'persistent'). */
export function readAuthSessionLifetime(pair: AuthStoragePair = defaultPair()): AuthSessionLifetime {
  try {
    return pair.session?.getItem(AUTH_SESSION_LIFETIME_KEY) === 'session' ? 'session' : 'persistent';
  } catch {
    return 'persistent';
  }
}

/**
 * Drop every remembered (localStorage) Supabase session token. Returns how
 * many were removed. Called after a successful "do not remember" sign-in so no
 * older remembered session can revive on the next browser start.
 */
export function purgeRememberedAuthTokens(pair: AuthStoragePair = defaultPair()): number {
  const local = pair.local;
  if (!local || typeof local.key !== 'function' || typeof local.length !== 'number') return 0;
  const doomed: string[] = [];
  for (let index = 0; index < local.length; index += 1) {
    const key = local.key(index);
    if (key && REMEMBERED_TOKEN_RE.test(key)) doomed.push(key);
  }
  for (const key of doomed) {
    try {
      local.removeItem(key);
    } catch {
      // Best effort — a locked store must not break sign-in.
    }
  }
  return doomed.length;
}

/**
 * The storage handed to `createClient` (browser only; null elsewhere so the
 * server and SSR keep supabase-js defaults). Reads prefer the session-only
 * store, then the remembered one; writes follow the marker above.
 */
export function createRememberAwareAuthStorage(pair: AuthStoragePair = defaultPair()): WebStorageLike | null {
  const { local, session } = pair;
  if (!local || !session) return null;
  return {
    getItem(key: string): string | null {
      return session.getItem(key) ?? local.getItem(key);
    },
    setItem(key: string, value: string): void {
      if (readAuthSessionLifetime(pair) === 'session') {
        // The remembered copy of this key must not silently revive later.
        try {
          local.removeItem(key);
        } catch {
          // ignore
        }
        session.setItem(key, value);
        return;
      }
      local.setItem(key, value);
    },
    removeItem(key: string): void {
      try {
        local.removeItem(key);
      } catch {
        // ignore
      }
      try {
        session.removeItem(key);
      } catch {
        // ignore
      }
    },
  };
}
