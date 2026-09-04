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

Open your Supabase dashboard → **SQL Editor** and run the migration files **in
order**:

1. `supabase/migrations/00001_init.sql`
2. `supabase/migrations/00002_organizations_and_salons.sql`

`00001` creates the tables: `profiles`, `services`, `stylists`, `bookings`,
`appointments`, `clients`, `in_app_notifications`, `loyalty_config`,
`loyalty_rewards`, `loyalty_point_transactions`,
`loyalty_redeemed_rewards` — each with RLS scoped to `auth.uid()`.

It also installs a trigger that auto-creates a `profiles` row on signup.

`00002` adds the multi-tenant organization → salon model (see below) and
backfills every existing account into it. It is idempotent: re-running it (or
`select public.backfill_organization_model();`) never duplicates anything.

---

## 2b. The organization → salon model (migration 00002)

```
auth.users ─1:1─ profiles(role: owner|customer|admin)
                    │
                    └─< organization_members(role: owner|manager|staff,
                          status: active|invited|inactive|suspended,
                          is_primary, UNIQUE(organization_id,user_id))
                              │
                              └─ organizations ─< salons (organization_id NOT NULL)
                                                     ├─ salon_branding         (1:1)
                                                     ├─ salon_public_websites  (1:1, default draft)
                                                     ├─ salon_booking_settings (1:1)
                                                     ├─ salon_domains (nexora_subdomain | custom)
                                                     ├─ business_locations, salon_hours
                                                     ├─ service_categories, services, stylists, stylist_services
                                                     └─ bookings ─< booking_items
```

| Concept | Notes |
|---|---|
| `profiles.role` | `owner` (salon side, the default), `customer` (books appointments), `admin` (Nexora staff). |
| `organization_members` | `role` = `owner` / `manager` / `staff`; `status` = `active` / `invited` / `inactive` / `suspended`. One owner per organization, one `is_primary` membership per user. |
| `salons` | A salon belongs to exactly one organization (`organization_id` is `NOT NULL` after the backfill). |
| `salon_domains` | `nexora_subdomain` (`*.nexora.in`) or `custom`. **Never verified by default** — a row can't even be inserted as verified; use `public.verify_nexora_subdomain(id)` for managed subdomains or supply `verified_at` + `verification_method` for DNS-verified custom domains. |
| `salon_public_websites` | Starts as `draft`. Publishing requires a primary domain, and an unverified **custom** primary domain blocks publishing. |
| `booking_items` | Line items; `bookings.total_amount` is recomputed from them automatically. |

Access helpers (all `security definer`, safe to call from RLS policies):

```sql
public.can_access_salon(uuid)        -- any active member of the salon's organization
public.can_manage_salon(uuid)        -- owner / manager only
public.user_salon_ids()              -- salons the caller may see
public.primary_salon_id()            -- the caller's landing salon
public.is_platform_admin()
```

Compatibility views (all `security_invoker`, so RLS still applies):
`v_organization_members`, `v_salons`, `v_salon_profile` (legacy `profiles`
shaped row per salon), `v_bookings`.

### Backfill

`00002` runs `public.backfill_organization_model()` at the end, which for every
existing account creates **1 organization + 1 primary salon** and moves the
existing data into it: branding, booking settings, domains, the primary
location, opening hours, service categories, services, stylists (incl.
`stylist_services` from the legacy `assigned_services` jsonb), bookings and one
`booking_items` row per booking. Re-running is safe:

```sql
select public.backfill_organization_model();
-- → {"organizations_created": 0, "members_created": 0, "salons_created": 0, ...}
```

### Legacy ⇄ new compatibility sync

The UI still reads and writes the single-tenant tables (`profiles`,
`services`, `stylists`, `bookings`), so migration `00002` installs a two-way
sync between the new `salon_*` tables and the legacy `profiles` columns:

* `profiles.logo_url` ⇄ `salon_branding.logo_url` (and tagline, about, theme,
  socials, …)
* `profiles.require_deposit` / `deposit_percentage` / `home_service` ⇄
  `salon_booking_settings`
* `profiles.subdomain` / `custom_domain` ⇄ `salon_domains`
* `profiles.full_address` / `city` / … ⇄ the primary `business_locations` row
* `profiles.working_hours` ⇄ `salon_hours`

Rows written by code that doesn't know about salons yet (the React app, the
`bookings` Edge Function) are auto-scoped: a `BEFORE INSERT` trigger fills
`salon_id` from the writer's primary salon, or from `owner_id` for trusted
server writes.

Only the organization's **primary** (or only) salon is mirrored to `profiles` —
`profiles` has room for a single salon.

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
| `organizations` | active members of the organization | owner (managers may update) |
| `organization_members` | active members of the organization | owner / manager |
| `salons` | active members; **public** when the site is published | owner / manager |
| `salon_*`, `business_locations`, `salon_hours`, `service_categories`, `stylist_services` | active members; **public** when the site is published | owner / manager |
| `services` / `stylists` | owner, salon members, **public** when published | owner / manager of the salon |
| `appointments` | owner | owner |
| `clients` | owner | owner |
| `loyalty_*` | owner | owner |
| `bookings` / `booking_items` | owner + salon members (never anonymous) | members (create/update); owner / manager (delete). Guests use the `service_role` path |
| `in_app_notifications` | owner or matching `user_email` | trusted server |

"Public" reads are limited to real visitors — `anon`, or a signed-in user whose
`profiles.role` is `customer` (`public.is_public_visitor()`), so a signed-in
owner's `select * from salons` never returns another salon.

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
