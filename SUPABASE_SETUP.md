# Supabase backend setup

## Existing production database

The app at https://fanal-templetes-app.vercel.app uses project **qwaehqsmodekbgvnaavz**. Its schema is normalized: `profiles` holds account identity; `salons`, `organization_members`, `services`, `staff`, `booking_items` and `notifications` hold salon data. A salon's `owner_id` can be null; use verified organization membership.

Do not apply the legacy bootstrap below or blindly run every historical migration against this existing project. Historical scripts target different schema generations.

Apply `supabase/migrations/20260909142000_normalized_owner_workspace.sql` in SQL Editor as a database administrator. The user reported successful execution on 2026-09-09; live schema introspection subsequently confirmed `nexora_save_owner_workspace` exists. This is not a signed-in save/refresh verification.

**Required for owner appointments (2026-09-10):** `POST /api/owner/appointments` calls the `create_owner_booking` RPC, which no earlier migration had created — every manual dashboard appointment was rejected by the database with PostgREST `PGRST202` (Postgres `42883`, function does not exist). Apply `supabase/migrations/20260910200000_create_owner_booking.sql` in the SQL Editor (idempotent; creates one SECURITY DEFINER function plus two private helpers; no tables/columns/policies are changed). It writes customer → booking → line items in ONE transaction, enforces the same organization-membership rule as the API (cross-salon calls fail with `42501`), refuses retired/foreign catalogue records (`22023`), rejects slot overlaps (`23P01`) and is idempotent per booking reference. After applying it, a manual appointment named `Backend Verification` should save, appear in the calendar, survive a refresh and stay persisted after cancellation.

The migration requires the existing `nexora_owner_salon_ids()`, `sync_owner_contact(jsonb)`, and normalized tables. It saves editor state, contact, services, staff assignments and schedules in one transaction; validates ownership; preserves historical catalogue rows; and removes only conflicting booking foreign keys to the old `salon_staff` table while retaining the canonical `staff` foreign key. It does not disable RLS or grant anonymous writes.

**Required for Growth Partner + shared Onboarding wiring (Phase 1):** apply `supabase/migrations/20260912_growth_partner_onboarding.sql` in the SQL Editor (idempotent; creates ONLY the new `growth_partners` + `growth_onboarding` tables, their SELECT-only RLS policies, and the `validate/link/get/update` RPCs plus the admin-only `provision_growth_partner` — no existing table/column/policy/function is touched). Afterwards provision each partner as an administrator with `select public.provision_growth_partner('<auth-user-uuid>', 'CODE123');` (or omit the code to auto-generate one). Browser clients keep using only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` via the wrappers in `src/lib/growthPartner.ts`. Pinned by `tests/growthPartner.test.ts` (PGlite). This one file is NOT the whole area: the application/KYC approval chain and the dashboard reads live in `20260911094853`, `20260911101201`, `20260915`–`20260919`. Full order, partner approval and troubleshooting: `GROWTH_PARTNER_SETUP.md` (verify a deployment with `npm run verify:growth-partner -- .env`).

Server routes require SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY. Browser configuration uses only VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Never expose a service role key in VITE variables.

Verification: `npm run typecheck`, `npm test`, and `npm run build`. The PGlite migration tests cover atomic rollback and tenant isolation using a local fixture. Backend HTTP tests use synthetic credentials, not a real user session.

Remaining integration limits: home-visit booking creation, automatic birthday/referral credits, and staff performance RPCs need separate normalized integration and live validation. Customer booking details explicitly report unavailable loyalty terms. Do not describe these features or a real-account refresh test as complete without testing them. Payment capture also requires configured Razorpay credentials and existing payment RPC grants.

## Legacy bootstrap reference (not for the existing project)


The historical bootstrap below describes the older owner_id schema:

- ✅ Full database schema (multi-tenant, scoped to the salon owner)
- ✅ Row Level Security (RLS) on every table
- ✅ Owner auth wired to `supabase.auth` (email/password + metadata)
- ✅ Edge Functions (Deno) for bookings, notifications, and the Gemini AI endpoints
- ✅ A service-role admin client for the Express server
- ✅ Demo-data helper so you can seed live data in one call

Everything lives under `supabase/`. The Express `server.ts` and the browser
still work unchanged (they keep the mock fallback when no Supabase keys exist),
but once you configure the keys below the app persists everything for real.

---

## 1. Create a Supabase project

1. Go to <https://supabase.com> → **New project**.
2. Pick a region, set a database password.
3. From **Project Settings → API**, copy your **Project URL**, **anon public key**
   and **service_role key**.

> Keep the `service_role` key server-side only. It bypasses RLS.

---

## 2. Apply the schema + RLS

Two options:

### Option A — Supabase CLI (recommended)

```bash
npm i -g supabase
supabase login
supabase link --project-ref <your-project-ref>

