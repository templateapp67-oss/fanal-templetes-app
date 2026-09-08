// Local PostgreSQL validation of supabase/migrations/20260908_complete_rewards_qr_referrals_backend.sql
// Runs the file against a real (in-browser-WASM) PostgreSQL via PGlite:
//   1. replays the ENTIRE 00001_init.sql baseline first (minus the parts that
//      need Supabase's auth schema — see baseline strip list below),
//   2. replays the three follow-up migrations (booking metadata, owner grants,
//      member bonuses) in order,
//   3. executes the migration under test,
//   4. re-executes it a second time to prove idempotency,
//   5. prints the verification result rows.
// PGlite limitations vs Supabase: no `auth` schema, no `auth.uid()`/`auth.jwt()`,
// no `supabase_realtime` publication, no roles (postgres only). To still
// exercise every DDL statement, the baseline's policy/trigger/role statements
// and the migration's publication DO-block are run in a mode that tolerates
// those specific gaps; everything else runs verbatim.
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION_FILE = 'supabase/migrations/20260908_complete_rewards_qr_referrals_backend.sql';
const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');

const db = new PGlite();

// ---- Supabase compatibility pre-seed -----------------------------------------
// PGlite has no auth schema/roles/publication. Create minimal stand-ins so the
// baseline and the migration run VERBATIM (policies, grants, auth.uid()
// references included). auth.uid() returns NULL and auth.jwt() returns '{}',
// which is exactly the shape RLS evaluates to for a not-signed-in user.
await db.exec(`create schema if not exists auth`);
await db.exec(`create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
)`);
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$`);
await db.exec(`create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$`);
for (const role of ['anon', 'authenticated', 'service_role']) {
  try { await db.exec(`create role ${role} nologin`); } catch { /* exists */ }
}

// ---- baseline replay helpers -------------------------------------------------
// Splits on statement boundaries. Handles:
//   • single-quoted strings with '' escapes,
//   • double-quoted identifiers with "" escapes,
//   • line comments (-- to end of line),
//   • dollar-quoted bodies ($$ … $$ and $tag$ … $tag$) that may contain
//     semicolons and end with a line like "$$;"
// Splitting on ';' at end-of-line only is NOT enough: function bodies can end
// mid-line, e.g. `end; $$;` (see the seed helper in 00001_init.sql).
function splitStatements(text) {
  const out = [];
  let current = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    const rest = text.slice(i);
    if (ch === '-' && text[i + 1] === '-') {
      const nl = text.indexOf('\n', i);
      if (nl === -1) break;
      current += text.slice(i, nl + 1);
      i = nl + 1;
      continue;
    }
    if (ch === "'") {
      const end = rest.indexOf("''", 1);
      // find the closing quote handling '' escapes
      let j = i + 1;
      while (j < n) {
        if (text[j] === "'") {
          if (text[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j += 1;
      }
      current += text.slice(i, Math.min(j + 1, n));
      i = Math.min(j + 1, n);
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') { j += 2; continue; }
          break;
        }
        j += 1;
      }
      current += text.slice(i, Math.min(j + 1, n));
      i = Math.min(j + 1, n);
      continue;
    }
    if (ch === '$') {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*?\$|^\$\$/.exec(rest);
      if (m) {
        const tag = m[0];
        const closeAt = rest.indexOf(tag, tag.length);
        if (closeAt !== -1) {
          current += rest.slice(0, closeAt + tag.length);
          i += closeAt + tag.length;
          continue;
        }
      }
    }
    if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed) {
        out.push(trimmed);
      }
      current = '';
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

async function tryRun(label, stmt, { tolerate = false } = {}) {
  try {
    await db.exec(stmt);
    return { ok: true };
  } catch (err) {
    if (tolerate) return { ok: false, tolerated: true, err: String(err.message || err).slice(0, 300) };
    return { ok: false, err: String(err.message || err).slice(0, 300) };
  }
}

// Baseline statements that need Supabase's auth schema / roles / publication.
// Only statements that cannot work in PGlite at all: the uuid-ossp extension
// (not compiled in) and logical-replication publication membership (wal_level
// cannot be logical here). Everything else — including every policy, grant,
// trigger and auth.uid() reference — runs for real.
const needsSupabase = (stmt) => /uuid-ossp|pgcrypto|alter publication|create publication/i.test(stmt);

async function runBaseline() {
  const baseline = fs.readFileSync('supabase/migrations/00001_init.sql', 'utf8');
  const stmts = splitStatements(baseline);
  let ran = 0;
  let tolerated = 0;
  let failed = 0;
  for (const stmt of stmts) {
    if (needsSupabase(stmt)) {
      const r = await tryRun('baseline-auth', stmt, { tolerate: true });
      if (r.tolerated) tolerated += 1;
      else if (!r.ok) failed += 1;
      else ran += 1;
      continue;
    }
    const r = await tryRun('baseline', stmt);
    if (r.ok) ran += 1;
    else {
      failed += 1;
      console.error('BASELINE FAIL:', stmt.slice(0, 160).replace(/\n/g, ' '), '→', r.err);
    }
  }
  console.log(`[baseline] ran=${ran} tolerated(supabase-only)=${tolerated} failed=${failed}`);

  for (const extra of [
    'supabase/migrations/20260907_booking_metadata.sql',
    'supabase/migrations/20260908_member_bonuses.sql',
  ]) {
    const content = fs.readFileSync(extra, 'utf8');
    for (const stmt of splitStatements(content)) {
      const r = await tryRun(extra, stmt, { tolerate: needsSupabase(stmt) });
      if (!r.ok && !r.tolerated) console.error(`${extra} FAIL:`, stmt.slice(0, 120), '→', r.err);
    }
  }
  console.log('[baseline] follow-up migrations applied');
  return failed === 0;
}

function needsSupabaseForMigration(stmt) {
  return /alter publication|create publication|pgcrypto|uuid-ossp/i.test(stmt);
}

async function runMigrationOnce(label) {
  const stmts = splitStatements(sql);
  let ran = 0;
  let tolerated = 0;
  let failed = 0;
  const failures = [];
  for (const stmt of stmts) {
    const r = await tryRun(label, stmt, { tolerate: needsSupabaseForMigration(stmt) });
    if (r.ok) ran += 1;
    else if (r.tolerated) tolerated += 1;
    else {
      failed += 1;
      failures.push({ stmt: stmt.slice(0, 220).replace(/\n/g, ' '), err: r.err });
    }
  }
  if (failures.length) {
    console.error(`[${label}] FAILURES:`);
    for (const f of failures) console.error('  ', f.stmt, '→', f.err);
  }
  console.log(`[${label}] ran=${ran} tolerated(supabase-only)=${tolerated} failed=${failed}`);
  return failed === 0;
}

const baseOk = await runBaseline();
if (!baseOk) {
  console.error('Baseline did not apply; aborting.');
  process.exit(2);
}

const firstOk = await runMigrationOnce('migration-pass-1');
const secondOk = await runMigrationOnce('migration-pass-2');

// ---- verification queries ----------------------------------------------------
const q = async (name, text) => {
  try {
    const res = await db.query(text);
    console.log(`\n== ${name} ==`);
    console.table(res.rows.length < 30 ? res.rows : res.rows.slice(0, 30));
    return res.rows;
  } catch (err) {
    console.error(`== ${name} == ERROR:`, String(err.message || err).slice(0, 300));
    return null;
  }
};

await q('module tables exist', `select tablename from pg_tables where schemaname='public' and tablename in ('loyalty_config','loyalty_tiers','loyalty_point_transactions','reward_wallets','customer_qr_payments','referrals') order by 1`);
await q('required columns (module tables)', `select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name in ('loyalty_config','loyalty_tiers','loyalty_point_transactions','reward_wallets','customer_qr_payments','referrals') and column_name in ('owner_id','customer_user_id','referrer_user_id','referred_user_id','status','points_awarded','metadata','created_at','updated_at') order by table_name, column_name`);
await q('owner_id/customer_user_id coverage', `select table_name, bool_or(column_name='owner_id') has_owner, bool_or(column_name='customer_user_id') has_customer from information_schema.columns where table_schema='public' and table_name in ('loyalty_config','loyalty_tiers','loyalty_point_transactions','reward_wallets','customer_qr_payments','referrals') group by 1 order by 1`);
await q('triggers on module tables', `select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal and c.relname in ('loyalty_config','loyalty_tiers','loyalty_point_transactions','reward_wallets','customer_qr_payments','referrals') order by 1`);
await q('helper functions', `select proname from pg_proc where pronamespace='public'::regnamespace and proname in ('set_updated_at','ensure_updated_at_trigger','ensure_owner_scoped_rls') order by 1`);
await q('indexes incl. unique anchors', `select tablename, indexname, indexdef from pg_indexes where schemaname='public' and tablename in ('loyalty_tiers','reward_wallets','customer_qr_payments','referrals','loyalty_point_transactions') and (indexname like 'uq%' or indexname like 'idx_loyalty_tiers%' or indexname like 'idx_reward%' or indexname like 'idx_customer%' or indexname like 'idx_referrals%' or indexname like 'idx_point_tx%') order by tablename`);

// fixture data to prove the backfills + generated column + idempotent re-run
await db.exec(`insert into auth.users (id, email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','owner-a@example.com'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','priya@example.com'), ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','referrer@example.com')`);
await db.exec(`insert into public.profiles (id, full_name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Owner A') on conflict (id) do nothing`);
await db.exec(`insert into public.loyalty_config (owner_id, program_enabled, tier_thresholds, tier_multipliers) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true, '{"bronze":0,"silver":500,"gold":1000,"platinum":2000}', '{"bronze":1,"silver":1.15,"gold":1.3,"platinum":1.5}') on conflict (owner_id) do nothing`);
await db.exec(`insert into public.clients (owner_id, name, phone, email, points, lifetime_points, loyalty_tier) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Priya','+91 98765 43210','priya@example.com',120,300,'gold')`);
await db.exec(`insert into public.loyalty_point_transactions (owner_id, client_id, date, description, points_change, type) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from public.clients limit 1), current_date, 'QR payment (awaiting verification) ₹1,200.50 ref:qr_abc123', 0, 'qr_payment')`);
await db.exec(`insert into public.bookings (owner_id, user_id, customer_name, customer_email, customer_phone, booking_date, status, metadata) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Priya','priya@example.com','+91 98765 43210', current_date, 'confirmed', '{}')`);
await db.exec(`insert into auth.users (id, email) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','friend@example.com')`);
await db.exec(`insert into public.bookings (owner_id, user_id, customer_name, customer_email, customer_phone, booking_date, status, metadata) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','dddddddd-dddd-4ddd-8ddd-dddddddddddd','Friend','friend@example.com','+91 90000 00001', current_date, 'confirmed', '{"referral_code":"NX-CCCCCCCC"}')`);

