# Fix: Partner Operations Schema Not Applied

Error you saw:

```
Your tickets could not load. The partner operations schema is not applied to this project yet.
Run supabase/migrations/20260918035349_partner_portal_operations.sql and
supabase/migrations/20260919120000_partner_portal_section_reads.sql, then retry.
```

This happens when your Supabase project (cloud or local PGlite gateway) is missing the two portal migrations that create:

- `partner_earnings`, `partner_payout_requests`, `partner_level_definitions`,
  `partner_notifications`, `partner_notification_preferences`,
  `partner_marketing_assets`, `partner_support_tickets`, `partner_support_attachments`
- `partner_account_settings` (follow-up)
- RPCs: `my_active_partner_id()`, `get_my_partner_earnings()`, `request_my_partner_payout()`,
  `get_my_partner_payout_requests()`, `cancel_my_partner_payout_request()`,
  `get_my_partner_support_tickets()`, `submit_my_partner_support_ticket()`,
  `get_my_partner_notifications()`, `mark_my_partner_notifications_read()`,
  `get_my_partner_notification_preferences()`, `update_my_partner_notification_preferences()`,
  `get_partner_marketing_assets()`, `get_partner_marketing_asset_categories()`,
  `get_my_partner_levels()`, `get_partner_leaderboard()`, plus ledger helpers
  `record_partner_subscription_commission()`, `release_partner_earnings()`,
  `admin_mark_partner_payout_paid()`
- RLS policies: SELECT-only for `authenticated`, scoped to `my_active_partner_id()`
- Storage buckets: `partner-support` and `partner-marketing-assets` (private, with policies)

---

## Option 1: Supabase CLI (recommended for linked project)

