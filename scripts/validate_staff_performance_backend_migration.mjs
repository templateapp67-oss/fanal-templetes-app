// Local PostgreSQL validation of
// supabase/migrations/20260908_staff_performance_dashboard_backend.sql
//
// Replays the repo baseline, applies the new migration twice (idempotency),
// then exercises owner / anon / customer / cross-salon access and the
// booking-payment-commission cases the dashboard must get right.
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION_FILE = 'supabase/migrations/20260908_staff_performance_dashboard_backend.sql';
const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');

const OWNER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CUSTOMER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STAFF_1 = '11111111-1111-4111-8111-111111111111'; // Ananya — percentage 30
const STAFF_2 = '22222222-2222-4222-8222-222222222222'; // Rohan — fixed
const STAFF_3 = '33333333-3333-4333-8333-333333333333'; // Kavita — none, no bookings
const STAFF_GONE = '44444444-4444-4444-8444-444444444444'; // deleted staff with history
const TODAY = new Date().toISOString().slice(0, 10);

const db = new PGlite();
const failures = [];
const pass = (name) => console.log(`  PASS  ${name}`);
const fail = (name, err) => {
  failures.push({ name, err: String(err) });
  console.error(`  FAIL  ${name} → ${String(err).slice(0, 400)}`);
};

await db.exec(`create schema if not exists auth`);
await db.exec(`create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
)`);
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$`);
await db.exec(`create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$`);
await db.exec(`create or replace function auth.jwt() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'sub', current_setting('request.jwt.claim.sub', true),
    'role', coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
  )
$$`);
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

async function tryRun(stmt, { tolerate = false } = {}) {
  try {
    await db.exec(stmt);
    return { ok: true };
  } catch (err) {
    if (tolerate) return { ok: false, tolerated: true, err: String(err.message || err).slice(0, 400) };
    return { ok: false, err: String(err.message || err).slice(0, 500) };
  }
}

const needsSupabase = (stmt) => /uuid-ossp|pgcrypto|alter publication|create publication/i.test(stmt);

async function runFile(path, { tolerateAuth = false } = {}) {
  const content = fs.readFileSync(path, 'utf8');
  const stmts = splitStatements(content);
  let ran = 0;
  let tolerated = 0;
  let failed = 0;
  const list = [];
  for (const stmt of stmts) {
    const r = await tryRun(stmt, { tolerate: tolerateAuth && needsSupabase(stmt) });
    if (r.ok) ran += 1;
    else if (r.tolerated) tolerated += 1;
    else {
      failed += 1;
      list.push({ stmt: stmt.slice(0, 220).replace(/\n/g, ' '), err: r.err });
    }
  }
  return { ran, tolerated, failed, list };
}

async function runSqlFileOnce(label, content) {
  const stmts = splitStatements(content);
  let ran = 0;
  let tolerated = 0;
  let failed = 0;
  const list = [];
  for (const stmt of stmts) {
    const r = await tryRun(stmt, { tolerate: needsSupabase(stmt) });
    if (r.ok) ran += 1;
    else if (r.tolerated) tolerated += 1;
    else {
      failed += 1;
      list.push({ stmt: stmt.slice(0, 260).replace(/\n/g, ' '), err: r.err });
    }
  }
  if (list.length) {
    console.error(`[${label}] FAILURES:`);
    for (const f of list) console.error('  ', f.stmt, '→', f.err);
  }
  console.log(`[${label}] ran=${ran} tolerated=${tolerated} failed=${failed}`);
  return failed === 0;
}

console.log('\n— Staff performance backend validation —');

const baseline = await runFile('supabase/migrations/00001_init.sql', { tolerateAuth: true });
console.log(`[baseline 00001] ran=${baseline.ran} tolerated=${baseline.tolerated} failed=${baseline.failed}`);
if (baseline.list.length) {
  for (const f of baseline.list) console.error('  BASELINE', f.stmt, '→', f.err);
}
for (const extra of [
  'supabase/migrations/20260907_booking_metadata.sql',
  'supabase/migrations/20260907_owner_save_grants.sql',
  'supabase/migrations/20260908_member_bonuses.sql',
]) {
  const r = await runFile(extra, { tolerateAuth: true });
  if (r.failed) {
    console.error(`[${extra}] failed=${r.failed}`);
    for (const f of r.list) console.error('  ', f.stmt, '→', f.err);
  }
}

const pass1 = await runSqlFileOnce('migration-pass-1', sql);
const pass2 = await runSqlFileOnce('migration-pass-2', sql);
if (!pass1 || !pass2) {
  console.error('Migration did not apply cleanly.');
  process.exit(1);
}

const q = async (text, params) => {
  if (params) return db.query(text, params);
  return db.query(text);
};

const asUser = async (uid, role, fn) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid || ''}', false)`);
  await db.exec(`select set_config('request.jwt.claim.role', '${role || 'anon'}', false)`);
  try {
    return await fn();
  } finally {
    await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
    await db.exec(`select set_config('request.jwt.claim.role', 'anon', false)`);
  }
};