# Apply all migrations (00001_init.sql)
supabase db push
```

### Option B — SQL Editor (no CLI)

Open your Supabase dashboard → **SQL Editor**, paste the contents of
`supabase/migrations/00001_init.sql` and run it.

This creates the tables: `profiles`, `services`, `stylists`, `bookings`,
`appointments`, `clients`, `in_app_notifications`, `loyalty_config`,
`loyalty_rewards`, `loyalty_point_transactions`,
`loyalty_redeemed_rewards` — each with RLS scoped to `auth.uid()`.

It also installs a trigger that auto-creates a `profiles` row on signup.

---

## 3. Configure authentication

RLS uses `auth.uid()`, so owner login must use **Supabase Auth**.

1. Dashboard → **Authentication → Providers → Email** — enable it.
2. (Optional) Turn off "Confirm email" for faster local testing.
3. On signup, `AuthModal.tsx` already calls `supabase.auth.signUp(...)` and
   passes `full_name`, `salon_name`, `phone_number`, `city` as user metadata.
   The `handle_new_user()` trigger writes the initial `profiles` row.

No schema changes are needed for auth — it's built in.

---

## 4. Set environment variables

Copy `.env.example` to your environment (AI Studio: the **Secrets** panel;
local: a `.env` file).

```bash
VITE_SUPABASE_URL="https://<project-ref>.supabase.co"
VITE_SUPABASE_ANON_KEY="<anon key>"

