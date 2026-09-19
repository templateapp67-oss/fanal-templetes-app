# Security Overview Unavailable — Complete Fix Guide

> **Error you saw**
> ```
> SECURITY OVERVIEW UNAVAILABLE: The security overview is not available on this
> project yet — the account security functions are not installed.
> ```

That string is **not a crash** — it is the classified `unavailable` copy from `src/lib/partnerAccountSecurity.ts` (PostgREST `PGRST202` → “functions not installed”). It means the database has not exposed `get_my_partner_security_overview`, or the PostgREST schema cache is stale. The page intentionally **degrades** (Change Email, Change Password, 2FA and Danger Zone stay usable) and shows a Retry. To make the section load, install the backend. Below is exactly what, where, and how.

---

## 1. Missing Backend — What to install and where

### 1.1 Files in this repo (already committed)

| File | Purpose |
|---|---|
| `supabase/migrations/20260919130000_partner_account_security_settings.sql` | **Creates everything** — tables, RLS, 6 RPCs |
| `supabase/migrations/20260919130100_reload_postgrest_schema_partner_security.sql` | `notify pgrst, 'reload schema'` — flushes PostgREST cache so the new RPCs are visible without waiting |
| `server/localSupabase.ts` → `LOCAL_GROWTH_CHAIN` includes both files in order | Local PGlite gateway (`npm run dev` with `VITE_LOCAL_SUPABASE=true`) runs the same migrations, so preview has no remote project dependency |

**Do not rename or reorder them.** `19130000` must run before `19130100`, and in the hosted project both must run **after** the Growth Partner core (`20260912_growth_partner_onboarding.sql` through `20260919120000_partner_portal_section_reads.sql`).

### 1.2 What `20260919130000` adds

**New columns on `partner_account_settings`** (structured social links, `bank_name`/`bank_branch`/`swift_code`/`pan_number`, `notify_email/whatsapp/sms`, `two_factor_enabled` mirror).

**Two new tables**

```sql
partner_security_events (
  id uuid, partner_id uuid FK → growth_partners(id), event_type text CHECK,
  detail text, created_at timestamptz
)  -- RLS: authenticated can SELECT + INSERT only own rows (my_active_partner_id())

partner_deactivation_requests (
  id uuid, partner_id uuid FK, reason text, status text CHECK ('pending','processed','cancelled'),
  requested_at timestamptz, processed_at timestamptz,
  unique (partner_id) WHERE status='pending'   -- one open request
)
```

**Six RPCs — all `SECURITY DEFINER`, `auth.uid()`-derived, never accept a partner id**

| RPC | Used for | Behaviour |
|---|---|---|
| `get_my_partner_security_overview() → jsonb` | **The one your page calls** (`supabase.rpc('…')` with no args). Returns `{two_factor_enabled, sessions_available, sessions[20], events[20], deactivation}` | Reads `auth.sessions` *if it exists* (probes `to_regclass` + `information_schema` first → `sessions_available: false` on projects without that auth schema, never fake rows). Current session comes from `request.jwt.claims.session_id`. Raises `42501` if caller is not an ACTIVE partner. |
| `revoke_my_other_partner_sessions() → int` | “Log out of all other sessions” | Deletes from `auth.sessions` where `user_id = partner.user_id` and `id ≠ current_session_id`; refuses (28000) if no `session_id` in JWT rather than guessing. Logs `sessions_revoked`. |
| `set_my_partner_two_factor(p_enabled bool, p_factor_id text)` | Mirror after verified TOTP enroll/verify or unenroll | Writes `partner_account_settings.two_factor_enabled`, logs `two_factor_enabled/disabled`. Auth factor itself lives in `auth.mfa_factors` (Supabase Auth). |
| `request_my_partner_account_deactivation(p_reason text)` | Danger Zone | Inserts pending row (partial unique), logs event, returns `{id,status,requested_at}`. |
| `cancel_my_partner_account_deactivation()` | Cancel pending request | `UPDATE … status='cancelled'` where pending, logs. |
| `log_my_partner_security_event(p_type text, p_detail text)` | Client-side audit (email change requested, password changed) | Whitelist: `credentials_changed|email_change_requested|profile_updated` only, partner derived from session. |