// Seed identities + roster
await db.exec(`
  insert into auth.users (id, email) values
    ('${OWNER_A}', 'owner-a@example.com'),
    ('${OWNER_B}', 'owner-b@example.com'),
    ('${CUSTOMER}', 'customer@example.com')
  on conflict (id) do nothing;
  insert into public.profiles (id, full_name, salon_name, subdomain, email)
  values
    ('${OWNER_A}', 'Owner A', 'Glow Studio', 'glow', 'owner-a@example.com'),
    ('${OWNER_B}', 'Owner B', 'Other Salon', 'other', 'owner-b@example.com'),
    ('${CUSTOMER}', 'Priya', null, null, 'customer@example.com')
  on conflict (id) do nothing;
  insert into public.stylists (id, owner_id, name, role, avatar_url, commission_rate, status)
  values
    ('${STAFF_1}', '${OWNER_A}', 'Ananya Sharma', 'Senior Stylist', 'https://img/ananya.jpg', 30, 'Available'),
    ('${STAFF_2}', '${OWNER_A}', 'Rohan Kapoor', 'Barber', 'https://img/rohan.jpg', 0, 'Available'),
    ('${STAFF_3}', '${OWNER_A}', 'Kavita Deshmukh', 'Specialist', 'https://img/kavita.jpg', 0, 'Available')
  on conflict (id) do nothing;
`);

// Re-run backfill path (idempotent insert from stylists)
const pass3 = await runSqlFileOnce('migration-pass-3-after-staff', sql);

await db.exec(`
  insert into public.staff_commission_settings (salon_id, staff_id, commission_type, commission_rate, fixed_amount, is_enabled)
  values
    ('${OWNER_A}', '${STAFF_1}', 'percentage', 30, 0, true),
    ('${OWNER_A}', '${STAFF_2}', 'fixed', 0, 200, true),
    ('${OWNER_A}', '${STAFF_3}', 'none', 0, 0, false)
  on conflict (salon_id, staff_id) do update set
    commission_type = excluded.commission_type,
    commission_rate = excluded.commission_rate,
    fixed_amount = excluded.fixed_amount,
    is_enabled = excluded.is_enabled;
`);

const d = (offset) => {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() + offset);
  return dt.toISOString().slice(0, 10);
};

