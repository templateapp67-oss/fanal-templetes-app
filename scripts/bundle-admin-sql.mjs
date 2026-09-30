// ============================================================================
// Builds supabase/apply_admin_management.sql — the one-paste bundle for the
// Supabase SQL Editor (or `psql -f`).
//
// The two migration files stay the source of truth: `supabase db push` applies
// them from supabase/migrations/, and this script copies their bytes verbatim
// (each one inside its own begin/commit block) into a single file, wrapped in a
// header that explains the prerequisites, the verification query and the
// after-run step.
//
//   node scripts/bundle-admin-sql.mjs
//
// Re-run it after editing either migration so the bundle never drifts.
// ============================================================================

import { readFileSync, writeFileSync } from 'node:fs';

const CORE = 'supabase/migrations/20261101000000_admin_management_core.sql';
const OPS = 'supabase/migrations/20261101000100_admin_partner_operations.sql';
const OUT = 'supabase/apply_admin_management.sql';

const line = (char = '-') => char.repeat(76);
const rule = (title) => `
-- ${'#'.repeat(76)}
-- ${title}
-- ${'#'.repeat(76)}

`;

const header = `${line()}
-- ADMIN & MANAGER MANAGEMENT — ONE-PASTE BUNDLE FOR THE SUPABASE SQL EDITOR
-- ${line()}
--
-- This file is the EXACT concatenation of the two admin migrations, in order:
--
--   1. ${CORE}
--      roles + RBAC helpers, admin_members, the public onboarding link and
--      application tables, the append-only audit trail, the reward tiers, the
--      private \`manager-documents\` bucket and its policies.
--
--   2. ${OPS}
--      the area directory, report summary, moderation, bank/UPI correction,
--      the payout queue and the super-admin-only export.
--
-- HOW TO RUN
--   1. Supabase Dashboard -> SQL Editor -> New query.
--   2. Paste this whole file, press Run.
--   3. Run the VERIFY query below — it must return exactly the same numbers.
--
--   (Or skip the editor: \`psql "$DATABASE_URL" -f supabase/apply_admin_management.sql\`
--    with the pooled connection string from Project Settings -> Database.)
--
-- PREREQUISITES
--   The Growth Partner / partner-portal tables must already exist:
--   growth_partners, profiles, partner_account_settings, partner_payout_requests,
--   partner_referrals, partner_earnings, growth_onboarding. Apply the 20260930*
--   portal migrations first on a fresh project. Nothing else is required — no
--   extension beyond gen_random_uuid, no external key.
--
-- SAFE TO RE-RUN
--   Every statement is idempotent (if not exists / create or replace / guarded
--   do-blocks). If the editor stops on an error, fix the cause and paste the
--   whole file again — it will not duplicate rows, types or policies. The
--   storage block only runs when the \`storage\` schema is present (always on
--   Supabase; the guard exists for local PGlite runs).
--
-- AFTERWARDS
--   Make yourself a Super Admin — section 3 of ADMIN_MANAGEMENT_SETUP.md has
--   the insert (an admin_members row with role = 'super_admin' linked to your
--   auth.users id). Until then /admin reports is_admin: false for everybody.
--
-- VERIFY (paste and run at the end; expected 6 · 1 · 21 · 2 · 3)
--   select
--     (select count(*) from pg_tables where schemaname = 'public' and tablename in
--        ('admin_members','manager_onboarding_links','manager_onboarding_applications',
--         'partner_audit_logs','partner_reward_tiers','partner_rewards')) as admin_tables,
--     (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace
--        where n.nspname = 'public' and t.typname = 'admin_role') as admin_role_enum,
--     (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--        where n.nspname = 'public' and (p.proname like 'admin\\_%' or p.proname in
--          ('get_my_admin_access','get_manager_onboarding_link',
--           'submit_manager_onboarding_application'))) as admin_rpcs,
--     (select count(*) from storage.buckets where id in
--        ('manager-documents','partner-marketing-assets')) as buckets,
--     (select count(*) from public.partner_reward_tiers) as reward_tiers;
--
-- SOURCE OF TRUTH
--   The two migration files above. Regenerate this bundle after editing either
--   of them:  node scripts/bundle-admin-sql.mjs
-- ${line()}

`;

const footer = `
-- ${line()}
-- End of the admin & manager management bundle.
-- Next: create your Super Admin (section 3 of ADMIN_MANAGEMENT_SETUP.md), then
-- open /admin — the panel reads get_my_admin_access() and shows the staff
-- screens instead of the "Nexora staff accounts" refusal.
-- ${line()}
`;

const body = (file, title) => rule(title) + readFileSync(file, 'utf8').trimEnd();

writeFileSync(
  OUT,
  header + body(CORE, `PART 1 / 2 — ${CORE.split('/').pop()}`) + '\n\n' +
    body(OPS, `PART 2 / 2 — ${OPS.split('/').pop()}`) + footer
);

console.log(`wrote ${OUT} from ${CORE} + ${OPS}`);
