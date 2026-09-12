import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Read env vars safely in both Vite (client) and Node.js (server).
// The browser build only ever gets the *anon* key; the service-role key is
// read exclusively in the Node server/Edge Functions and is NEVER bundled.
// ---------------------------------------------------------------------------
const getEnvVar = (key: string, viteKey?: string): string => {
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key] || '';
  }
  if (viteKey && typeof process !== 'undefined' && process.env && process.env[viteKey]) {
    return process.env[viteKey] || '';
  }
  try {
    const metaEnv = (import.meta as any)?.env;
    if (metaEnv) {
      return (viteKey && metaEnv[viteKey]) || metaEnv[key] || '';
    }
  } catch {
    // ignore
  }
  return '';
};

/** Strip quotes/whitespace accidentally copied from a .env file or dashboard. */
const clean = (value: string): string => value.trim().replace(/^['"]/, '').replace(/['"]$/, '').trim();

const isPlaceholder = (value: string): boolean =>
  !value ||
  value.includes('placeholder') ||
  value.includes('PLACEHOLDER') ||
  /^(your_|my_|xxx|<)/i.test(value) ||
  value === 'YOUR_SUPABASE_ANON_KEY' ||
  value === 'YOUR_SUPABASE_SERVICE_ROLE_KEY';

/**
 * Local development gateway (server/localSupabase.ts): with LOCAL_SUPABASE=true
 * this app serves its own Supabase-compatible /auth/v1 + /rest/v1 API from
 * PGlite. The browser must call the origin that served the page — inside a
 * hosted preview `127.0.0.1` would be the user's own machine — while Node talks
 * to itself. Ignored whenever a real SUPABASE_URL is configured.
 */
// Static `import.meta.env.VITE_*` access on purpose: Vite inlines that exact
// expression at build time, whereas the dynamic lookup inside getEnvVar cannot
// be inlined into the browser bundle.
let viteLocalSupabaseFlag: string | undefined;
try {
  viteLocalSupabaseFlag = import.meta.env.VITE_LOCAL_SUPABASE;
} catch {
  viteLocalSupabaseFlag = undefined;
}

const LOCAL_SUPABASE_GATEWAY =
  getEnvVar('LOCAL_SUPABASE', 'VITE_LOCAL_SUPABASE') === 'true' ||
  viteLocalSupabaseFlag === 'true';

const localGatewayOrigin = (): string =>
  typeof window !== 'undefined'
    ? window.location.origin
    : `http://127.0.0.1:${(typeof process !== 'undefined' && process.env.PORT) || 3000}`;

export const SUPABASE_URL: string =
  clean(getEnvVar('SUPABASE_URL', 'VITE_SUPABASE_URL')) ||
  (LOCAL_SUPABASE_GATEWAY ? localGatewayOrigin() : '');
// Accept the common aliases a deployment may have used for the public key.
export const SUPABASE_ANON_KEY: string = clean(
  getEnvVar('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY') ||
    getEnvVar('SUPABASE_KEY', 'VITE_SUPABASE_KEY') ||
    getEnvVar('SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY')
);
export const SUPABASE_SERVICE_ROLE_KEY: string = clean(
  getEnvVar('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY')
);

const PLACEHOLDER_URL = 'https://placeholder-project.supabase.co';
const PLACEHOLDER_KEY = 'placeholder-key';

const isBrowser = typeof window !== 'undefined' && typeof process === 'undefined';

const hasUrl = !!SUPABASE_URL && !isPlaceholder(SUPABASE_URL);
const hasAnonKey = !!SUPABASE_ANON_KEY && !isPlaceholder(SUPABASE_ANON_KEY);
const hasServiceKey = !!SUPABASE_SERVICE_ROLE_KEY && !isPlaceholder(SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// WHY THIS FILE IS DEFENSIVE (the opaque "Server error (HTTP 500)" at checkout)
// ---------------------------------------------------------------------------
// `createClient(url, '')` THROWS `supabaseKey is required.` synchronously. This
// module is imported at the top of BOTH Express entrypoints, so a deployment
// that set SUPABASE_URL (+ SUPABASE_SERVICE_ROLE_KEY) but no anon key crashed
// the whole serverless function *at import time*. Every /api/* request then
// answered with the platform's own HTML 500 page — no JSON, no `error` field —
// which the booking modal could only report as:
//     "We couldn't save your booking (Server error (HTTP 500))."
// Nothing inside the request handlers could ever catch that, because the module
// never finished loading.
//
// Rules enforced below:
//   1. never pass an empty key to createClient (fall back to a placeholder),
//   2. never let createClient throw out of this module (try/catch),
//   3. server-side, if only the service-role key exists, use it for the default
//      client so the API keeps working instead of dying,
//   4. record *why* we degraded so /api/health can report it.
// ---------------------------------------------------------------------------

/** Key used for the default client (server may fall back to the service key). */
const resolvedDefaultKey = hasAnonKey
  ? SUPABASE_ANON_KEY
  : !isBrowser && hasServiceKey
    ? SUPABASE_SERVICE_ROLE_KEY
    : '';

const configIssues: string[] = [];
if (!hasUrl) {
  configIssues.push('SUPABASE_URL (or VITE_SUPABASE_URL) is missing or a placeholder.');
}
if (hasUrl && !hasAnonKey && !hasServiceKey) {
  configIssues.push('SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY) is missing — the Supabase client cannot be created.');
}
if (hasUrl && !hasAnonKey && hasServiceKey && !isBrowser) {
  configIssues.push(
    'SUPABASE_ANON_KEY is missing; the server fell back to SUPABASE_SERVICE_ROLE_KEY for the default client. Set the anon key so browser auth works.'
  );
}
if (hasUrl && hasAnonKey && !hasServiceKey && !isBrowser) {
  configIssues.push(
    'SUPABASE_SERVICE_ROLE_KEY is missing — server booking writes will be blocked by Row Level Security.'
  );
}

/** True when we have a usable live Supabase connection (URL + at least one key). */
const isRealSupabase = hasUrl && !!resolvedDefaultKey;

export const isMockSupabase = !isRealSupabase;

/** Machine-readable snapshot used by /api/health and the startup diagnostics. */
export const supabaseConfig = {
  mode: (isRealSupabase ? 'live' : 'mock') as 'live' | 'mock',
  hasUrl,
  hasAnonKey,
  hasServiceKey,
  /** Non-fatal problems worth showing an operator. */
  issues: configIssues,
  /** Set when createClient itself failed (should never happen now). */
  clientError: null as string | null,
  /** Host only — never leaks a key. */
  urlHost: hasUrl ? safeHost(SUPABASE_URL) : null,
};

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Create a client without ever throwing. Any failure degrades to the offline
 * placeholder client and is recorded in `supabaseConfig.clientError`.
 */
function createClientSafely(url: string, key: string, options: Record<string, any>): SupabaseClient {
  try {
    return createClient(url, key, options);
  } catch (err: any) {
    supabaseConfig.clientError = err?.message || String(err);
    supabaseConfig.mode = 'mock';
    if (typeof console !== 'undefined') {
      console.error(
        `[Supabase] Client creation failed (${supabaseConfig.clientError}). Falling back to offline mock mode so the API keeps answering JSON instead of crashing.`
      );
    }
    return createClient(PLACEHOLDER_URL, PLACEHOLDER_KEY, options);
  }
}

// Public (anon) client — used by the browser for auth + owner-scoped queries.
// RLS policies scoped to auth.uid() protect the data.
export const supabase: SupabaseClient = createClientSafely(
  isRealSupabase ? SUPABASE_URL : PLACEHOLDER_URL,
  isRealSupabase ? resolvedDefaultKey : PLACEHOLDER_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);

// Server-side admin (service role) client — bypasses RLS. Only created in the
// Node server, never in the browser bundle, so the secret never ships to the
// client.
export function getSupabaseAdmin(): SupabaseClient | null {
  if (typeof process === 'undefined') return null; // browser
  if (!hasUrl || !hasServiceKey) return null;
  try {
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  } catch (err: any) {
    supabaseConfig.clientError = err?.message || String(err);
    console.error('[Supabase] Admin client creation failed:', supabaseConfig.clientError);
    return null;
  }
}

// Convenience singleton for the Express server (server.ts).
export const supabaseAdmin = getSupabaseAdmin();

if (typeof console !== 'undefined') {
  if (isMockSupabase) {
    console.warn(
      'Supabase keys are missing or using placeholders. App will run in mock mode with limited persistence.' +
        (configIssues.length ? ` (${configIssues.join(' ')})` : '')
    );
  } else if (configIssues.length) {
    console.warn(`[Supabase] Live mode with configuration warnings: ${configIssues.join(' ')}`);
  }
}