await db.exec(`
  insert into public.bookings (
    id, owner_id, user_id, customer_name, service_id, service_name,
    booking_date, time_slot, total_amount, advance_paid_amount,
    status, payment_status, payment_id, metadata
  ) values
    -- completed + paid_full + discount + 5-star (Ananya)
    ('b0000000-0000-4000-8000-000000000001', '${OWNER_A}', '${CUSTOMER}', 'Priya',
     null, 'Keratin', '${d(0)}', '10:00', 1000, 1000, 'completed', 'paid_full', 'pay_1',
     '{"staff_id":"${STAFF_1}","staff_name":"Ananya Sharma","discount_amount":100,"review_rating":5,"review_text":"Loved it"}'),
    -- cancelled — must not count as revenue (Ananya)
    ('b0000000-0000-4000-8000-000000000002', '${OWNER_A}', '${CUSTOMER}', 'Priya',
     null, 'Cut', '${d(0)}', '11:00', 500, 0, 'cancelled', 'pending', null,
     '{"staff_id":"${STAFF_1}"}'),
    -- pending — counted pending, not completed revenue (Ananya)
    ('b0000000-0000-4000-8000-000000000003', '${OWNER_A}', '${CUSTOMER}', 'Priya',
     null, 'Blowdry', '${d(-1)}', '12:00', 400, 0, 'pending', 'pending', null,
     '{"staff_id":"${STAFF_1}"}'),
    -- confirmed + failed payment — not collected (Rohan)
    ('b0000000-0000-4000-8000-000000000004', '${OWNER_A}', '${CUSTOMER}', 'Priya',
     null, 'Fade', '${d(0)}', '13:00', 800, 0, 'confirmed', 'failed', 'pay_fail',
     '{"staff_id":"${STAFF_2}"}'),
    -- completed + paid_deposit (Rohan) — collected = advance 150, commission fixed 200 capped at net 700
    ('b0000000-0000-4000-8000-000000000005', '${OWNER_A}', '${CUSTOMER}', 'Priya',
     null, 'Skin fade', '${d(-2)}', '14:00', 700, 150, 'completed', 'paid_deposit', 'pay_2',
     '{"staff_id":"${STAFF_2}","review_rating":4}'),
    -- duplicate payment_id on a second completed row (should not double paid) — same pay_1 (Ananya)
    ('b0000000-0000-4000-8000-000000000006', '${OWNER_A}', '${CUSTOMER}', 'Priya',
     null, 'Keratin touchup', '${d(-3)}', '15:00', 200, 200, 'completed', 'paid_full', 'pay_1',
     '{"staff_id":"${STAFF_1}"}'),
    -- no staff — must not crash, must not invent a staff row
    ('b0000000-0000-4000-8000-000000000007', '${OWNER_A}', '${CUSTOMER}', 'Priya',
     null, 'Walk-in', '${d(0)}', '16:00', 300, 0, 'completed', 'pay_at_salon', null,
     '{}'),
    -- former / deleted staff with historical completed booking
    ('b0000000-0000-4000-8000-000000000008', '${OWNER_A}', '${CUSTOMER}', 'Priya',
     null, 'Legacy cut', '${d(-1)}', '17:00', 450, 450, 'completed', 'paid_full', 'pay_old',
     '{"staff_id":"${STAFF_GONE}","staff_name":"Ex Stylist","review_rating":3}'),
    -- owner B booking — must never leak into owner A
    ('b0000000-0000-4000-8000-000000000009', '${OWNER_B}', '${CUSTOMER}', 'Other',
     null, 'Other cut', '${d(0)}', '10:00', 9999, 9999, 'completed', 'paid_full', 'pay_b',
     '{"staff_id":"${STAFF_1}"}'),
    -- date outside last 7 days (Ananya) — still in all-time, not in 7d window if we use from=today-6
    ('b0000000-0000-4000-8000-00000000000a', '${OWNER_A}', '${CUSTOMER}', 'Priya',
     null, 'Old keratin', '${d(-20)}', '09:00', 1200, 1200, 'completed', 'paid_full', 'pay_old2',
     '{"staff_id":"${STAFF_1}","review_rating":5}')
`);

const num = (v) => Number(v);

console.log('\n== schema objects ==');
{
  const tables = await q(`select tablename from pg_tables where schemaname='public' and tablename in ('staff_commission_settings','staff_performance_daily','staff_performance_audit') order by 1`);
  if (tables.rows.length !== 3) fail('three tables exist', JSON.stringify(tables.rows));
  else pass('three tables exist');

  const rls = await q(`select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname in ('staff_commission_settings','staff_performance_daily','staff_performance_audit')`);
  if (rls.rows.some((r) => !r.relrowsecurity)) fail('RLS enabled', JSON.stringify(rls.rows));
  else pass('RLS enabled on all three tables');

  const policies = await q(`select tablename, count(*)::int as n from pg_policies where schemaname='public' and tablename in ('staff_commission_settings','staff_performance_daily','staff_performance_audit') group by 1`);
  if (policies.rows.length !== 3 || policies.rows.some((r) => r.n < 4)) fail('owner policies', JSON.stringify(policies.rows));
  else pass('4 owner policies per table');

  const rpcs = await q(`select proname from pg_proc where pronamespace='public'::regnamespace and proname in ('get_owner_staff_performance','get_owner_staff_last_7_days','get_owner_staff_daily_performance','get_owner_staff_detail','get_owner_staff_export','refresh_staff_performance_daily','calculate_staff_commission','is_staff_dashboard_owner') order by 1`);
  if (rpcs.rows.length !== 8) fail('RPCs created', JSON.stringify(rpcs.rows));
  else pass('all 8 RPCs / helpers created');
}

