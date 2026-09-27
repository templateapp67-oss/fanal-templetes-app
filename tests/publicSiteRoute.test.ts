// ============================================================================
// PUBLIC SALON SITE (`/?site=slug`) — routing integrity.
//
// The public site is served from the SAME deployment and the SAME browser the
// owner edits in. Two things must therefore hold, and both broke in
// production:
//
//   1. `/?site=slug` is READ-ONLY. While the tenant lookup is still in flight
//      `isPublicSite` is false, so a signed-in owner's hydration/autosave could
//      write their own editor state — including the slug and an empty
//      catalogue — over the salon whose public site they were only visiting.
//      The guards must cover the lookup WINDOW (`shouldBlockForSiteLookup`),
//      not just the resolved public site.
//   2. Owner-side resolution must never hijack a public URL. The tenant
//      isolation effect clears `siteTenant` and calls
//      `setCurrentView('wizard')`, which navigates to `/` and silently DROPS
//      `?site=slug` — after which the host lookup finds no tenant and the
//      visitor lands on "Website unavailable".
//
// App.tsx is a 2.7k-line component that cannot be mounted cheaply, so these
// tests pin the wiring the same way the rest of the suite does: by asserting
// on the real source.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

/** The debounced auto-save effect, from its comment to its dependency array. */
function autoSaveEffect(): string {
  const start = app.indexOf('// Debounced auto-save.');
  const end = app.indexOf('// Flush a pending debounced save');
  assert.ok(start > -1 && end > start, 'the auto-save effect must exist');
  return app.slice(start, end);
}

/** The tenant isolation effect (PHASE 2 ownership resolution). */
function tenantIsolationEffect(): string {
  const start = app.indexOf('const resolvedOwnerRef = useRef<string | null>(null);');
  const end = app.indexOf('// OWNER EDITOR GUARD');
  assert.ok(start > -1 && end > start, 'the tenant isolation effect must exist');
  return app.slice(start, end);
}

test('a public salon URL is read-only for the whole lookup window, not only after it resolves', () => {
  const effect = autoSaveEffect();
  assert.match(effect, /if \(isPublicSite \|\| shouldBlockForSiteLookup\) return;/);
  assert.match(effect, /shouldBlockForSiteLookup,/, 'and the guard is a dependency, so it re-evaluates');
});

test('owner ownership resolution cannot clear a public tenant or navigate the visitor away', () => {
  const effect = tenantIsolationEffect();
  // The skip must come BEFORE the ref is claimed, so the resolution still runs
  // later if the owner navigates off the public URL.
  const skip = effect.indexOf('if (shouldBlockForSiteLookup) return;');
  const claim = effect.indexOf('resolvedOwnerRef.current = user.id;');
  assert.ok(skip > -1, 'the effect skips public site URLs');
  assert.ok(claim > skip, 'and skips before claiming the owner, so it can run on the owner surface later');
  assert.match(effect, /user\?\.id, path, setCurrentView, shouldBlockForSiteLookup/);
});

test('the owner workspace and profile reads stay out of a public salon page', () => {
  const workspace = app.slice(
    app.indexOf('// AUTHENTICATED SALON WORKSPACE RESOLUTION'),
    app.indexOf('// PHASE 2 — Multi-tenant Isolation & Ownership Resolution')
  );
  assert.match(workspace, /if \(isMockSupabase \|\| shouldBlockForSiteLookup\) return;/);

  const profileSync = app.slice(app.indexOf('// Auto-Fetch Profile Sync'), app.indexOf('// Hydrate services / staff / loyalty'));
  assert.match(profileSync, /if \(shouldBlockForSiteLookup\) return;/);
});

test('a public site request blocks the lookup view instead of falling through to Explore Templates', () => {
  assert.match(app, /if \(shouldBlockForSiteLookup && siteLoading\) \{/);
  assert.match(app, /const shouldBlockForSiteLookup = hasPublicSiteRequest \|\| isTenantHostRequest;/);
});

test('a transient site-lookup failure retries before it is allowed to fail the page', () => {
  assert.match(app, /const fetchSiteJsonWithRetry = useCallback\(/);
  assert.match(app, /await fetchSiteJsonWithRetry\(`\/api\/site\?site=/);
  const helper = app.slice(app.indexOf('const fetchSiteJsonWithRetry = useCallback('), app.indexOf('useEffect(() => {\n    let cancelled = false;\n    const requestedSite'));
  assert.match(helper, /attempt <= attempts/, 'transport failures are retried');
  assert.match(helper, /if \(last\.ok\) return last;/, 'a JSON verdict — including not-found — is never retried');
  assert.match(helper, /status >= 500/, 'only 5xx/408/429/timeouts are retryable');
});

test('the unavailable screen offers a way out instead of being a dead end', () => {
  const screen = app.slice(app.indexOf('Website unavailable'), app.indexOf('if (isPublicSite) {'));
  assert.match(screen, /Try again/);
  assert.match(screen, /setSiteLookupNonce/, 'and the button re-runs the lookup');
  assert.match(screen, /\?site=\{siteTenant\.subdomain\}/, 'the failing slug is shown, so a typo is obvious');
  assert.match(app, /siteLookupNonce\]\);/, 'the lookup effect re-runs on retry');
});

test('the public site opens the owner’s own template, not this browser’s default', () => {
  const render = app.slice(app.indexOf('if (isPublicSite) {'), app.indexOf("if (!isMockSupabase && !user && authStatus !== 'ready')"));
  assert.match(render, /selectedTemplateId=\{\(siteTenant\?\.selectedTemplateId \|\| selectedTemplateId\)/);
  assert.match(app, /selectedTemplateId: typeof data\.salon\?\.selectedTemplateId === 'string'/);
});