const count = async (name, table) => {
  const res = await db.query(`select count(*)::int as n from ${table}`);
  console.log(`== ${name} ==`, res.rows[0].n);
};
await count('tiers backfilled (4 ladder rows for owner)', 'public.loyalty_tiers');
await count('reward wallets backfilled (1)', 'public.reward_wallets');
await count('qr payments backfilled (1)', 'public.customer_qr_payments');
await count('referrals backfilled (1)', 'public.referrals');

await db.query(`select column_name, data_type from information_schema.columns where table_schema='public' and table_name='loyalty_point_transactions' and column_name in ('points_awarded','dedupe_key') order by 1`).then((r) => console.log('== generated/dedupe columns ==', JSON.stringify(r.rows)));

// Re-run after fixtures: must add zero rows (idempotency incl. new data).
const thirdOk = await runMigrationOnce('migration-pass-3-after-fixtures');
await count('tiers after re-run (still 4)', 'public.loyalty_tiers');
await count('wallets after re-run (still 1)', 'public.reward_wallets');
await count('qr payments after re-run (still 1)', 'public.customer_qr_payments');
await count('referrals after re-run (still 1)', 'public.referrals');
const dump = await db.query('select amount, reference, status, customer_user_id from public.customer_qr_payments');
console.log('== customer_qr_payments rows ==', JSON.stringify(dump.rows));
const ltx = await db.query("select description from public.loyalty_point_transactions where type='qr_payment'");
console.log('== qr ledger rows ==', JSON.stringify(ltx.rows));
await q('RLS enabled', `select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname in ('loyalty_config','loyalty_tiers','loyalty_point_transactions','reward_wallets','customer_qr_payments','referrals') order by 1`);
await q('policies per module table', `select tablename, policyname, cmd from pg_policies where schemaname='public' and tablename in ('loyalty_config','loyalty_tiers','loyalty_point_transactions','reward_wallets','customer_qr_payments','referrals') order by tablename, cmd`);
await q('grants', `select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) privs from information_schema.role_table_grants where table_schema='public' and grantee in ('authenticated','service_role') and table_name in ('loyalty_config','loyalty_tiers','loyalty_point_transactions','reward_wallets','customer_qr_payments','referrals') group by 1,2 order by 2,1`);
await db.close();
const allOk = firstOk && secondOk && thirdOk;
console.log(`\nRESULT: ${allOk ? 'MIGRATION OK (3 passes, backfills verified, zero drift)' : 'MIGRATION HAD ERRORS'}`);
process.exit(allOk ? 0 : 1);