### Prerequisites
- Supabase CLI installed: https://supabase.com/docs/guides/local-development/cli/getting-started
- Project linked: `supabase link --project-ref <your-project-ref>`
- Env vars set (or `.env` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`)

### Steps

1. **Verify current migration status**
   ```bash
   supabase migration list
   # or
   supabase db diff --linked
   ```

2. **Push all pending migrations (includes the two required files)**

   > ⚠️ **Dependency order matters** — see `GROWTH_PARTNER_SETUP.md §3` and troubleshooting row
   > "Every operational section says...". The file timestamps are misleading:
   > `20260918035349` references `growth_partners.id` (added in `20260928_partner_referrals_table.sql`)
   > and `partner_referrals` / `partner_referral_events` (created in `20260928` / `20260929`).
   > **Logical order is:** `20260928`, `20260929`, **then** `20260918035349`, `20260918070000`, `20260919120000`.
   > If your project already has `20260928`/`20260929` applied (you followed GROWTH_PARTNER_SETUP.md),
   > `supabase db push` will only push the portal files and succeed. If not, apply `28`/`29` first via SQL Editor.

   ```bash
   # From repo root
   supabase migration list   # check what is already applied
   supabase db push          # pushes pending in alphabetical order
   ```

   If `db push` fails with `column "id" referenced in foreign key constraint does not exist`
   or `relation "partner_referrals" does not exist`, apply in dependency order via SQL Editor (Option 2):

   ```sql
   -- 1. Must be first: adds growth_partners.id + partner_referrals
   -- supabase/migrations/20260928_partner_referrals_table.sql
   -- 2. Adds partner_referral_events
   -- supabase/migrations/20260929_partner_referral_events_rls.sql
   -- 3. Now portal operations (creates tables + my_active_partner_id + RLS + RPCs)
   -- supabase/migrations/20260918035349_partner_portal_operations.sql
   -- 4. Account settings (needs my_active_partner_id)
   -- supabase/migrations/20260918070000_partner_account_settings.sql
   -- 5. Section reads (needs operations tables)
   -- supabase/migrations/20260919120000_partner_portal_section_reads.sql
   ```

   After manual SQL Editor runs, repair the migration history so CLI knows they are applied:
   ```bash
   supabase migration repair --status applied 20260918035349
   supabase migration repair --status applied 20260918070000
   supabase migration repair --status applied 20260919120000
   ```

3. **If you only want those two files (e.g., you edited history), apply manually:**
   ```bash
   # Using psql via supabase db remote
   supabase db push --include-all --dry-run   # preview
   # Or apply via SQL Editor (see Option 2)
   ```

4. **Alternative: `supabase migration up` (local docker stack)**
   ```bash
   supabase start          # starts local postgres + postgrest + gotrue
   supabase migration up   # applies supabase/migrations/* in order
   supabase status
   ```

5. **Verify**
   ```bash
   npm run verify:connection   # checks live project if env set
   # or custom check:
   node scripts/verify-partner-operations-schema.mjs
   ```

### Expected output
- No error on `supabase db push`
- `partner_earnings`, `partner_support_tickets`, etc. exist
- RPCs respond: `select public.my_active_partner_id();` should not error

---

## Option 2: Supabase Dashboard SQL Editor (no CLI needed)

### Important: dependency order (GROWTH_PARTNER_SETUP.md §3)

The portal migrations depend on two earlier migrations that add the columns/tables they reference:

1. `20260928_partner_referrals_table.sql` — adds `growth_partners.id` + `partner_referrals` table
2. `20260929_partner_referral_events_rls.sql` — adds `partner_referral_events` table

**You must apply those two first**, then the portal files. If you apply `20260918035349` before `20260928`, Postgres will error with `column "id" referenced in foreign key constraint does not exist`.

Full correct order for a fresh project (or when 28/29 are missing):

```
20260928_partner_referrals_table.sql
20260929_partner_referral_events_rls.sql
20260918035349_partner_portal_operations.sql
20260918070000_partner_account_settings.sql
20260919120000_partner_portal_section_reads.sql
```

If your project already has 28/29 applied (check via `select * from supabase_migrations.schema_migrations`), you can start at step 2 below.

### Steps

1. Open your Supabase project → **SQL Editor** → **New query**

   First, ensure prerequisites are applied (if not already):

   - Copy `supabase/migrations/20260928_partner_referrals_table.sql` → Run
   - Copy `supabase/migrations/20260929_partner_referral_events_rls.sql` → Run

2. **Run `20260918035349_partner_portal_operations.sql`**
   - Copy entire file content from repo: `supabase/migrations/20260918035349_partner_portal_operations.sql`
   - Paste into SQL Editor
   - Click **Run**
   - Should end with `notify pgrst, 'reload schema'; commit;`
   - If you see `relation "storage.buckets" does not exist`, that's okay — the migration guards that block with `to_regclass('storage.buckets') is null` check. On Supabase cloud, `storage.buckets` DOES exist, so it will create `partner-support` bucket + policies.

3. **Run `20260918070000_partner_account_settings.sql` (optional but recommended)**
   - Same process: copy, paste, run

4. **Run `20260919120000_partner_portal_section_reads.sql`**
   - Copy entire file, paste, run
   - This file also guards `private.is_trusted_server_or_admin()` creation: if your project already has a custom admin predicate, it keeps yours; if missing, it creates the minimal safe version that allows `service_role` and superuser.

5. **Reload schema cache**
   - The migrations already run `notify pgrst, 'reload schema';`
   - If you still see PGRST202 errors, run manually:
     ```sql
     notify pgrst, 'reload schema';
     ```

6. **Verify in SQL Editor:**
   ```sql
   -- Tables exist?
   select tablename from pg_tables where schemaname='public'
     and tablename like 'partner_%' order by tablename;

   -- RPCs exist?
   select proname from pg_proc
     join pg_namespace n on n.oid = pronamespace
     where n.nspname='public'
       and proname in (
         'my_active_partner_id',
         'get_my_partner_earnings',
         'get_my_partner_payout_requests',
         'cancel_my_partner_payout_request',
         'get_my_partner_support_tickets',
         'submit_my_partner_support_ticket',
         'get_my_partner_notifications',
         'get_partner_marketing_assets',
         'get_my_partner_levels',
         'get_partner_leaderboard'
       ) order by proname;

   -- RLS enabled?
   select relname, relrowsecurity from pg_class
     where relname like 'partner_%' and relnamespace='public'::regnamespace;

   -- Storage buckets?
   select id, public, file_size_limit from storage.buckets
     where id in ('partner-support','partner-marketing-assets');
   ```

### Expected result
- 8+ `partner_*` tables
- 10+ RPCs listed
- RLS `true` for all
- Buckets exist (private = false? Actually they are private: `public=false`)

---

## Option 3: Local development without cloud (LOCAL_SUPABASE=true)

This repo includes a PGlite gateway (`server/localSupabase.ts`) that runs real migrations in-memory.

**Fixed in this branch:** `LOCAL_GROWTH_CHAIN` now includes:
```ts
'20260918035349_partner_portal_operations.sql',
'20260918070000_partner_account_settings.sql',
'20260919120000_partner_portal_section_reads.sql',
```
in correct chronological order, so `LOCAL_SUPABASE=true` now serves tickets, earnings, etc. without a cloud project.

To use:
```bash
# .env
LOCAL_SUPABASE=true
VITE_LOCAL_SUPABASE=true
# leave SUPABASE_URL empty so gateway is used

npm run dev
# Open http://localhost:3000
# Sign up as growth partner, then login as admin@nexora.local / Admin#12345 to approve
```

---

## Troubleshooting

### "permission denied for table partner_earnings"
- You applied migrations with anon key. Re-run with service_role or SQL Editor (which is superuser).
- Check grants:
  ```sql
  select grantee, privilege_type from information_schema.role_table_grants
   where table_name='partner_earnings';
  -- Should show authenticated: SELECT only
  ```

### "function public.my_active_partner_id() does not exist"
- Operations migration didn't run. Run Option 2 step 2 again.
- Check for syntax error: the function uses `plpgsql` and probes `information_schema.columns` for `status` column to support both generations.

### "Could not find the function public.get_my_partner_earnings"
- PostgREST schema cache stale. Run `notify pgrst, 'reload schema';` and wait 2s, then retry.

### "You already have a payout request open"
- That's the partial unique index `partner_payout_requests_one_open_per_partner` working as intended. Cancel open request first via `cancel_my_partner_payout_request`.

### Storage bucket missing
- If `storage.buckets` doesn't exist (bare Postgres / PGlite), the migration intentionally skips bucket creation — that's expected locally. On Supabase cloud, bucket should exist; if not, create manually:
  ```sql
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values ('partner-support','partner-support',false,10485760,array['image/png','image/jpeg','application/pdf','text/plain'])
  on conflict (id) do update set public=false;
  ```

---

## What was fixed in code (this branch)

1. **server/localSupabase.ts** — added the three missing migrations to `LOCAL_GROWTH_CHAIN` in correct order, with comments explaining why they were previously excluded and why they're needed now.

2. **tests/part3GrowthPartnerIntegration.test.ts** — updated expected table list to include the 9 partner portal tables, since the chain now contains them and they are NOT a second referral model.

3. **New helper scripts:**
   - `scripts/verify-partner-operations-schema.mjs` — checks tables, RPCs, RLS, buckets
   - `scripts/apply-partner-operations-migrations.mjs` — applies the two migrations via Supabase JS client using service_role (useful when CLI not available)

4. **This guide** — step-by-step for CLI and Dashboard.

---

## Quick one-liner to verify fix

After applying migrations, test as an authenticated partner:

```ts
import { supabase } from './src/lib/supabaseClient';

const { data, error } = await supabase.rpc('get_my_partner_support_tickets', { p_limit: 25, p_status: null });
console.log({ data, error });
// Should return [] (empty) instead of PGRST202
```

Or via curl (replace <token>):

```bash
curl -X POST 'https://<project-ref>.supabase.co/rest/v1/rpc/get_my_partner_support_tickets' \
  -H "apikey: <anon-key>" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"p_limit":25,"p_status":null}'
```

If you get `[]` or `{"items":...}`, the schema is applied.

---

## References

- Migrations:
  - `supabase/migrations/20260918035349_partner_portal_operations.sql`
  - `supabase/migrations/20260918070000_partner_account_settings.sql`
  - `supabase/migrations/20260919120000_partner_portal_section_reads.sql`
- Docs: `SUPABASE_SETUP.md`, `GROWTH_PARTNER_SETUP.md`
- Tests: `tests/partnerPortalSectionSql.test.ts` (pins ledger, payout, ticket, notification, asset, level, leaderboard behavior)
