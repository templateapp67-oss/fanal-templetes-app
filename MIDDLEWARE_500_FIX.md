# `500 MIDDLEWARE_INVOCATION_FAILED` after PR #121 — root cause and fix

Symptom (production, `bom1::…`):

```
This page is unavailable
Routing Middleware for this page temporarily failed.
500 MIDDLEWARE_INVOCATION_FAILED
```

## 1. What PR #121 changed

| | Before #121 | After #121 |
|---|---|---|
| `middleware.ts` | self-contained, **no imports** | `import { renderPublicSocialPage } from './server/publicSocialPage'` |
| `config.matcher` | `['/partner/:path*', '/growth-partner/:path*']` | `['/', '/partner/:path*', '/growth-partner/:path*']` |

So two things landed together: the middleware started doing real work on `/`,
and it started importing local modules to do it.

## 2. Root cause: the middleware module never loads

Vercel builds a root `middleware.ts` with `@vercel/node`
(`packages/static-build` → `getApiMatches()` maps `middleware.[jt]s` to
`@vercel/node` with `config.middleware = true`). That builder **does not bundle**
the entrypoint: it traces every reachable file and transpiles each of them on
its own (`compile2()` → `nodeFileTrace` with per-file TypeScript output), then
hands the resulting file set to the runtime (Edge by default — see
`resolveMiddlewareRuntime()`; the Node.js runtime is only the default for
projects created after 2026-09-01 with the rollout flag on).

The traced sibling modules are therefore **not resolved at runtime**, and the
specifiers this file emitted were extensionless, which native ESM rejects as
well:

```js
// emitted middleware.js
import { renderPublicSocialPage } from "./server/publicSocialPage";   // ← no .js
```

Reproduced locally by transpiling the PR #121 files the same way (per file, no
bundling) and loading the entrypoint as ESM:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'/tmp/vercel-sim/server/publicSocialPage' imported from
/tmp/vercel-sim/middleware.js
```

The module fails to **load**, so nothing inside `middleware.ts` — not even its
`try/catch` — ever runs. Vercel answers every matched route with
`MIDDLEWARE_INVOCATION_FAILED`, which is why the home page (newly added to the
matcher) went down with it.

The extensionless specifiers were the give-away: the Node/API graph in this
repo uses `.js` suffixed relative imports **103 times** (see `api/index.ts`,
`server/*.ts`), because `package.json` has `"type": "module"`. The only two
extensionless relative imports in that graph were the two PR #121 added to
`server/publicSocialPage.ts`.

## 3. The fix

| File | Change |
|---|---|
| `middleware.ts` | Rewritten **import-free**. It only reads the URL, decides whether the request is a public salon home page, and proxies the rendered HTML from `GET /api/public-shell`. Every failure path returns `undefined` → Vercel continues to the static `index.html`. Matcher narrowed to `['/']`. |
| `server/publicSocialShell.ts` (new) | Express handler for `GET /api/public-shell`. Rebuilds the public URL (`/?site=…`) and renders it with the existing `server/publicSocialPage.ts`. |
| `server/publicSocialPage.ts` | Relative imports now carry the `.js` extension (`../src/lib/tenant.js`, `../src/lib/socialMetadata.js`) — required for the native-ESM server graph. Behaviour unchanged. |
| `src/lib/socialMetadata.ts` | `./seoKeywords` → `./seoKeywords.js`, `../types` → `../types.js` (now reachable from the API graph). |
| `api/index.ts`, `server.ts` | Register `GET /api/public-shell`, so the serverless deployment and `npm run dev` run identical code. |
| `src/lib/salonSync.ts` | `../utils/social` → `../utils/social.js` — the last extensionless relative import in the 59-file serverless graph. `tests/apiEsmImports.test.ts` ("serverless dependency graph uses resolvable Node ESM import extensions") was **red on `main`** because of it and is green again. |
| `tests/middlewareEdgeSafety.test.ts` (new) | Pins the invariant: **no import / `require()` / dynamic `import()` in `middleware.ts`**, plus the host gating, credential forwarding, HEAD, and every degradation path. |
| `tests/partnerEdgeRouting.test.ts` | Awaits the now-`async` middleware; asserts the matcher is `['/']`. |

### Why `/` only

`/partner/*` and `/growth-partner/*` were already no-ops in this middleware
(they must reach the SPA, where the browser restores its Supabase session and
`PartnerRouteGuard` decides). Matching them only added a second thing that can
take those routes down, so they are no longer in the matcher: if the middleware
ever fails again, the blast radius is the home page, not the partner portals.

### Why the render moved to the API runtime

`server.ts` already rendered this metadata inline for self-hosted deployments.
Putting the same work behind `GET /api/public-shell` keeps **one** implementation
(`server/publicSocialPage.ts` → `src/lib/socialMetadata.ts`) running in the Node
runtime, where the repo's normal import rules apply, and leaves the Edge
middleware with nothing but web-standard calls.

## 4. Verification

* `npm run typecheck` — clean.
* `npm run build` (`vite build` + `esbuild server.ts`) — succeeds.
* `tests/apiEsmImports.test.ts` — passes (was failing on `main`).
* `npm run test:website` — **415/416 pass**; the only failure
  (`hydrationResume` → "Phase 12 — Template switching …") fails identically on
  the base commit and passes when that file is run on its own, i.e. it is
  pre-existing and unrelated (baseline: 410/412).
* `middleware.ts` bundled alone: **2.6 kB, 0 import/require statements**; the
  per-file transpile that reproduced the failure now loads and runs:
  `loaded OK, matcher = ["/"]`.
* New suite `tests/middlewareEdgeSafety.test.ts` — 7/7 pass, including a
  static guard that fails the build if anyone re-adds an import to
  `middleware.ts`.
* `tests/partnerEdgeRouting.test.ts`, `tests/socialShareImplementation.test.ts`,
  `tests/globalSiteConfig.test.ts`, `tests/seoSocialPersistence.test.ts`,
  `tests/corsApi.test.ts` — 23/23 pass.
* Live check against the built server (mock Supabase, demo salon):

  ```
  GET /api/public-shell?site=demo        → 200 text/html, og:title/og:image injected
  GET /api/public-shell (Host: demo.nexora.in) → 200 text/html, og:url = http://demo.nexora.in:3000/
  HEAD /api/public-shell?site=demo       → 200, Content-Length: 0
  GET /api/public-shell?site=not-a-salon → falls through (404 JSON), never 500
  GET /?site=demo                        → same tags (Express inline renderer, unchanged)
  ```

## 5. Deployment checklist

1. Merge, then **Redeploy** (Vercel does not rebuild a merged commit by itself
   for existing deployments).
2. `curl -sI https://<app>/` → `200`, `content-type: text/html`.
3. Salon site: `curl -s https://<salon-host>/ | grep og:title`.
4. Sharing link: `curl -s 'https://<app>/?site=<slug>' | grep og:title`.
5. If anything in the shell path fails, the response is still the normal SPA —
   check **View Functions Logs → `api/public-shell`** for the real error.
