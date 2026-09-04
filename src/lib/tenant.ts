// ============================================================================
// White-label multi-tenant host resolution.
//
// A visitor reaches a salon at either:
//   • a generated subdomain   ->  https://<subdomain>.nexora.in
//   • a custom domain          ->  https://<custom-domain>
//
// This module is shared by the Node server (server.ts) and the browser app so
// that both agree on what counts as the app's OWN host vs. a THIRD-PARTY
// salon's public subdomain. It never talks to a DB; it only parses hostnames.
// ============================================================================

/** Base domain that all auto-generated salon subdomains live under. */
export const BASE_DOMAIN =
  (typeof process !== 'undefined' && (process.env.VITE_BASE_DOMAIN || process.env.BASE_DOMAIN)) ||
  'nexora.in';

/**
 * The app's own hosts must NEVER be treated as a tenant subdomain, otherwise
 * the owner dashboard would render as an empty public site. This includes the
 * cloud-run/preview host, localhost and the sandbox host.
 */
export function getAppOwnedHosts(): string[] {
  const hosts: string[] = ['localhost', '127.0.0.1', '0.0.0.0', 'www.' + BASE_DOMAIN, BASE_DOMAIN];
  if (typeof process !== 'undefined') {
    const url = process.env.APP_URL || process.env.VITE_APP_URL || '';
    if (url) {
      try {
        hosts.push(new URL(url).host);
      } catch {
        // ignore malformed APP_URL
      }
    }
    // Allow extra app-owned hosts via a comma-separated env var.
    const extra = process.env.NEXORA_APP_HOSTS || '';
    if (extra) hosts.push(...extra.split(',').map((h) => h.trim()).filter(Boolean));
  }
  return hosts;
}

/** Hostnames that belong to the hosting/preview infra, never a tenant. */
function isInfraHost(host: string): boolean {
  return (
    host.endsWith('.e2b.app') || // Arena sandbox previews
    /\d+[-.][a-z0-9]+[-.][a-z0-9]+\.e2b\.app$/.test(host) ||
    host.endsWith('.run.app') || // Google Cloud Run default domain
    host.endsWith('.railway.app') ||
    host.endsWith('.onrender.com') ||
    host.endsWith('.fly.dev') ||
    host.endsWith('.vercel.app') ||
    host.endsWith('.netlify.app') ||
    host.endsWith('.supabase.co') ||
    host.endsWith('.pages.dev')
  );
}

/** Strip a :port suffix and lowercase. */
function normalizeHost(host: string): string {
  return (host || '').split(':')[0].trim().toLowerCase().replace(/\.$/, '');
}

/**
 * Return the tenant subdomain for a request host, or null when the host is the
 * app's own host / a completely unrelated host. For custom domains we return
 * the WHOLE host so the caller can match custom_domain in the DB.
 */
export function resolveTenantFromHost(host: string): { subdomain: string; customDomain: string | null } | null {
  const h = normalizeHost(host);
  if (!h) return null;

  const appOwned = new Set(getAppOwnedHosts().map((x) => normalizeHost(x)));
  if (appOwned.has(h)) return null;

  // Never treat hosting/preview infra as a salon tenant.
  if (isInfraHost(h)) return null;

  // Custom-domain match: any non-base-domain host is treated as a candidate
  // custom domain (exact match against profiles.custom_domain).
  if (!h.endsWith('.' + BASE_DOMAIN)) {
    return { subdomain: '', customDomain: h };
  }

  // Generated subdomain: everything before the base domain.
  const sub = h.slice(0, h.length - ('.' + BASE_DOMAIN).length);
  if (!sub) return null;
  return { subdomain: sub, customDomain: null };
}

/** True when a request host is a salon's own public subdomain/custom domain. */
export function isTenantHost(host: string): boolean {
  return resolveTenantFromHost(host) !== null;
}
