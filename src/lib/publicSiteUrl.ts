// ============================================================================
// Canonical public salon-website URL — the ONLY customer-facing share format.
//
// Every published salon website is shared as:
//
//   ${PUBLIC_ORIGIN}/?site=${encodedSlug}
//
// where PUBLIC_ORIGIN is the stable production deployment, never the
// environment the owner happened to be editing in. AI Studio / Cloud Run
// preview origins (and localhost, sandboxes, preview deployments) require a
// Google login or are unreachable for customers, so they must never appear in
// Copy Link, QR codes, publish confirmations, SMS/WhatsApp sharing, or any
// stored public URL. All customer-facing components must call
// `getPublicWebsiteUrl()` — never build the string inline.
//
// Precedence for the origin:
//   1. `VITE_PUBLIC_WEBSITE_URL` (Vite env, or the same name in process.env
//      for the Node server) — for custom production domains.
//   2. The current origin, when it is already a real production host.
//   3. `DEFAULT_PUBLIC_SITE_ORIGIN` — the safe production default.
// ============================================================================

/** Stable production deployment customers can always open. */
export const DEFAULT_PUBLIC_SITE_ORIGIN = 'https://fanal-templetes-app.vercel.app';

/** Host of the default production deployment (never treated as a preview). */
export const DEFAULT_PUBLIC_SITE_HOST = 'fanal-templetes-app.vercel.app';

/** Environment variable overriding the public website origin. */
export const PUBLIC_SITE_URL_ENV_VAR = 'VITE_PUBLIC_WEBSITE_URL';

function readEnvVar(name: string): string {
  try {
    const fromVite = String((import.meta as any)?.env?.[name] || '').trim();
    if (fromVite) return fromVite;
  } catch {
    // import.meta.env is absent in Node/test runtimes.
  }
  try {
    if (typeof process !== 'undefined' && process.env) {
      return String(process.env[name] || '').trim();
    }
  } catch {
    // No process access (locked-down browser contexts).
  }
  return '';
}

/** A configured origin must be an absolute http(s) URL; trailing slashes go. */
function normalizeConfiguredOrigin(raw: string): string {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+/i.test(value)) return '';
  try {
    const parsed = new URL(value);
    return parsed.origin;
  } catch {
    return '';
  }
}

/** Explicitly configured public website origin, or '' when unset/invalid. Read live so tests can override. */
export function configuredPublicSiteOrigin(): string {
  return normalizeConfiguredOrigin(readEnvVar(PUBLIC_SITE_URL_ENV_VAR));
}

/** Current browser origin, or '' outside a browser / when unavailable. */
export function currentBrowserOrigin(): string {
  try {
    if (typeof window === 'undefined' || !window.location?.origin) return '';
    return String(window.location.origin);
  } catch {
    return '';
  }
}

/**
 * True when a hostname can never serve customers: local dev, sandboxes, and
 * preview/infra hosting (Cloud Run, Railway, Render, Netlify, generic Vercel
 * previews…). The canonical production host itself is NOT a preview host.
 */
export function isPreviewSiteHost(hostname: string): boolean {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host === DEFAULT_PUBLIC_SITE_HOST) return false;
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return true;
  return (
    host.endsWith('.run.app') || // Google Cloud Run (AI Studio previews need a Google login)
    host.endsWith('.e2b.app') ||
    host.endsWith('.railway.app') ||
    host.endsWith('.onrender.com') ||
    host.endsWith('.fly.dev') ||
    host.endsWith('.netlify.app') ||
    host.endsWith('.pages.dev') ||
    host.endsWith('.supabase.co') ||
    host.endsWith('.vercel.app') // any other Vercel deployment is a preview, not the stable production
  );
}

/**
 * Resolve the only origin that may prefix a customer-facing salon link.
 * Preview/infra origins fall back to the stable production default so a link
 * copied from any environment always opens the same public site.
 */
export function publicSiteOrigin(origin = currentBrowserOrigin()): string {
  const configured = configuredPublicSiteOrigin();
  if (configured) return configured;
  const candidate = String(origin || '').trim();
  if (!candidate) return DEFAULT_PUBLIC_SITE_ORIGIN;
  try {
    const parsed = new URL(candidate);
    if (parsed.hostname.trim().toLowerCase().replace(/\.$/, '') === DEFAULT_PUBLIC_SITE_HOST) {
      return DEFAULT_PUBLIC_SITE_ORIGIN; // canonical host, always in https form
    }
    if (isPreviewSiteHost(parsed.hostname)) return DEFAULT_PUBLIC_SITE_ORIGIN;
    return parsed.origin;
  } catch {
    return DEFAULT_PUBLIC_SITE_ORIGIN;
  }
}

/**
 * Normalize a published slug for URL use. The saved slug is used verbatim
 * (never re-slugified or lowercased — it must match the stored record); only
 * surrounding whitespace is dropped. Returns '' when there is no slug.
 */
export function normalizePublicSiteSlug(slug: unknown): string {
  if (typeof slug !== 'string') return '';
  return slug.trim();
}

/**
 * Build the canonical customer-facing URL for a published salon website.
 * Returns '' when no published slug exists (callers must not share then).
 */
export function getPublicWebsiteUrl(publishedSlug: unknown, origin?: string): string {
  const slug = normalizePublicSiteSlug(publishedSlug);
  if (!slug) return '';
  return `${publicSiteOrigin(origin ?? currentBrowserOrigin())}/?site=${encodeURIComponent(slug)}`;
}