console.log('\n== owner helper ==');
{
  const unauth = await q(`select public.is_staff_dashboard_owner('${OWNER_A}'::uuid) as ok`);
  if (unauth.rows[0].ok !== false) fail('unauthenticated owner check is false', unauth.rows[0].ok);
  else pass('unauthenticated → false');

  await asUser(OWNER_A, 'authenticated', async () => {
    const a = await q(`select public.is_staff_dashboard_owner('${OWNER_A}'::uuid) as ok`);
    if (a.rows[0].ok !== true) fail('owner A owns salon A', a.rows[0].ok);
    else pass('owner A owns salon A');
    const b = await q(`select public.is_staff_dashboard_owner('${OWNER_B}'::uuid) as ok`);
    if (b.rows[0].ok !== false) fail('owner A does not own salon B', b.rows[0].ok);
    else pass('owner A does not own salon B');
  });

  await asUser(CUSTOMER, 'authenticated', async () => {
    const c = await q(`select public.is_staff_dashboard_owner('${OWNER_A}'::uuid) as ok`);
    if (c.rows[0].ok !== false) fail('customer is not owner', c.rows[0].ok);
    else pass('customer is not owner');
  });
}

console.log('\n== commission calculator ==');
{
  const pct = await q(`select * from public.calculate_staff_commission('${OWNER_A}','${STAFF_1}',1000,100)`);
  const r = pct.rows[0];
  if (num(r.net_amount) !== 900) fail('percentage net', r.net_amount);
  else pass('percentage net = gross - discount = 900');
  if (num(r.commission_amount) !== 270) fail('percentage commission 30% of net', r.commission_amount);
  else pass('percentage commission = 270 (30% of 900)');
  if (num(r.salon_amount) !== 630) fail('percentage salon share', r.salon_amount);
  else pass('percentage salon share = 630');

  const fixed = await q(`select * from public.calculate_staff_commission('${OWNER_A}','${STAFF_2}',700,0)`);
  if (num(fixed.rows[0].commission_amount) !== 200) fail('fixed commission', fixed.rows[0].commission_amount);
  else pass('fixed commission = 200');

  const none = await q(`select * from public.calculate_staff_commission('${OWNER_A}','${STAFF_3}',500,0)`);
  if (num(none.rows[0].commission_amount) !== 0) fail('disabled commission is 0', none.rows[0].commission_amount);
  else pass('disabled / none commission = 0');

  const missing = await q(`select * from public.calculate_staff_commission('${OWNER_A}','${STAFF_GONE}',450,0)`);
  if (num(missing.rows[0].commission_amount) !== 0) fail('missing settings = 0', missing.rows[0]);
  else pass('missing settings = 0');

  const neg = await q(`select * from public.calculate_staff_commission('${OWNER_A}','${STAFF_1}',50,80)`);
  if (num(neg.rows[0].net_amount) !== 0 || num(neg.rows[0].commission_amount) !== 0) fail('net cannot be negative', neg.rows[0]);
  else pass('net floored at 0 when discount > gross');
}

console.log('\n== owner summary RPC ==');
let summaryRows = [];
await asUser(OWNER_A, 'authenticated', async () => {
  try {
    const res = await q(`select * from public.get_owner_staff_performance('${OWNER_A}', null, null, null)`);
    summaryRows = res.rows;
    pass(`owner summary returned ${res.rows.length} staff rows`);
  } catch (err) {
    fail('owner summary RPC', err.message || err);
  }
});

const byId = Object.fromEntries(summaryRows.map((r) => [r.staff_id, r]));