Grants: `REVOKE ALL FROM public, anon; GRANT EXECUTE TO authenticated` for each.

### 1.3 Why `20260919130100` exists (the cache bug)

`19130000` created the RPCs but — unlike its neighbours `20260911094853`, `20260911101201`, `20260919120000` — forgot `notify pgrst, 'reload schema';`. PostgREST caches the schema at boot, so on a project where the migration ran while PostgREST was hot, `rpc('get_my_partner_security_overview')` answered `PGRST202 Could not find function … in schema cache` until expiry. `19130100` is that one-liner, idempotent and always safe to re-run.

---

## 2. Front-End — Graceful fallback (already in the app)

### 2.1 Data layer — `src/lib/partnerAccountSecurity.ts`

```ts
export async function fetchPartnerSecurityOverview(client): Promise<Overview>
export function classifySecurityOverviewFailure(cause): PartnerSecurityOverviewError
export async function fetchPartnerSecurityOverviewWithRetry(client, {attempts=3, retryDelays=[400,1200]})
```

- `classifySecurityOverviewFailure` maps any rejection to a typed `kind` with **reviewed copy, never raw Postgres text**:

| `kind` | Trigger | UI copy |
|---|---|---|
| `session` | `PGRST301` / 401 / `jwt expired` | “Your session expired. Please sign in again.” |
| `forbidden` | `42501` / 403 / `Active Growth Partner required` | “Security details are unavailable because your partner account is not active.” |
| `unavailable` | `PGRST202` / `42883` / 404 / `schema cache` | **“The security overview is not available on this project yet — the account security functions are not installed.”** ← your error |
| `network` | `fetch failed`/`timeout`/`offline` | “Network error. Check your connection and try again.” + auto-retry |
| `unknown` | anything else | “Could not load your security overview. Please retry.” |

Only `network`/`unknown` are retried automatically (3 attempts, 400 ms → 1200 ms); `unavailable`/`forbidden`/`session` surface immediately instead of being hammered.

Other helpers in the same module: `revokeOtherPartnerSessions`, `beginPartnerTwoFactorEnrollment`/`confirmPartnerTwoFactor`/`disablePartnerTwoFactor`/`listPartnerTwoFactorFactors`, `changePartnerPassword` (verifies current password via `signInWithPassword` before `updateUser`), `requestPartnerEmailChange`, `requestPartnerAccountDeactivation`/`cancel…`, `describeSession`.

### 2.2 Hook — `src/lib/usePartnerSecurityOverview.ts`

```ts
const {overview, error, loading, refreshing, retry} = usePartnerSecurityOverview(client)
```

- Fixes three prior defects: (a) no all-or-nothing route gate, (b) newest-request-wins + unmount guard, `loading` only for first load, `refreshing` for later refetches, `error` always surfaced (no silent staleness), (c) client read via `ref` so an inline object literal does not restart fetches each render. `retry()` increments a key and starts a fresh newest-wins request.

### 2.3 Page — `src/components/PartnerAccountSettingsPage.tsx`

Before:
```tsx
if (loading) return <Loader/>
if (!overview) return <ErrorCard with Retry/>   // ← whole route vanished
```

After:
```tsx
if (loading && !overview) return <PartnerLoading/>
// afterwards a failed read degrades ONLY the security sections:
{error ? <SecurityOverviewNotice kind={error.kind} onRetry={retry}/> : null}
<ChangeEmailSection/>            // always rendered
<ChangePasswordSection/>
<TwoFactorSection state={overview ? (on?'on':'off') : 'unknown'} onRetry={retry}/>
<SessionsSection unavailable={!overview} sessions={overview?.sessions ?? []}/>
<SecurityLogSection unavailable={!overview} events={overview?.events ?? []}/>
<DangerZoneSection unavailable={!overview}/>
```

- `twoFactorState: 'on'|'off'|'unknown'` — an unreadable status is **never** shown as “2FA off”.
- Sessions/log show “could not be loaded” states with a per-section Retry when `overview` is null, rather than an empty list.
- Each card wrapped in `PartnerSectionErrorBoundary` (class component — React has no hook boundary) so a render throw in one card does not blank the route.
- Verified by `tests/dom/partnerAccountSettingsSecurityFailure.test.ts` (degrades, classifies, Retry heals, transient auto-retry) and `tests/partnerAccountSecurity.test.ts`.

