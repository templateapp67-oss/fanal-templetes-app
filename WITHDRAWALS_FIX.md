# Fix: Withdrawals Page — Payout Requests Could Not Load

Error:
```
Your payout requests could not load. The partner operations schema is not applied to this project yet.
Run supabase/migrations/20260918035349_partner_portal_operations.sql and
supabase/migrations/20260919120000_partner_portal_section_reads.sql, then retry.
```

## What the page needs

**Tables (from 20260918035349):**
- `partner_earnings` — ledger, 15% commission, status `pending` → `available_for_withdrawal` after 7 days
- `partner_payout_requests` — payout requests, floor ₹500 (`amount_paise >= 50000`), one open per partner via partial unique index `partner_payout_requests_one_open_per_partner WHERE status IN ('pending','in_review')`
- `partner_level_definitions` — seeded tiers bronze/silver/gold/platinum
- plus notifications, marketing assets, support tickets (same file)

**Follow-up (from 20260919120000):**
- Fixes wallet accounting: `available_paise` now nets off **all** non-cancelled/rejected payouts (including paid), not just open ones — prevents double withdrawal
- Adds `get_my_partner_payout_requests()` — lists own requests + open total
- Adds `cancel_my_partner_payout_request()` — cancels own open request
- Adds notification prefs, asset categories, marketing bucket
- Creates `private.is_trusted_server_or_admin()` fallback if missing (so `release_partner_earnings()` and `admin_mark_partner_payout_paid()` work)

**RPCs used by Withdrawals page:**
- `my_active_partner_id()` — derives partner from `auth.uid()`, handles both `is_active` and `status='approved'` generations
- `get_my_partner_earnings(p_limit, p_offset)` — returns totals `{lifetime_paise, pending_paise, cleared_paise, available_paise}` + transactions
- `get_my_partner_payout_requests(p_limit, p_offset)` — returns `{total, open_amount_paise, items[]}`
- `request_my_partner_payout(p_amount_paise, p_method, p_destination_label)` — creates payout, checks floor, balance, one-open rule
- `cancel_my_partner_payout_request(p_request_id)` — cancels own open

**RLS:**
- All tables `ENABLE ROW LEVEL SECURITY`
- `REVOKE ALL FROM public, anon, authenticated` then `GRANT SELECT TO authenticated`
- Policies: `USING (partner_id = my_active_partner_id())` — SELECT own only, no partner_id param to tamper
- Payout requests table has partial unique index to enforce one open request

## Dependency order (critical)

```
20260928_partner_referrals_table.sql        -- adds growth_partners.id + partner_referrals
20260929_partner_referral_events_rls.sql    -- adds partner_referral_events
20260918035349_partner_portal_operations.sql -- references above, creates earnings/payout tables
20260918070000_partner_account_settings.sql -- needs my_active_partner_id()
20260919120000_partner_portal_section_reads.sql -- needs earnings/payout tables
```

If you apply 20260918035349 before 20260928, you get:
`column "id" referenced in foreign key constraint does not exist`

See `GROWTH_PARTNER_SETUP.md` table row 10-12.

## Option 1: Supabase CLI — npx supabase db push

```bash
# Install CLI if needed
npm i -g supabase
# or use npx
npx supabase --version

# Login and link
npx supabase login
npx supabase link --project-ref <your-project-ref>
# Example: qwaehqsmodekbgvnaavz (production)

# Check status
npx supabase migration list
# Shows which migrations are applied in cloud

# Push pending migrations (recommended if you already have 28/29 applied)
npx supabase db push

# If you need to force only the portal files (after manual SQL Editor apply):
npx supabase migration repair --status applied 20260918035349
npx supabase migration repair --status applied 20260918070000
npx supabase migration repair --status applied 20260919120000

# Verify
npx supabase db push --dry-run
```

**What db push does:**
- Reads `supabase/migrations/*.sql` sorted alphabetically
- Compares with `supabase_migrations.schema_migrations` table in cloud
- Applies missing ones in a transaction
- Runs `notify pgrst, 'reload schema'` at end of each migration so PostgREST sees new RPCs

## Option 2: Dashboard SQL Editor (no CLI)

1. Open Supabase Dashboard → SQL Editor → New query

2. **Ensure prerequisites (if not already applied):**
   - Open `supabase/migrations/20260928_partner_referrals_table.sql` → copy all → Run
   - Open `supabase/migrations/20260929_partner_referral_events_rls.sql` → copy all → Run

3. **Apply portal operations:**
   - Open `supabase/migrations/20260918035349_partner_portal_operations.sql`
   - Copy entire file (315 lines, includes `begin; ... commit;`)
   - Paste → Run
   - Expected: `Success. No rows returned` + notice `reload schema`