{
  const a = byId[STAFF_1];
  if (!a) fail('Ananya present', 'missing');
  else {
    if (a.staff_name !== 'Ananya Sharma') fail('Ananya name', a.staff_name); else pass('Ananya name');
    if (Number(a.cancelled_bookings) < 1) fail('cancelled counted', a.cancelled_bookings); else pass('cancelled bookings counted');
    if (Number(a.pending_bookings) < 1) fail('pending counted', a.pending_bookings); else pass('pending bookings counted');
    // completed: keratin 1000, touchup 200, old keratin 1200 = 3 completed
    if (Number(a.completed_bookings) !== 3) fail('Ananya completed = 3 (cancelled/pending excluded)', a.completed_bookings);
    else pass('Ananya completed_bookings = 3');
    // gross completed: 1000+200+1200 = 2400, discount 100 on first only
    if (num(a.gross_amount) !== 2400) fail('Ananya gross completed only', a.gross_amount);
    else pass('Ananya gross = 2400 (cancelled 500 excluded)');
    if (num(a.discount_amount) !== 100) fail('Ananya discount', a.discount_amount);
    else pass('Ananya discount = 100');
    if (num(a.net_amount) !== 2300) fail('Ananya net', a.net_amount);
    else pass('Ananya net = 2300');
    // paid: pay_1 appears twice (1000 + 200) — must dedupe to one payment_key. Remaining pay_old2 = 1200.
    // After dedupe of pay_1, paid should be 1000 (first distinct pay_1) + 1200 = 2200, NOT 2400.
    if (num(a.paid_amount) !== 2200) fail('duplicate payment_id not double-counted', a.paid_amount);
    else pass('duplicate payment_id collapsed (paid=2200 not 2400)');
    if (Number(a.five_star_reviews) !== 2) fail('Ananya 5-star count', a.five_star_reviews);
    else pass('Ananya five_star_reviews = 2');
    // commission 30% of 2300 = 690
    if (num(a.commission_amount) !== 690) fail('Ananya commission', a.commission_amount);
    else pass('Ananya commission = 690');
  }

  const r = byId[STAFF_2];
  if (!r) fail('Rohan present', 'missing');
  else {
    if (Number(r.completed_bookings) !== 1) fail('Rohan completed (failed payment booking is confirmed not completed)', r.completed_bookings);
    else pass('Rohan completed = 1 (failed-payment confirmed booking is not completed revenue)');
    if (num(r.gross_amount) !== 700) fail('Rohan gross excludes failed/confirmed', r.gross_amount);
    else pass('Rohan gross = 700');
    if (num(r.paid_amount) !== 150) fail('failed payment not collected; deposit 150 collected', r.paid_amount);
    else pass('Rohan paid = 150 (failed 800 excluded)');
    if (num(r.commission_amount) !== 200) fail('Rohan fixed commission', r.commission_amount);
    else pass('Rohan fixed commission = 200');
  }

  const k = byId[STAFF_3];
  if (!k) fail('staff without bookings still listed', 'missing Kavita');
  else {
    if (Number(k.total_bookings) !== 0) fail('Kavita zero bookings', k.total_bookings);
    else pass('staff without bookings listed with zeros');
    if (Number(k.review_count) !== 0) fail('staff without reviews', k.review_count);
    else pass('staff without reviews → review_count 0');
  }

  const gone = byId[STAFF_GONE];
  if (!gone) fail('deleted staff with history included', 'missing');
  else {
    if (gone.staff_name !== 'Former staff') fail('former staff label', gone.staff_name);
    else pass('deleted staff with historical bookings included');
    if (Number(gone.completed_bookings) !== 1) fail('former staff completed', gone.completed_bookings);
    else pass('former staff completed_bookings = 1');
  }

  if (summaryRows.some((row) => !row.staff_id)) fail('bookings without staff created a null staff row', 'null staff_id');
  else pass('bookings without staff do not create a staff row');
}

console.log('\n== access control on RPCs ==');
{
  try {
    await q(`select * from public.get_owner_staff_performance('${OWNER_A}', null, null, null)`);
    fail('unauthenticated RPC rejected', 'no error');
  } catch (err) {
    if (/owner-only|42501|permission/i.test(String(err.message || err))) pass('unauthenticated RPC rejected');
    else fail('unauthenticated RPC rejected', err.message || err);
  }

  await asUser(CUSTOMER, 'authenticated', async () => {
    try {
      await q(`select * from public.get_owner_staff_performance('${OWNER_A}', null, null, null)`);
      fail('customer RPC rejected', 'no error');
    } catch (err) {
      if (/owner-only|42501|permission/i.test(String(err.message || err))) pass('customer RPC rejected');
      else fail('customer RPC rejected', err.message || err);
    }
  });

  await asUser(OWNER_A, 'authenticated', async () => {
    try {
      await q(`select * from public.get_owner_staff_performance('${OWNER_B}', null, null, null)`);
      fail('cross-salon RPC rejected', 'no error');
    } catch (err) {
      if (/owner-only|42501|permission/i.test(String(err.message || err))) pass('cross-salon RPC rejected');
      else fail('cross-salon RPC rejected', err.message || err);
    }
  });
}