---

## 3. Step-by-Step — Where to place backend + env vars

### A. Local development (no Supabase project — fastest way to see it work)

1. **Env** — `.env` (git-ignored; copy `.env.example` or run `npm run setup:env`) :

   ```ini
   VITE_LOCAL_SUPABASE=true
   LOCAL_SUPABASE=true
   # any non-placeholder anon key satisfies the client guard (gateway ignores it)
   VITE_SUPABASE_ANON_KEY=local-dev-anon-key
   SUPABASE_ANON_KEY=local-dev-anon-key
   # leave SUPABASE_URL / VITE_SUPABASE_URL EMPTY — a real URL disables the gateway
   # optional: LOCAL_SUPABASE_JWT_SECRET must be ≥32 bytes if you set it; otherwise random per boot
   ```

2. **Migrations** — nothing to run; `server/localSupabase.ts` `LOCAL_GROWTH_CHAIN` already lists both `19130000` and `19130100`. On `npm run dev` PGlite bootstraps from `server/localSupabase.ts:LOCAL_DATABASE_BOOTSTRAP` and replays the chain into a transient Postgres (persisted in `.local-db/` if you keep it).

3. **Run**

   ```bash
   npm install          # installs tsx, needed for tests/diagnostics
   npm run dev          # http://localhost:3000  (Vite + Express on 0.0.0.0)
   ```

   Seeded accounts printed on boot: `demo.partner@example.com / Partner#12345` (approved), `admin@nexora.local / Admin#12345`.

4. **Verify**

   ```bash
   npm run diagnose:partner-security
   # → 6/6 RPCs installed, 3/3 tables present (local chain)
   npm run test -- tests/partnerAccountSecurity.test.ts tests/partnerAccountSettingsBackend.test.ts
   # or DOM:  node --import ./scripts/testEnv.mjs --import tsx --test --test-force-exit tests/dom/partnerAccountSettingsSecurityFailure.test.ts
   ```

### B. Hosted Supabase project (make the error disappear in production)

1. **Pre-check** — you need `private.is_admin()` (see `GROWTH_PARTNER_SETUP.md §2`) and the Growth Partner core migrations `20260912` through `20260919120000` already applied. If `npm run verify:growth-partner -- .env` fails, do §2 first.

2. **Apply the two security migrations** — Supabase Dashboard → **SQL Editor** (or `supabase db push` if linked):

   ```sql
   -- paste supabase/migrations/20260919130000_partner_account_security_settings.sql  → Run
   -- then paste supabase/migrations/20260919130100_reload_postgrest_schema_partner_security.sql → Run
   -- (the second is literally:  notify pgrst, 'reload schema'; )
   ```

   Both are `begin; … commit;` idempotent. Rerunning is safe.

   CLI alternative:
   ```bash
   supabase link --project-ref <ref>
   supabase db push   # applies any not-yet-applied files in supabase/migrations/
   ```

3. **Env on the host** — Project → Settings → Environment Variables (or Vercel/Cloud Run Secrets):

   ```ini
   # ── Browser (build-time, VITE_ prefix) ──
   VITE_SUPABASE_URL="https://<ref>.supabase.co"
   VITE_SUPABASE_ANON_KEY="<anon key>"
   # ── Server (runtime, never VITE_) ──
   SUPABASE_URL="https://<ref>.supabase.co"
   SUPABASE_ANON_KEY="<anon key>"
   SUPABASE_SERVICE_ROLE_KEY="<service_role key>"   # never expose via VITE_
   # ── Turn OFF the local gateway in production ──
   # (remove LOCAL_SUPABASE / VITE_LOCAL_SUPABASE or set them to false)
   # ── Optional budgets (already sensible) ──
   DB_TIMEOUT_MS=6000
   DB_LOOKUP_TIMEOUT_MS=4000
   API_REQUEST_TIMEOUT_MS=9000
   ```

   Rebuild the frontend after any `VITE_` change; restart/redeploy the backend after any server var.

