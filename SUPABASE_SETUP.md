# Nexora Salon OS — Complete Supabase Backend

This repo ships a **complete, runnable Supabase backend** for Nexora Salon OS:

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

Guest bookings flow through the **Express server** (`/api/bookings/create`) or
the **Edge Function** (`/functions/v1/bookings`), which run with the
`service_role` key and therefore bypass RLS. That is why the public booking
form works without the customer logging in.

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
under `[AutoSave] …` / `[Profile] …`. Map it as follows:

| Console / toast symptom | Root cause | Permanent fix |
|---|---|---|
| `permission denied for table …` (401/`42501`), "new row violates row-level security policy" | The `authenticated` role has no GRANTs on the tables, or RLS policies are missing | Apply **all** migrations: `00001_init.sql` + `20260907_owner_save_grants.sql`. The grants file is idempotent and fixes projects whose default privileges were altered. Then sign out/in. |
| `JWT expired` / `invalid JWT` / 401/403 | Stale or revoked session (tab left open too long, password changed elsewhere) | Sign in again. The app now pre-flights the session before every cloud save and self-recovers. |
| `relation "public.…" does not exist` (`42P01`) | Migrations never applied to this project | Run `supabase db push` (or paste `supabase/migrations/*.sql` into the SQL Editor). |
| Network / `fetch failed` / 5xx | Transient outage | Automatic retry with backoff (3 attempts); edits stay saved on the device. |
| "Could not load your existing data…" (legacy) | Pre-fix deployments where a one-time hydration blip blocked all later saves | Redeploy from `main` — hydration now self-heals on the next save. |

Verification queries (SQL Editor):

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