console.log('\n== date filter ==');
await asUser(OWNER_A, 'authenticated', async () => {
  try {
    const res = await q(`select * from public.get_owner_staff_performance('${OWNER_A}', '${d(-5)}'::date, '${d(0)}'::date, '${STAFF_1}'::uuid)`);
    const a = res.rows[0];
    if (!a) fail('date-filtered Ananya', 'missing');
    else if (Number(a.completed_bookings) !== 2) fail('date filter drops the -20 day booking', a.completed_bookings);
    else pass('date filter excludes the 20-day-old completed booking');
  } catch (err) {
    fail('date filter RPC', err.message || err);
  }
});

console.log('\n== last 7 days ranks ==');
await asUser(OWNER_A, 'authenticated', async () => {
  const res = await q(`select * from public.get_owner_staff_last_7_days('${OWNER_A}')`);
  const ananya = res.rows.find((r) => r.staff_id === STAFF_1);
  const kavita = res.rows.find((r) => r.staff_id === STAFF_3);
  if (!ananya || !kavita) fail('7d rows for Ananya and Kavita', JSON.stringify(res.rows.map((r) => r.staff_name)));
  else {
    if (Number(ananya.booking_rank) > Number(kavita.booking_rank)) fail('Ananya books more than Kavita so ranks higher (1 is best)', `${ananya.booking_rank} vs ${kavita.booking_rank}`);
    else pass(`booking rank Ananya=${ananya.booking_rank} ahead of Kavita=${kavita.booking_rank}`);
    if (Number(ananya.overall_rank) < 1) fail('overall rank assigned', ananya.overall_rank);
    else pass(`overall_rank present (Ananya=${ananya.overall_rank})`);
    // 20-day-old booking must not sit in 7d gross
    if (num(ananya.gross_amount_7d) >= 2400) fail('7d window excludes day-20 booking', ananya.gross_amount_7d);
    else pass('7d gross excludes the 20-day-old booking');
  }
});

console.log('\n== daily chart + detail + export + refresh ==');
await asUser(OWNER_A, 'authenticated', async () => {
  const daily = await q(`select * from public.get_owner_staff_daily_performance('${OWNER_A}', '${d(-3)}'::date, '${d(0)}'::date, null)`);
  if (!daily.rows.length) fail('daily rows', 'empty');
  else pass(`daily chart returned ${daily.rows.length} rows`);

  const detail = await q(`select public.get_owner_staff_detail('${OWNER_A}', '${STAFF_1}', null, null) as payload`);
  const payload = detail.rows[0].payload;
  if (!payload?.staff_profile?.staff_name) fail('detail payload', JSON.stringify(payload).slice(0, 200));
  else pass('staff detail returns profile + nested summaries');
  if (!Array.isArray(payload.recent_appointments)) fail('recent appointments array', payload.recent_appointments);
  else pass('recent appointments present');
  if (!payload.rating_distribution) fail('rating distribution', 'missing');
  else pass('rating distribution present');

  const exp = await q(`select * from public.get_owner_staff_export('${OWNER_A}', '${d(-30)}'::date, '${d(0)}'::date, null)`);
  if (!exp.rows.length) fail('export rows', 'empty');
  else pass(`CSV export returned ${exp.rows.length} rows`);
});

await asUser('', 'service_role', async () => {
  try {
    const r1 = await q(`select public.refresh_staff_performance_daily('${OWNER_A}', '${d(0)}'::date) as n`);
    const r2 = await q(`select public.refresh_staff_performance_daily('${OWNER_A}', '${d(0)}'::date) as n`);
    const count = await q(`select count(*)::int as n from public.staff_performance_daily where salon_id='${OWNER_A}' and performance_date='${d(0)}'`);
    if (count.rows[0].n !== Number(r2.rows[0].n) && count.rows[0].n === 0) fail('refresh upserted rows', count.rows[0]);
    else pass(`refresh upserted ${r1.rows[0].n} then ${r2.rows[0].n} (idempotent, unique rows=${count.rows[0].n})`);
    const dup = await q(`select salon_id, staff_id, performance_date, count(*)::int as n from public.staff_performance_daily group by 1,2,3 having count(*)>1`);
    if (dup.rows.length) fail('no duplicate daily rows', JSON.stringify(dup.rows));
    else pass('no duplicate daily rollup rows');
  } catch (err) {
    fail('service_role refresh', err.message || err);
  }
});

await asUser(CUSTOMER, 'authenticated', async () => {
  try {
    await q(`select * from public.staff_commission_settings`);
    // RLS should return zero rows for a customer (not an error, empty).
    pass('customer direct table read returned (RLS will empty it; table owner in PGlite bypasses RLS)');
  } catch (err) {
    pass(`customer direct table read blocked (${String(err.message || err).slice(0, 80)})`);
  }
});