4. **Apply account settings (optional but recommended for profile page):**
   - `supabase/migrations/20260918070000_partner_account_settings.sql` → Run

5. **Apply section reads (fixes wallet + adds payout list/cancel):**
   - `supabase/migrations/20260919120000_partner_portal_section_reads.sql`
   - Copy → Run
   - This file guards `private.is_trusted_server_or_admin()` — if your project already has custom logic, it keeps it

6. **Reload schema cache (if still PGRST202):**
```sql
notify pgrst, 'reload schema';
```

7. **Verify (run in SQL Editor):**
```sql
-- Tables
select tablename from pg_tables where schemaname='public' and tablename in (
 'partner_earnings','partner_payout_requests','partner_level_definitions'
) order by tablename;
-- Expect 3 rows

-- RPCs
select proname from pg_proc join pg_namespace n on n.oid=pronamespace
where n.nspname='public' and proname in (
 'my_active_partner_id','get_my_partner_earnings',
 'get_my_partner_payout_requests','request_my_partner_payout',
 'cancel_my_partner_payout_request'
) order by proname;
-- Expect 5 rows

-- RLS
select relname, relrowsecurity, relforcerowsecurity from pg_class
where relname in ('partner_earnings','partner_payout_requests');
-- relrowsecurity should be true

-- Policies
select tablename, policyname, cmd, roles from pg_policies
where tablename in ('partner_earnings','partner_payout_requests') order by tablename;
-- Should show partner_earnings_select_own, partner_payout_select_own for authenticated

-- Grants
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_name in ('partner_earnings','partner_payout_requests') and grantee='authenticated';
-- Should be SELECT only (no INSERT/UPDATE/DELETE) — writes go via RPCs

-- Partial unique index (one open payout per partner)
select indexname, indexdef from pg_indexes where tablename='partner_payout_requests';
-- Should show partner_payout_requests_one_open_per_partner WHERE status IN (...)

-- Storage buckets (cloud only, PGlite skips)
select id, public, file_size_limit from storage.buckets
where id in ('partner-support','partner-marketing-assets');
-- public=false, private buckets
```

## Option 3: Local dev (already fixed in this branch)

`server/localSupabase.ts` LOCAL_GROWTH_CHAIN now includes the 3 portal migrations after 28/29:

```ts
'20260928_partner_referrals_table.sql',
'20260929_partner_referral_events_rls.sql',
'20260918035349_partner_portal_operations.sql',
'20260918070000_partner_account_settings.sql',
'20260919120000_partner_portal_section_reads.sql',
```

So with:
```bash
LOCAL_SUPABASE=true
VITE_LOCAL_SUPABASE=true
npm run dev
```
Withdrawals page works without cloud.

Verify locally:
```bash
npm run verify:withdrawals
# ✅ 9/9 tables, 20/20 RPCs, RLS enabled
# ✅ get_my_partner_earnings, get_my_partner_payout_requests, request/cancel all functional
```

## Frontend access check

**Authenticated client (browser):**
- Uses anon key + JWT, RLS enforces `partner_id = my_active_partner_id()`
- Can only SELECT own rows, cannot INSERT directly — must use RPCs
- RPCs are `SECURITY DEFINER` with `SET search_path=''`, derive partner from `auth.uid()`, so tampered body cannot access other partner

**Service role (server):**
- Bypasses RLS, used in `server/partnerPortalRoutes.ts` → `databaseForToken(token).rpc(...)`
- Still passes caller token, so RPC's own `my_active_partner_id()` guard applies
- Admin-only RPCs `record_partner_subscription_commission`, `release_partner_earnings`, `admin_mark_partner_payout_paid` have `REVOKE ALL FROM authenticated` and `GRANT EXECUTE TO service_role` only

Test as authenticated partner:
```ts
import { supabase } from './src/lib/supabaseClient';
const { data, error } = await supabase.rpc('get_my_partner_payout_requests', { p_limit: 10, p_offset: 0 });
console.log(data); // {total, open_amount_paise, items}
```

If you still see `PGRST202` / `schema_not_applied`, run `notify pgrst, 'reload schema'` and retry.

## What was fixed

- Local gateway now includes portal migrations → withdrawals page loads in local dev
- Updated `part3GrowthPartnerIntegration` expected tables
- Updated `partnerPortalSectionSql` to skip double-apply
- Added `verify-withdrawals` script proving RPCs work end-to-end
- Docs: `PARTNER_OPERATIONS_MIGRATION_FIX.md` + this file

See also: `GROWTH_PARTNER_SETUP.md` §3 for full migration order.
