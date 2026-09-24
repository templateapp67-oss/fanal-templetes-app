# Deploying: the run command, the port, and the healthcheck

This file exists because a deploy crash-looped with

```
Error: Cannot find module '/home/runner/workspace/.output/server/index.mjs'
command finished with error [node .output/server/index.mjs]: exit status 1
healthcheck failed error=healthcheck / returned status 500
crash loop detected
```

Nothing was wrong with the app. `.output/server/index.mjs` is a **Nuxt/Nitro**
artifact that this project never builds. The host was starting a file that does
not exist, the process exited at once, and every `/` probe answered 500.

## What this project actually builds

| | |
| --- | --- |
| Client | `npm run build` → `vite build` → `dist/` (SPA: `dist/index.html` + `dist/assets/*`) |
| Server | the same command → `esbuild server.ts` → **`dist/server.cjs`** |
| API on Vercel | `vercel.json` → `api/index.ts` (serverless entry), everything else → `/index.html` |
| API elsewhere | `dist/server.cjs` (Express), which mounts `/api/*` |

There is no `.output/`, no Nitro, no Nuxt, and no `server/index.mjs`.

## Host settings (set these exactly)

| Setting | Value |
| --- | --- |
| Install | `npm ci` (or `npm install`) |
| Build | `npm run build` |
| **Run / Start** | **`npm start`** — which is `node dist/server.cjs` |
| Healthcheck path | `/api/health` (purpose-built), or `/` once the SPA is served |
| Port | **injected by the platform** — do not set it in code |

Do **not** set the run command to `node .output/server/index.mjs`,
`npm run preview`, or `nuxi start`; none of them describe this repo.

## Supabase environment variables: server-side names are enough

A Vite bundle only carries the `VITE_*` values that existed at **build** time. A
deployment that set only the server-side names — `SUPABASE_URL` and
`SUPABASE_ANON_KEY`, which is what most host dashboards call them — therefore
shipped a browser with no Supabase at all: `/api/health` reported `mode: "live"`
while every sign-in screen answered *"Accounts are not connected to a database in
this deployment."*

`server.ts` now serves `/env.js`, which hands that same **public** pair
(project URL + anon key) to the browser at runtime; `index.html` loads it before
the app bundle. So:

* set `SUPABASE_URL` + `SUPABASE_ANON_KEY` (+ `SUPABASE_SERVICE_ROLE_KEY` for
  server writes) and redeploy — no `VITE_*` duplication needed;
* setting `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` as well is still fine
  and still wins (build-time values take precedence);
* the **service-role key is never part of the payload** — pinned by
  `tests/clientRuntimeConfig.test.ts`, alongside the no-cache header and the
  script-order rule;
* with nothing configured, `/env.js` answers `window.__NEXORA_ENV__={}` and the
  app stays in mock mode exactly as before.

## The port

`server.ts` reads the port the platform assigns and only falls back to 3000 for
local development:

```ts
const parsedPort = Number.parseInt(String(process.env.PORT ?? ''), 10);
const PORT = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 3000;
app.listen(PORT, '0.0.0.0', () => { … });   // never 127.0.0.1
```

Bind to `0.0.0.0`, never `127.0.0.1`: a platform proxy reaches the container from
outside, and a loopback-only listener is unreachable however healthy the process
is. The startup line says which port it took:

```
Nexora Salon OS running on http://0.0.0.0:1104 (from $PORT)
```

## Verify a deploy locally, exactly as the host does it

```bash
npm ci
npm run build
PORT=1104 npm start          # the port your platform assigned
curl -i http://127.0.0.1:1104/            # 200 + the SPA HTML
curl -s http://127.0.0.1:1104/api/health  # {"status":"ok", …}
```

Both were run against this repo: `/` answered **200** (2,862 bytes of
`index.html`) and `/api/health` answered **200** with `"status":"ok"`. The same
run with the command from the crash log reproduces the reported failure:

```
$ node .output/server/index.mjs
Error: Cannot find module '…/.output/server/index.mjs'
```

## Pinned by tests

`tests/deploymentEntrypoint.test.ts` fails the build if any of this regresses:
the `start` script and the `build` output must name the same file, no
`.output`/Nuxt/Nitro reference may appear in the deploy config, the listener
must read `$PORT` and bind `0.0.0.0`, and the health endpoint must stay
machine-readable.

`npm run test:dom` / `npm test` cover the rest of the surface; see
`ARCHITECTURE.md` for how the SPA and the serverless/Express APIs fit together.