4. **Post-apply check**

   ```bash
   SUPABASE_URL="https://<ref>.supabase.co" SUPABASE_SERVICE_ROLE_KEY="<key>" \
     npm run diagnose:partner-security
   # expect:  6/6 RPCs reachable, 3/3 tables present
   # if still PGRST202: in SQL Editor run   notify pgrst, 'reload schema';   and wait 2–5s
   curl -s "https://<ref>.supabase.co/rest/v1/rpc/get_my_partner_security_overview" \
     -H "apikey: <anon>" -H "Authorization: Bearer <partner-jwt>" | jq
   ```

   Or in the app: sign in at `/partner/login` → **Account Settings** should show sessions, security log, 2FA. To test the degraded path, sign out in another tab and reload — Change Email/Password stay, the error card names the `session` cause, **Retry** restores the sections.

5. **Troubleshooting the four causes** (same table the error card uses):

   | What the browser gets | Notice | Action |
   |---|---|---|
   | `PGRST202` 404 “could not find function … in schema cache” | `unavailable` (your current error) | Apply `19130000`, then `notify pgrst, 'reload schema'` (or wait for cache expiry). Confirm with `diagnose:partner-security`. |
   | `42501` 403 “Active Growth Partner required” | `forbidden` | Caller has no active `growth_partners` row (pending/rejected/deactivated). Approve: `select public.review_growth_partner_application('<id>', true, 'ok');` or `select public.provision_growth_partner('<uid>');` |
   | `PGRST301` 401 / JWT expired | `session` | Sign in again; no retry button (re-fetch cannot help). |
   | `fetch failed` / timeout | `network` | Auto-retries 2× (400→1200 ms). Check connectivity, `GET /api/health?deep=1`. |

### C. Files — quick map

```
supabase/migrations/
  20260919130000_partner_account_security_settings.sql   ← backend (tables + 6 RPCs)
  20260919130100_reload_postgrest_schema_partner_security.sql ← cache flush
server/localSupabase.ts   ← LOCAL_GROWTH_CHAIN (both listed, auto-applied locally)
src/lib/partnerAccountSecurity.ts  ← classification + retry + all security calls
src/lib/usePartnerSecurityOverview.ts ← hook (newest-wins, loading vs refreshing)
src/components/PartnerAccountSettingsPage.tsx ← degraded rendering, unknown 2FA
src/components/PartnerSectionErrorBoundary.tsx ← per-card error boundary
scripts/diagnose-partner-security-overview.mjs ← npm run diagnose:partner-security
tests/partnerAccountSecurity.test.ts
tests/partnerAccountSettingsBackend.test.ts
tests/dom/partnerAccountSettingsSecurityFailure.test.ts
```

### D. One-command verification matrix

```bash
npm run typecheck                                # tsc --noEmit
npm run diagnose:partner-security                # schema + RPC + local PGlite call
node --import ./scripts/testEnv.mjs --import tsx --test tests/partnerAccountSecurity.test.ts
node --import ./scripts/testEnv.mjs --import tsx --test tests/partnerAccountSettingsBackend.test.ts
node --import ./scripts/testEnv.mjs --import tsx --test --test-force-exit tests/dom/partnerAccountSettingsSecurityFailure.test.ts
curl -s http://localhost:3000/api/health?deep=1 | jq  # when dev server is running
```

---

## Why the page no longer disappears

Previously `if (!overview) return <error/>` hid Change Email, Password, 2FA and Danger Zone behind one dead RPC. Now:

- First load owns the page only (`loading && !overview`). Every later refresh keeps the last good data on screen.
- A failed refresh sets `error` but the four sections stay mounted with “could not be loaded” states and an honest per-kind message plus a working **Retry** (`data-account-action="retry-security-overview"`).
- 2FA uses `unknown` instead of lying “off”; sessions never claims “0 sessions” when the read failed.
- The fix is covered by 4 DOM + 11 unit + 5 PGlite backend tests and the `ACCOUNT_SETTINGS_SECURITY_OVERVIEW_FIX.md` design note.

Apply the two migrations (or flip `VITE_LOCAL_SUPABASE=true` locally), rebuild, and the `SECURITY OVERVIEW UNAVAILABLE` card goes away — leaving the same graceful fallback for any future transport blip.
