// Local PostgreSQL validation of
// supabase/migrations/20260909_staff_commission_payouts.sql
// Requires 20260908_staff_performance_dashboard_backend.sql first.
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const PHASE2 = 'supabase/migrations/20260908_staff_performance_dashboard_backend.sql';
const PHASE5 = 'supabase/migrations/20260909_staff_commission_payouts.sql';
const sql5 = fs.readFileSync(PHASE5, 'utf8');

const OWNER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CUSTOMER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STAFF_1 = '11111111-1111-4111-8111-111111111111';
const STAFF_2 = '22222222-2222-4222-8222-222222222222';
const STAFF_3 = '33333333-3333-4333-8333-333333333333';

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

console.log('\n— Staff commission payouts validation —');

const baseline = await runFile('supabase/migrations/00001_init.sql', { tolerateAuth: true });
console.log(`[baseline 00001] ran=${baseline.ran} tolerated=${baseline.tolerated} failed=${baseline.failed}`);
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

const phase2 = await runFile(PHASE2, { tolerateAuth: true });
console.log(`[phase2] ran=${phase2.ran} tolerated=${phase2.tolerated} failed=${phase2.failed}`);
if (phase2.failed) {
  for (const f of phase2.list) console.error('  ', f.stmt, '→', f.err);
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
    ('c0000000-0000-4000-8000-000000000001', '${OWNER_A}', '${CUSTOMER}', 'Priya',
     null, 'Keratin', '${d(0)}', '10:00', 1000, 1000, 'completed', 'paid_full', 'pay_1',
     '{"staff_id":"${STAFF_1}","discount_amount":100}'),
    ('c0000000-0000-4000-8000-000000000002', '${OWNER_A}', '${CUSTOMER}', 'Priya',
     null, 'Cut', '${d(0)}', '11:00', 500, 0, 'cancelled', 'pending', null,
     '{"staff_id":"${STAFF_1}"}'),
    ('c0000000-0000-4000-8000-000000000003', '${OWNER_A}', '${CUSTOMER}', 'Priya',
     null, 'Skin fade', '${d(0)}', '14:00', 700, 700, 'completed', 'paid_full', 'pay_2',
     '{"staff_id":"${STAFF_2}"}'),
    ('c0000000-0000-4000-8000-000000000004', '${OWNER_A}', '${CUSTOMER}', 'Priya',
     null, 'Fail cut', '${d(0)}', '15:00', 800, 0, 'completed', 'failed', 'pay_fail',
     '{"staff_id":"${STAFF_1}"}'),
    ('c0000000-0000-4000-8000-000000000005', '${OWNER_A}', '${CUSTOMER}', 'Priya',
     null, 'Refund cut', '${d(0)}', '16:00', 300, 300, 'completed', 'refunded', 'pay_ref',
     '{"staff_id":"${STAFF_1}"}'),
    ('c0000000-0000-4000-8000-000000000006', '${OWNER_B}', '${CUSTOMER}', 'Other',
     null, 'Other cut', '${d(0)}', '10:00', 9999, 9999, 'completed', 'paid_full', 'pay_b',
     '{"staff_id":"${STAFF_1}"}')
`);

const pass1 = await runSqlFileOnce('phase5-pass-1', sql5);
const pass2 = await runSqlFileOnce('phase5-pass-2', sql5);
if (!pass1 || !pass2) {
  console.error('Phase 5 migration did not apply cleanly.');
  process.exit(1);
}

const num = (v) => Number(v);

console.log('\n== schema ==');
{
  const tables = await q(`select tablename from pg_tables where schemaname='public' and tablename in ('staff_commission_settings','staff_commission_payouts','staff_performance_audit')`);
  if (tables.rows.length !== 3) fail('reuse settings + audit; new payouts', JSON.stringify(tables.rows));
  else pass('staff_commission_payouts created; settings/audit reused');

  const dup = await q(`select tablename from pg_tables where schemaname='public' and tablename like '%commission%'`);
  const names = dup.rows.map((r) => r.tablename).sort();
  if (names.join(',') !== 'staff_commission_payouts,staff_commission_settings') {
    fail('no duplicate commission tables', names.join(','));
  } else pass('no duplicate commission tables');

  const cols = await q(`select column_name from information_schema.columns where table_schema='public' and table_name='staff_commission_settings' and column_name in ('effective_from','effective_to','notes')`);
  if (cols.rows.length !== 3) fail('version columns', JSON.stringify(cols.rows));
  else pass('effective_from / effective_to / notes on settings');

  const rls = await q(`select relrowsecurity from pg_class where relname='staff_commission_payouts'`);
  if (!rls.rows[0]?.relrowsecurity) fail('payouts RLS', rls.rows[0]);
  else pass('payouts RLS enabled');
}

console.log('\n== as-of commission ==');
{
  const pct = await q(`select * from public.calculate_staff_commission('${OWNER_A}','${STAFF_1}',1000,100)`);
  if (num(pct.rows[0].commission_amount) !== 270) fail('percentage still 30% of net', pct.rows[0]);
  else pass('percentage commission = 270');

  const fixed = await q(`select * from public.calculate_staff_commission('${OWNER_A}','${STAFF_2}',700,0)`);
  if (num(fixed.rows[0].commission_amount) !== 200) fail('fixed', fixed.rows[0]);
  else pass('fixed commission = 200');

  const none = await q(`select * from public.calculate_staff_commission('${OWNER_A}','${STAFF_3}',500,0)`);
  if (num(none.rows[0].commission_amount) !== 0) fail('none', none.rows[0]);
  else pass('none / disabled = 0');
}

console.log('\n== versioned settings ==');
await asUser(OWNER_A, 'authenticated', async () => {
  try {
    const before = await q(`select commission_rate, effective_to is null as open from public.staff_commission_settings where staff_id='${STAFF_1}'`);
    const oldRate = before.rows.find((r) => r.open)?.commission_rate;
    await q(`select public.upsert_staff_commission_setting('${OWNER_A}','${STAFF_1}','percentage',40,0,true,current_date,'raise to 40')`);
    const after = await q(`select commission_rate, effective_to, notes, is_enabled from public.staff_commission_settings where staff_id='${STAFF_1}' order by created_at`);
    const closed = after.rows.filter((r) => r.effective_to != null);
    const open = after.rows.filter((r) => r.effective_to == null);
    if (closed.length < 1) fail('old setting closed', JSON.stringify(after.rows));
    else if (num(closed[0].commission_rate) !== num(oldRate)) fail('old rate mutated', closed[0]);
    else pass('old setting closed; rate unchanged');
    if (open.length !== 1 || num(open[0].commission_rate) !== 40) fail('one active 40% row', JSON.stringify(open));
    else pass('one active setting at 40%');

    try {
      await q(`select public.upsert_staff_commission_setting('${OWNER_A}','${STAFF_1}','percentage',50,0,true,(current_date - 1),'past')`);
      fail('past effective_from rejected', 'no error');
    } catch (err) {
      if (/past|22023/i.test(String(err.message || err))) pass('past effective_from rejected');
      else fail('past effective_from rejected', err.message || err);
    }

    const hist = await q(`select * from public.calculate_staff_commission('${OWNER_A}','${STAFF_1}',1000,100,(current_date - 1))`);
    if (num(hist.rows[0].commission_amount) !== 270) fail('yesterday still 30%', hist.rows[0]);
    else pass('as-of yesterday still uses 30%');
    const today = await q(`select * from public.calculate_staff_commission('${OWNER_A}','${STAFF_1}',1000,100,current_date)`);
    if (num(today.rows[0].commission_amount) !== 360) fail('today uses 40%', today.rows[0]);
    else pass('as-of today uses 40% (360)');
  } catch (err) {
    fail('versioned upsert', err.message || err);
  }
});

console.log('\n== payout summary + mutations ==');
await asUser(OWNER_A, 'authenticated', async () => {
  try {
    const sum = await q(`select * from public.get_staff_payout_summary('${OWNER_A}', '${d(0)}'::date, '${d(0)}'::date, null)`);
    const by = Object.fromEntries(sum.rows.map((r) => [r.staff_id, r]));
    const a = by[STAFF_1];
    const r = by[STAFF_2];
    if (!a || !r) fail('summary staff', Object.keys(by).join(','));
    else {
      // Ananya today: completed keratin 900 net * 40% = 360. Cancelled/failed/refunded excluded.
      if (Number(a.completed_bookings) !== 1) fail('Ananya completed excludes cancelled/refunded', a.completed_bookings);
      else pass('Ananya completed_bookings = 1 (cancelled/refunded excluded)');
      if (num(a.commission_amount) !== 360) fail('Ananya today commission 40% of 900', a.commission_amount);
      else pass('Ananya commission = 360');
      if (num(r.commission_amount) !== 200) fail('Rohan fixed', r.commission_amount);
      else pass('Rohan commission = 200');
    }

    const id = await q(`select public.approve_staff_payout('${OWNER_A}','${STAFF_1}','${d(0)}'::date,'${d(0)}'::date,'ok') as id`);
    const payoutId = id.rows[0].id;
    if (!payoutId) fail('approve returns id', id.rows[0]);
    else pass('approve_staff_payout returns id');

    const again = await q(`select public.approve_staff_payout('${OWNER_A}','${STAFF_1}','${d(0)}'::date,'${d(0)}'::date,'ok') as id`);
    if (String(again.rows[0].id) !== String(payoutId)) fail('approve is idempotent while approved', again.rows[0]);
    else pass('re-approve of approved payout is idempotent');

    await q(`select public.mark_staff_payout_paid('${OWNER_A}','${payoutId}','NEFT-1','paid')`);
    pass('mark paid');

    try {
      await q(`select public.mark_staff_payout_paid('${OWNER_A}','${payoutId}','NEFT-2','again')`);
      fail('duplicate paid blocked', 'no error');
    } catch (err) {
      if (/paid again|P0001/i.test(String(err.message || err))) pass('duplicate paid blocked');
      else fail('duplicate paid blocked', err.message || err);
    }

    try {
      await q(`select public.approve_staff_payout('${OWNER_A}','${STAFF_1}','${d(0)}'::date,'${d(0)}'::date,'again')`);
      fail('paid cannot be approved again', 'no error');
    } catch (err) {
      if (/Paid payout|P0001/i.test(String(err.message || err))) pass('paid cannot be approved again');
      else fail('paid cannot be approved again', err.message || err);
    }

    const hist = await q(`select * from public.get_staff_payout_history('${OWNER_A}', null, null, '${STAFF_1}', 'paid')`);
    if (!hist.rows.length || hist.rows[0].reference_number !== 'NEFT-1') fail('paid history', hist.rows[0]);
    else pass('paid history includes reference');

    const audit = await q(`select event_type from public.staff_performance_audit where salon_id='${OWNER_A}' and event_type in ('payout_approve','payout_paid','commission_setting_insert')`);
    const types = new Set(audit.rows.map((row) => row.event_type));
    if (!types.has('payout_approve') || !types.has('payout_paid') || !types.has('commission_setting_insert')) {
      fail('audit events', [...types].join(','));
    } else pass('audit written for setting + approve + paid');

    const rohanId = await q(`select public.approve_staff_payout('${OWNER_A}','${STAFF_2}','${d(0)}'::date,'${d(0)}'::date,'r') as id`);
    await q(`select public.cancel_staff_payout('${OWNER_A}','${rohanId.rows[0].id}','changed mind')`);
    const cancelled = await q(`select status from public.staff_commission_payouts where id='${rohanId.rows[0].id}'`);
    if (cancelled.rows[0].status !== 'cancelled') fail('cancel status', cancelled.rows[0]);
    else pass('cancel_staff_payout sets cancelled');
  } catch (err) {
    fail('payout flow', err.message || err);
  }
});

console.log('\n== access control ==');
{
  try {
    await q(`select * from public.get_staff_payout_summary('${OWNER_A}', '${d(0)}'::date, '${d(0)}'::date, null)`);
    fail('unauthenticated payout RPC rejected', 'no error');
  } catch (err) {
    if (/owner-only|42501|permission/i.test(String(err.message || err))) pass('unauthenticated payout RPC rejected');
    else fail('unauthenticated payout RPC rejected', err.message || err);
  }

  await asUser(CUSTOMER, 'authenticated', async () => {
    try {
      await q(`select * from public.get_staff_commission_settings('${OWNER_A}', null)`);
      fail('customer settings RPC rejected', 'no error');
    } catch (err) {
      if (/owner-only|42501|permission/i.test(String(err.message || err))) pass('customer settings RPC rejected');
      else fail('customer settings RPC rejected', err.message || err);
    }
  });

  await asUser(OWNER_A, 'authenticated', async () => {
    try {
      await q(`select * from public.get_staff_payout_summary('${OWNER_B}', '${d(0)}'::date, '${d(0)}'::date, null)`);
      fail('cross-salon payout rejected', 'no error');
    } catch (err) {
      if (/owner-only|42501|permission/i.test(String(err.message || err))) pass('cross-salon payout rejected');
      else fail('cross-salon payout rejected', err.message || err);
    }
  });
}

{
  const sql = fs.readFileSync(PHASE5, 'utf8');
  if (/create table if not exists public.staff_commission_settings/i.test(sql)) {
    fail('phase 5 does not recreate settings table', 'found create table settings');
  } else pass('phase 5 reuses staff_commission_settings');
}

await db.close();
console.log(`\nRESULT: ${failures.length === 0 ? 'STAFF COMMISSION PAYOUTS OK' : `${failures.length} FAILURE(S)`}`);
if (failures.length) {
  for (const f of failures) console.error(' -', f.name, ':', f.err);
  process.exit(1);
}
process.exit(0);