SUPABASE_URL="https://<project-ref>.supabase.co"
SUPABASE_ANON_KEY="<anon key>"
SUPABASE_SERVICE_ROLE_KEY="<service role key>"   # server only
GEMINI_API_KEY="<your key>"
```

The browser only receives the `anon` key. The `service_role` key is read in
Node (`server.ts`) via `getSupabaseAdmin()` and never bundled to the client.

---

## 5. (Optional) Deploy the Edge Functions

The functions live in `supabase/functions/`:

```
bookings/                GET list · GET by id · POST create · POST update
notifications/           GET list · POST mark-read
generate-bio/            POST  → { tagline, bio }
generate-promo-copy/     POST  → { whatsapp, instagramCaption, headline, badgeText }
generate-promo-image/    POST  → { success, imageUrl }
```

Deploy them:

```bash
supabase functions deploy bookings
supabase functions deploy notifications
supabase functions deploy generate-bio
supabase functions deploy generate-promo-copy
supabase functions deploy generate-promo-image
```

Set the Gemini secret for the AI functions:

```bash
supabase secrets set GEMINI_API_KEY=your-key
```

The `verify_jwt = false` entries in `supabase/config.toml` allow the
public/guest endpoints (booking, AI generation) to be called without a login
token, while owner-scoped reads still honour the `Authorization` header.

Call them from the browser by pointing at
`${VITE_SUPABASE_FUNCTIONS_URL}/functions/v1/<name>`, or keep using the
Express `/api/*` endpoints in `server.ts` — both write to the same tables.

---

## 6. Seed demo data

Once you have an owner account, seed realistic staff/services/clients/rewards
by calling the helper (replace the uuid with your signed-in user id):

```sql
select public.seed_demo_data(
  '<your-auth-user-id>',
  'Miraki Studio',
  'Bengaluru'
);
```

You can find your user id in **Authentication → Users**.

---

## 7. How RLS works here

| Table | Who can read | Who can write |
|-------|-------------|---------------|
| `profiles` | owner (`auth.uid()`) | owner |
| `services` / `stylists` | owner | owner |
| `appointments` | owner | owner |
| `clients` | owner | owner |
| `loyalty_*` | owner | owner |
| `bookings` | owner | owner (trusted server uses `service_role`) |
| `in_app_notifications` | owner or matching `user_email` | trusted server |

Authenticated customer bookings flow through the **Express server**
(`/api/bookings/create`) or the **Edge Function** (`/functions/v1/bookings`).
Those server-side writes use the `service_role` key and therefore bypass RLS,
but both surfaces verify the customer's bearer token before accepting a
booking. The public salon page is readable without an account; the booking
flow is not.

---

## 8. Local development

```bash
npm install
npm run dev        # starts Express + Vite at http://0.0.0.0:3000
```

If `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set, the app runs in
**live** mode. If they're missing/placeholder, it runs in **mock** mode with
in-memory bookings/notifications for easy preview.

---

## 9. Troubleshooting "Save failed" in the Website Editor

The editor saves to **localStorage first** (instant, always works) and then
mirrors the same payload to Supabase when an owner is signed in. A red
"Save failed" means the **cloud mirror** failed while the local copy
succeeded. The browser console always prints the exact per-table reason
under `[Nexora Sync Error] …` / `[AutoSave] …` (table name + message +
HTTP status), and the save pipeline automatically retries the failed state
through `POST /api/website/save` (service role, bypasses RLS) — so a broken
RLS policy no longer blocks the owner's save at all. Because the service
role **bypasses** RLS, that endpoint is the authorization boundary itself:
in live mode the editor sends the owner's Supabase access token
(`Authorization: Bearer <token>`) and the server verifies it against
Supabase Auth (`GET /auth/v1/user`, service-role apikey) and requires
`token.user.id === owner_id` — otherwise `401 Unauthorized`. An owner can
therefore only ever save their own salon, even with RLS broken. Map the
remaining symptoms as follows:

| Console / toast symptom | Root cause | Permanent fix |
|---|---|---|
| `permission denied for table …` (401/`42501`), "new row violates row-level security policy" (403) | The `authenticated` role has no GRANTs on the tables, or RLS policies are missing/broken | Apply **all** migrations: `00001_init.sql` + `20260907_owner_save_grants.sql` — or just run **`supabase/rls-restore-production.sql`** (idempotent repair: re-enables RLS, recreates the owner-scoped policies, re-grants). Then sign out/in. |
| `JWT expired` / `invalid JWT` / 401/403 | Stale or revoked session (tab left open too long, password changed elsewhere) | Sign in again. The app now pre-flights the session before every cloud save and self-recovers (degrades to a local draft meanwhile). |
| `relation "public.…" does not exist` (`42P01`) | Migrations never applied to this project | Run `supabase db push` (or paste `supabase/migrations/*.sql` into the SQL Editor). |
| `POST /api/website/save … HTTP 404` | The save API route is not on this deployment (older build) | Redeploy — the route ships in `api/index.ts` / `server.ts`. Edits stay on the device until then. |
| `Failed to fetch` / "blocked by CORS" | Cross-origin caller (split dev ports, preview/custom domain) hitting the API before CORS headers existed | Fixed: `server/cors.ts` (mounted in both entrypoints) answers the preflight and echoes the origin. Also cross-check `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — a wrong project URL makes the DIRECT sync fail; the service-role fallback still saves. |
| Network / `fetch failed` / 5xx | Transient outage | Automatic retry with backoff (3 attempts); edits stay saved on the device. |
| "Could not load your existing data…" (legacy) | Pre-fix deployments where a one-time hydration blip blocked all later saves | Redeploy from `main` — hydration now self-heals on the next save. |

### 9a. Isolating an RLS problem manually (optional — testing only)

If you want to prove a save failure is RLS-caused by disabling RLS, use the
two helper scripts (they are NOT migrations — run them from the SQL Editor):

1. **`supabase/rls-test-disable.sql`** — read-only diagnostics first (RLS
   status, policy counts, role grants for the five editor tables), then
   `ALTER TABLE … DISABLE ROW LEVEL SECURITY` on exactly
   `profiles, services, stylists, loyalty_config, loyalty_rewards`
   (this schema has **no** `team_members` table — the team table is
   `stylists`). Test the save, then…
2. **`supabase/rls-restore-production.sql`** — run IMMEDIATELY afterwards
   (and always for the permanent fix): re-enables RLS, recreates the
   canonical owner-scoped policies and role grants (idempotent).

> ⚠️ **Security:** while RLS is disabled, the `anon` key (which ships in
> every browser bundle) can read — and on standard projects also write —
> ALL owners' rows. Never leave a live project in the disabled state, and
> never disable RLS on `bookings` (guest traffic must stay
> service-role-only).
>
> ❌ **Anti-pattern — do NOT "fix" RLS with a permissive policy:**
> `CREATE POLICY … FOR ALL USING (true) WITH CHECK (true)` (no `TO` role)
> is *weaker* than owner-scoped policies in a multi-tenant app: every
> authenticated user — including **other salons' owners** — could read,
> edit and delete **all** owners' rows, and `anon` (every browser) can
> read every row. If a quick test policy is unavoidable, restrict it to
> `TO authenticated`, only on a **throwaway** project, and only on the
> editor tables (never `bookings`). The safe equivalent is what
> `supabase/rls-restore-production.sql` creates: full CRUD for the owner,
> scoped with `owner_id = auth.uid()` (profiles: `id = auth.uid()`).

Verification queries (SQL Editor) — the same ones the two helper scripts
print:

```sql
-- Privileges for the authenticated role (must list select/insert/update/delete
-- for every tenant table after applying 20260907_owner_save_grants.sql):
select tablename, privilege_type
from information_schema.role_table_grants
where grantee = 'authenticated' and schemaname = 'public'
order by tablename, privilege_type;

-- RLS policies per table (00001_init.sql creates owner-scoped policies):
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename, cmd;
```

Vercel environment variables (Project → Settings → Environment Variables,
server-side runtime): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`GEMINI_API_KEY`, plus browser-visible `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY`. Without the **service-role** key the public-site API
falls back to the anon client, which RLS blocks from reading other owners'
rows.

---

## 10. Pre-launch / Production Safety Checklist

Run through this **before publishing the live project** (and after any
schema/RLS change). Items 1–3 are hard gates; 4–6 are hygiene.

1. **RLS: owner-scoped, never permissive (hard gate).**
   All five editor tables (`profiles, services, stylists, loyalty_config,
   loyalty_rewards`) must have RLS **enabled** with the four owner-scoped
   policies each (`owner_id = auth.uid()`; profiles: `id = auth.uid()`), and
   **no** `USING (true)` / `FOR ALL` policy without a `TO <role>` clause —
   a permissive "enable full access for all" policy is a cross-tenant hole
   in a multi-tenant app (see §9a).
   - Idempotent repair: run **`supabase/rls-restore-production.sql`**.
   - Verify: the `pg_policies` query in §9a (expect `policy_count = 4` per
     editor table, `rls_enabled = t`), **plus the cross-tenant negative
     test**: sign in as a second account and
     `SELECT count(*) FROM profiles WHERE id IS DISTINCT FROM auth.uid();`
     must return **0**. A positive "my data saved" test alone cannot catch
     cross-tenant leakage.
2. **Grants (hard gate).** `role_table_grants` must show
   `authenticated → select, insert, update, delete` on the tenant tables
   and `anon → select` only (apply `20260907_owner_save_grants.sql` if not).
3. **Service-role writes: server-side only (hard gate).**
   - `SUPABASE_SERVICE_ROLE_KEY` exists **only** in the server runtime
     (Vercel server-side env; never `VITE_*`), and the production bundle
     ships only the anon key (verify once in a built artifact).
   - **Owner self-service saves:** the direct Supabase client sync is the
     PRIMARY path (RLS protects every row per write, no extra hop);
     `POST /api/website/save` is the identity-bound FALLBACK (live mode
     requires the caller's access token and enforces
     `token.user.id === owner_id`). Do not flip this around and route
     every auto-save through the serverless endpoint — the editor saves on
     every debounce tick, so that burns function quota, adds a hop, and
     makes the server the single point of failure for the editor.
   - **Cross-owner / admin / moderation operations (if ever needed):**
     build a *separate* admin path (Supabase Edge Function or an admin API
     route) with an explicit admin-identity check, using the service role —
     do NOT extend `/api/website/save` for it (it is single-owner upsert
     semantics by design: five tables, no deletes). Precedent in this repo:
     `server/bookingOps.ts` — authenticated booking writes already run server-side
     only.
4. **`bookings` is never RLS-disabled.** The test-disable helper script
   deliberately excludes it; authenticated booking traffic on that table must
   stay service-role-only in every environment.
5. **Secrets hygiene.** `SUPABASE_SERVICE_ROLE_KEY` must never appear in
   client code, `.env` files that ship to the browser, or commit history
   (rotate via the dashboard if it ever does).
6. **Optional: rate limiting.** The save endpoint is now identity-bound, so
   a caller can only touch their own rows — but an owner account can still
   hammer the serverless endpoint. Add a per-owner/per-IP rate limit if
   quota abuse ever becomes a concern.

---

## 11. Troubleshooting a failed authenticated booking ("Server error (HTTP 500)")

**Step 1 — ask the API what is wrong:**

```bash
curl -s https://<your-domain>/api/health?deep=1 | jq
```

The answer carries `mode` (`live`/`mock`), `bookingReady`, per-item `checks[]`
and a `problems[]` list. Secrets are never echoed — only whether they exist.

| `problems[]` entry | What it means | Fix |
|---|---|---|
| `SUPABASE_ANON_KEY … is missing` | Only the URL (± service-role key) is configured. Before the fix this **crashed the API at import time**, so every `/api/*` route answered an un-parseable HTML 500 — the exact "Server error (HTTP 500)" the checkout reported. | Set `SUPABASE_ANON_KEY` (or `VITE_SUPABASE_ANON_KEY`) in the hosting environment and redeploy. |
| `SUPABASE_SERVICE_ROLE_KEY is missing` | The API writes with the anon key, so RLS rejects authenticated booking writes (`42501`). | Set `SUPABASE_SERVICE_ROLE_KEY` server-side (never in the browser bundle). |
| `Cannot read the bookings table: …` | Migrations not applied, or the project is paused. | Run `supabase/migrations/00001_init.sql`, then `20260907_owner_save_grants.sql`. |
| `No salon profile exists …` | An authenticated booking cannot resolve the NOT NULL `owner_id`. | Publish the salon (so `profiles.subdomain` matches the site host) or set `DEFAULT_OWNER_ID`. |

**Step 2 — read the answer the customer got.** Every booking response now
includes a `requestId` (e.g. `bk_mtr1lwx3ijor83`) and a `code`:

| `code` | HTTP | Meaning |
|---|---|---|
| `invalid_booking` | 400 | Missing/invalid customer fields (`fieldErrors` names each one). |
| `payment_unverified` | 400 | The Razorpay signature did not verify — nothing was captured. |
| `owner_unresolved` | 422 | The salon is not linked to an owner account. |
| `23505` | 409 | Duplicate — the booking already exists. |
| `db_timeout` / `db_error` | 503 | The database did not answer; retryable, nothing was charged. |
| `request_timeout` | 504 | The whole request exceeded `API_REQUEST_TIMEOUT_MS` (9s). |
| `42501` | 500 | Row Level Security blocked the insert (missing service-role key). |
| `PGRST204` / `42703` | 500 | Table schema older than the build — run the migrations. (The API first retries without the unknown column, so this only appears when a *required* column is missing.) |

**Step 3 — grep the server logs for that `requestId`.** Every step logs it:
owner resolution source, the sanitized row, the exact Postgres `code`,
`details` and `hint`, dropped columns, and the total duration.

Notes:
- The booking table is written **only** by the trusted server with the
  service-role key; guests never talk to Supabase directly.
- Repeated submissions are de-duplicated by `owner_id` + `payment_id`
  (the `NX-…` booking reference or the Razorpay payment id), so a retry after a
  timeout returns the original booking (`duplicate: true`) instead of creating
  a second one.

---

## 12. Customer App (`/app`)

The customer-facing app (login, salon discovery, booking, reviews, favourites,
rewards wallet, QR credits, membership, referrals, notifications, offers) runs on
this **same database and the same 13 tables** — no extra tables, columns or
policies. Six of the entities its spec names have no table and are derived or
stored in existing `jsonb`; the mapping and the consequences are documented in
**[`CUSTOMER_APP_SETUP.md`](./CUSTOMER_APP_SETUP.md)**.

Two things to know before shipping it:

* It adds **no environment variables**. If `SUPABASE_URL` / keys are missing,
  customer reads come back empty with a "not connected" notice and customer
  writes are refused with `503 supabase_not_configured` — the app never books
  against a mock store.
* Verify it against your project rather than trusting this document:

```bash
npm run verify                              # mapping integrity (offline)
npm run verify -- --api https://your-host   # + table probes + RLS reality + API report
```

If stage 2 reports a missing table, the migrations in
`supabase/migrations/` were not fully applied to that project.