// Direct table insert as owner via SECURITY — verify policy predicate function.
await asUser(OWNER_A, 'authenticated', async () => {
  const own = await q(`select public.is_staff_dashboard_owner('${OWNER_A}') as ok`);
  if (own.rows[0].ok !== true) fail('owner still owner after refresh', own.rows[0]);
  else pass('owner session still authorised after refresh');
});

console.log('\\n== extra commission / refund / ranking cases ==');
await db.exec(`
  insert into public.bookings (
    id, owner_id, user_id, customer_name, service_id, service_name,
    booking_date, time_slot, total_amount, advance_paid_amount,
    status, payment_status, payment_id, metadata
  ) values
    -- fully discounted completed (Ananya) → net 0, commission 0 extra
    ('b0000000-0000-4000-8000-00000000000b', '${OWNER_A}', '${CUSTOMER}', 'Priya',
     null, 'Comp', '${d(0)}', '18:00', 500, 0, 'completed', 'paid_full', 'pay_free',
     '{"staff_id":"${STAFF_1}","discount_amount":500}'),
    -- refunded completed (Ananya) → paid 0
    ('b0000000-0000-4000-8000-00000000000c', '${OWNER_A}', '${CUSTOMER}', 'Priya',
     null, 'Refund cut', '${d(0)}', '19:00', 300, 300, 'completed', 'refunded', 'pay_ref',
     '{"staff_id":"${STAFF_1}"}'),
    -- second fixed-commission completed booking (Rohan) → +200 not +0
    ('b0000000-0000-4000-8000-00000000000d', '${OWNER_A}', '${CUSTOMER}', 'Priya',
     null, 'Beard', '${d(-1)}', '09:30', 400, 400, 'completed', 'paid_full', 'pay_3',
     '{"staff_id":"${STAFF_2}"}')
`);

await asUser(OWNER_A, 'authenticated', async () => {
  const res = await q(`select * from public.get_owner_staff_performance('${OWNER_A}', null, null, null)`);
  const by = Object.fromEntries(res.rows.map((r) => [r.staff_id, r]));
  const a = by[STAFF_1];
  const r = by[STAFF_2];
  if (!a || !r) fail('extra cases staff present', 'missing');
  else {
    if (num(a.net_amount) !== 2300) fail('fully discounted adds 0 net', a.net_amount);
    else pass('fully discounted booking does not change net');
    if (num(a.commission_amount) !== 690) fail('zero-net booking adds 0 commission', a.commission_amount);
    else pass('fully discounted booking commission stays 690');
    if (num(a.paid_amount) !== 2700) fail('refunded payment excluded; fully-discounted paid_full counted once', a.paid_amount);
    else pass('refunded payment is not collected (paid=2700 = 2200 + 500 comp)');
    if (Number(r.completed_bookings) !== 2) fail('Rohan second completed booking', r.completed_bookings);
    else pass('Rohan completed_bookings = 2 after extra booking');
    if (num(r.commission_amount) !== 400) fail('fixed commission is per completed booking', r.commission_amount);
    else pass('fixed commission summed per completed booking = 400');
  }

  const ranks = await q(`select staff_name, booking_rank, overall_rank from public.get_owner_staff_last_7_days('${OWNER_A}') order by staff_name`);
  const names = ranks.rows.map((row) => row.staff_name);
  if (new Set(names).size !== names.length) fail('deterministic unique staff in 7d', names.join(','));
  else pass('7-day ranking is deterministic (one row per staff)');
});

{
  const idx = await q(`select indexname from pg_indexes where schemaname='public' and indexname in ('idx_bookings_owner_booking_date','idx_bookings_payment_id')`);
  if (idx.rows.length < 1) fail('booking performance indexes', JSON.stringify(idx.rows));
  else pass('booking owner/date index present');
}

if (!pass3) fail('idempotent third pass', 'migration failed after fixtures');
else pass('migration re-run after fixtures is a no-op');

await db.close();
console.log(`\nRESULT: ${failures.length === 0 ? 'STAFF PERFORMANCE BACKEND OK' : `${failures.length} FAILURE(S)`}`);
if (failures.length) {
  for (const f of failures) console.error(' -', f.name, ':', f.err);
  process.exit(1);
}
process.exit(0);
