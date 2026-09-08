// Local PostgreSQL validation of supabase/migrations/20260908_staff_performance_dashboard.sql
// Runs the file against PGlite (WASM PostgreSQL):
//   1. replays baseline migrations,
//   2. executes the migration under test,
//   3. executes it a second time for idempotency verification,
//   4. tests RPC functions with owner context and non-owner context.

import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION_FILE = 'supabase/migrations/20260908_staff_performance_dashboard.sql';
const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');

const db = new PGlite();

// Supabase compatibility setup
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
      if (trimmed) out.push(trimmed);
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

const needsSupabase = (stmt) => /uuid-ossp|pgcrypto|alter publication|create publication/i.test(stmt);

async function runBaseline() {
  const baseline = fs.readFileSync('supabase/migrations/00001_init.sql', 'utf8');
  for (const stmt of splitStatements(baseline)) {
    await tryRun('baseline', stmt, { tolerate: needsSupabase(stmt) });
  }
  for (const extra of [
    'supabase/migrations/20260907_booking_metadata.sql',
    'supabase/migrations/20260908_member_bonuses.sql',
    'supabase/migrations/20260908_complete_rewards_qr_referrals_backend.sql',
  ]) {
    if (fs.existsSync(extra)) {
      const content = fs.readFileSync(extra, 'utf8');
      for (const stmt of splitStatements(content)) {
        await tryRun(extra, stmt, { tolerate: needsSupabase(stmt) });
      }
    }
  }
}

async function runMigrationOnce(label) {
  const stmts = splitStatements(sql);
  let ran = 0, tolerated = 0, failed = 0;
  const failures = [];
  for (const stmt of stmts) {
    const r = await tryRun(label, stmt, { tolerate: needsSupabase(stmt) });
    if (r.ok) ran += 1;
    else if (r.tolerated) tolerated += 1;
    else {
      failed += 1;
      failures.push({ stmt: stmt.slice(0, 180).replace(/\n/g, ' '), err: r.err });
    }
  }
  if (failures.length) {
    console.error(`[${label}] FAILURES:`);
    for (const f of failures) console.error('  ', f.stmt, '→', f.err);
  }
  console.log(`[${label}] ran=${ran} tolerated=${tolerated} failed=${failed}`);
  return failed === 0;
}

await runBaseline();
console.log('Baseline migrations applied.');

const pass1 = await runMigrationOnce('pass-1');
const pass2 = await runMigrationOnce('pass-2 (idempotency)');

// Test data setup
const owner1 = '11111111-1111-4111-8111-111111111111';
const owner2 = '22222222-2222-4222-8222-222222222222';
const stylist1 = '33333333-3333-4333-8333-333333333333';
const stylist2 = '44444444-4444-4444-8444-444444444444';

await db.exec(`insert into auth.users (id, email) values ('${owner1}', 'owner1@salon.com'), ('${owner2}', 'owner2@salon.com')`);
await db.exec(`
  insert into public.profiles (id, full_name, salon_name)
  values ('${owner1}', 'Owner One', 'Salon One'), ('${owner2}', 'Owner Two', 'Salon Two')
  on conflict (id) do update set salon_name = excluded.salon_name, full_name = excluded.full_name
`);

await db.exec(`
  insert into public.stylists (id, owner_id, name, role, commission_rate, fixed_commission_amount, commission_type, commission_basis)
  values
    ('${stylist1}', '${owner1}', 'Ananya Sharma', 'Senior Stylist', 30.00, 100.00, 'both', 'net'),
    ('${stylist2}', '${owner2}', 'Other Owner Staff', 'Stylist', 20.00, 0, 'percentage', 'net')
`);

await db.exec(`
  insert into public.bookings (owner_id, stylist_id, customer_name, service_name, total_amount, advance_paid_amount, status, booking_date, metadata)
  values
    ('${owner1}', '${stylist1}', 'Rahul Roy', 'Master Cut', 1000.00, 200.00, 'completed', current_date, '{"discount_amount": 100, "review_rating": 5, "review_text": "Awesome haircut!", "reviewed_at": "${new Date().toISOString()}"}'::jsonb),
    ('${owner1}', '${stylist1}', 'Pooja V', 'Keratin Spa', 2000.00, 500.00, 'confirmed', current_date, '{}'::jsonb),
    ('${owner1}', '${stylist1}', 'Siddharth M', 'Skin Fade', 500.00, 0.00, 'pending', current_date, '{}'::jsonb)
`);

// Set auth.uid() context to owner1
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select '${owner1}'::uuid $$`);

const summaryRes = await db.query(`select * from public.owner_staff_performance_summary()`);
console.log('== OWNER 1 SUMMARY ==');
console.table(summaryRes.rows);

const leaderboardRes = await db.query(`select * from public.owner_seven_day_leaderboard()`);
console.log('== OWNER 1 LEADERBOARD ==');
console.table(leaderboardRes.rows);

const bookingsRes = await db.query(`select * from public.owner_staff_booking_details('${stylist1}')`);
console.log('== STYLIST 1 BOOKINGS ==');
console.table(bookingsRes.rows);

const reviewsRes = await db.query(`select * from public.owner_staff_review_details('${stylist1}')`);
console.log('== STYLIST 1 REVIEWS ==');
console.table(reviewsRes.rows);

// Set auth.uid() context to unauthenticated (NULL)
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$`);

let unauthBlocked = false;
try {
  await db.query(`select * from public.owner_staff_performance_summary()`);
} catch (err) {
  unauthBlocked = true;
  console.log('Unauthenticated access blocked successfully:', String(err.message));
}

// Set auth.uid() to owner2 and try to read stylist1 (belonging to owner1)
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select '${owner2}'::uuid $$`);

let crossTenantBlocked = false;
try {
  await db.query(`select * from public.owner_staff_booking_details('${stylist1}')`);
} catch (err) {
  crossTenantBlocked = true;
  console.log('Cross-tenant staff booking access blocked successfully:', String(err.message));
}

await db.close();

const allPassed = pass1 && pass2 && summaryRes.rows.length === 1 && unauthBlocked && crossTenantBlocked;
console.log(`\nVALIDATION RESULT: ${allPassed ? 'PASSED ALL CHECKS' : 'FAILED'}`);
process.exit(allPassed ? 0 : 1);
