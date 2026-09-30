// ============================================================================
// Builds supabase/apply_admin_management.sql — the one-paste bundle for the
// Supabase SQL Editor (or `psql -f`).
//
// The migration files stay the source of truth: `supabase db push` applies them
// from supabase/migrations/, and this script copies their bytes verbatim (each
// one inside its own begin/commit block) into a single file, wrapped in a header
// that explains the prerequisites, the verification query and the after-run
// step.
//
// EVERY `20261101*.sql` migration is picked up automatically, in file-name
// order — adding a new admin migration needs no edit here, so the bundle cannot
// drift from supabase/migrations/.
//
//   node scripts/bundle-admin-sql.mjs
//
// Re-run it after editing or adding any 20261101* migration.
// ============================================================================

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = 'supabase/migrations';
const PREFIX = '20261101';
const OUT = 'supabase/apply_admin_management.sql';

const files = readdirSync(DIR)
  .filter((name) => name.startsWith(PREFIX) && name.endsWith('.sql'))
  .sort();
if (files.length === 0) {
  console.error(`no ${PREFIX}*.sql migrations found in ${DIR}`);
  process.exit(1);
}

const line = (char = '-') => char.repeat(76);
const rule = (title) => `
-- ${'#'.repeat(76)}
-- ${title}
-- ${'#'.repeat(76)}

`;

// One-line summaries for the header. A migration without an entry is still
// bundled — it just gets no description.
const DESCRIPTIONS = {
  '20261101000000_admin_management_core.sql':
    'roles + RBAC helpers, admin_members, the public onboarding link and\n--      application tables, the append-only audit trail, the reward tiers, the\n--      private `manager-documents` bucket and its policies.',
  '20261101000100_admin_partner_operations.sql':
    'the area directory, report summary, moderation, bank/UPI correction,\n--      the payout queue and the super-admin-only export.',
  '20261101000200_admin_first_super_admin_claim.sql':
    'admin_setup_state() + claim_first_super_admin(): the one-click,\n--      one-time "Claim Super Admin access" button on /admin (refused as soon\n--      as any active admin exists).',
};

const numbered = files
  .map((name, index) => {
    const description = DESCRIPTIONS[name] ? `\n--      ${DESCRIPTIONS[name]}` : '';
    return `--   ${index + 1}. ${DIR}/${name}${description}`;
  })
  .join('\n--\n');

const header = `${line()}
-- ADMIN & MANAGER MANAGEMENT — ONE-PASTE BUNDLE FOR THE SUPABASE SQL EDITOR
-- ${line()}
--
-- This file is the EXACT concatenation of the ${files.length} admin migrations, in order:
--
${numbered}
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
--   Open /admin, sign in with the account that should own the project and press
--   "Claim Super Admin access". It works exactly once: as soon as any active
--   admin exists the button disappears and the claim is refused.
--   Manual fallback (SQL Editor) — section 3 of ADMIN_MANAGEMENT_SETUP.md has the
--   insert (an admin_members row with role = 'super_admin' linked to your
--   auth.users id).
--
-- VERIFY (paste and run at the end; expected 6 · 1 · 23 · 2 · 3)
--   select
--     (select count(*) from pg_tables where schemaname = 'public' and tablename in
--        ('admin_members','manager_onboarding_links','manager_onboarding_applications',
--         'partner_audit_logs','partner_reward_tiers','partner_rewards')) as admin_tables,
--     (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace
--        where n.nspname = 'public' and t.typname = 'admin_role') as admin_role_enum,
--     (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--        where n.nspname = 'public' and (p.proname like 'admin\\_%' or p.proname in
--          ('get_my_admin_access','get_manager_onboarding_link',
--           'submit_manager_onboarding_application','claim_first_super_admin'))) as admin_rpcs,
--     (select count(*) from storage.buckets where id in
--        ('manager-documents','partner-marketing-assets')) as buckets,
--     (select count(*) from public.partner_reward_tiers) as reward_tiers;
--
-- SOURCE OF TRUTH
--   The migration files above (every ${PREFIX}*.sql). Regenerate this bundle
--   after editing or adding one:  node scripts/bundle-admin-sql.mjs
-- ${line()}

`;

const footer = `
-- ${line()}
-- End of the admin & manager management bundle.
-- Next: open /admin, sign in and press "Claim Super Admin access" (or create
-- your Super Admin by hand — section 3 of ADMIN_MANAGEMENT_SETUP.md). The panel
-- reads get_my_admin_access() and shows the staff screens instead of the
-- "Nexora staff accounts" refusal.
-- ${line()}
`;

const body = (name, index) =>
  rule(`PART ${index + 1} / ${files.length} — ${name}`) + readFileSync(`${DIR}/${name}`, 'utf8').trimEnd();

writeFileSync(OUT, header + files.map(body).join('\n\n') + footer);

console.log(`wrote ${OUT} from ${files.length} migrations: ${files.join(', ')}`);
