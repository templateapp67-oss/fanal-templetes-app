// Local PostgreSQL validation of
// supabase/migrations/20260910_staff_performance_notifications.sql
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const PHASE2 = 'supabase/migrations/20260908_staff_performance_dashboard_backend.sql';
const PHASE5 = 'supabase/migrations/20260909_staff_commission_payouts.sql';
const PHASE6 = 'supabase/migrations/20260910_staff_performance_notifications.sql';
const sql6 = fs.readFileSync(PHASE6, 'utf8');

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

console.log('\n— Staff performance notifications validation —');

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
const phase5 = await runFile(PHASE5, { tolerateAuth: true });
console.log(`[phase5] ran=${phase5.ran} tolerated=${phase5.tolerated} failed=${phase5.failed}`);
if (phase5.failed) {
  for (const f of phase5.list) console.error('  ', f.stmt, '→', f.err);
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
    ('c0000000-0000-4000-8000-000000000001', '${OWNER_A}', '${CUSTOMER}', 'Priya Sharma',
     null, 'Keratin', '${d(0)}', '10:00', 1000, 1000, 'completed', 'paid_full', 'pay_1',
     '{"staff_id":"${STAFF_1}","discount_amount":100,"review_rating":5}'),
    ('c0000000-0000-4000-8000-000000000002', '${OWNER_A}', '${CUSTOMER}', 'Priya Sharma',
     null, 'Cut', '${d(0)}', '11:00', 500, 0, 'cancelled', 'pending', null,
     '{"staff_id":"${STAFF_1}"}'),
    ('c0000000-0000-4000-8000-000000000003', '${OWNER_A}', '${CUSTOMER}', 'Priya Sharma',
     null, 'Skin fade', '${d(0)}', '14:00', 700, 700, 'completed', 'paid_full', 'pay_2',
     '{"staff_id":"${STAFF_2}","review_rating":4}'),
    ('c0000000-0000-4000-8000-000000000004', '${OWNER_A}', '${CUSTOMER}', 'Priya Sharma',
     null, 'Fail cut', '${d(0)}', '15:00', 800, 0, 'completed', 'failed', 'pay_fail',
     '{"staff_id":"${STAFF_1}"}'),
    ('c0000000-0000-4000-8000-000000000005', '${OWNER_A}', '${CUSTOMER}', 'Priya Sharma',
     null, 'Refund cut', '${d(0)}', '16:00', 300, 300, 'completed', 'refunded', 'pay_ref',
     '{"staff_id":"${STAFF_1}"}'),
    ('c0000000-0000-4000-8000-000000000006', '${OWNER_B}', '${CUSTOMER}', 'Other Client',
     null, 'Other cut', '${d(-20)}', '10:00', 9999, 9999, 'completed', 'paid_full', 'pay_b',
     '{"staff_id":"${STAFF_1}"}')
`);

const pass1 = await runSqlFileOnce('phase6-pass-1', sql6);
const pass2 = await runSqlFileOnce('phase6-pass-2', sql6);
if (!pass1 || !pass2) {
  console.error('Phase 6 migration did not apply cleanly.');
  process.exit(1);
}

console.log('\n== schema ==');
{
  const tables = await q(`select tablename from pg_tables where schemaname='public' and tablename in ('staff_performance_notifications','staff_weekly_reports','notification_preferences','in_app_notifications')`);
  const names = tables.rows.map((r) => r.tablename).sort();
  if (!names.includes('staff_performance_notifications') || !names.includes('staff_weekly_reports') || !names.includes('notification_preferences')) {
    fail('phase 6 tables', names.join(','));
  } else pass('alerts + weekly reports + notification_preferences');
  if (!names.includes('in_app_notifications')) fail('did not drop in_app_notifications', names.join(','));
  else pass('existing in_app_notifications left in place');

  const rls = await q(`select relname, relrowsecurity from pg_class where relname in ('staff_performance_notifications','staff_weekly_reports','notification_preferences')`);
  if (rls.rows.some((r) => !r.relrowsecurity)) fail('RLS', JSON.stringify(rls.rows));
  else pass('RLS enabled on new tables');
}

console.log('\n== access control ==');
{
  try {
    await q(`select * from public.get_owner_staff_notifications('${OWNER_A}')`);
    fail('unauthenticated notifications rejected', 'no error');
  } catch (err) {
    if (/owner-only|42501|permission/i.test(String(err.message || err))) pass('unauthenticated notifications rejected');
    else fail('unauthenticated notifications rejected', err.message || err);
  }

  await asUser(CUSTOMER, 'authenticated', async () => {
    try {
      await q(`select * from public.get_owner_staff_notifications('${OWNER_A}')`);
      fail('customer notifications rejected', 'no error');
    } catch (err) {
      if (/owner-only|42501|permission/i.test(String(err.message || err))) pass('customer notifications rejected');
      else fail('customer notifications rejected', err.message || err);
    }
  });

  await asUser(OWNER_A, 'authenticated', async () => {
    try {
      await q(`select * from public.get_owner_staff_notifications('${OWNER_B}')`);
      fail('cross-salon notifications rejected', 'no error');
    } catch (err) {
      if (/owner-only|42501|permission/i.test(String(err.message || err))) pass('cross-salon notifications rejected');
      else fail('cross-salon notifications rejected', err.message || err);
    }
  });

  await asUser(OWNER_A, 'authenticated', async () => {
    try {
      await q(`select public.run_staff_weekly_reports_job()`);
      fail('owner cannot run service job', 'no error');
    } catch (err) {
      if (/service-role-only|42501|permission/i.test(String(err.message || err))) pass('owner cannot run service job');
      else fail('owner cannot run service job', err.message || err);
    }
  });
}

console.log('\n== weekly report + ranking ==');
await asUser(OWNER_A, 'authenticated', async () => {
  try {
    const id1 = await q(`select public.generate_staff_weekly_report('${OWNER_A}', current_date) as id`);
    const id2 = await q(`select public.generate_staff_weekly_report('${OWNER_A}', current_date) as id`);
    if (String(id1.rows[0].id) !== String(id2.rows[0].id)) fail('duplicate generate returns same id', `${id1.rows[0].id} vs ${id2.rows[0].id}`);
    else pass('duplicate generate is idempotent');

    const count = await q(`select count(*)::int as n from public.staff_weekly_reports where salon_id='${OWNER_A}' and report_period_end = current_date`);
    if (count.rows[0].n !== 1) fail('one weekly row per period', count.rows[0].n);
    else pass('one weekly row per salon period');

    const report = await q(`select public.get_owner_weekly_staff_report('${OWNER_A}', current_date) as payload`);
    const payload = report.rows[0].payload;
    const data = payload.report_data;
    const blob = JSON.stringify(data).toLowerCase();
    if (blob.includes('"customer_name"') || blob.includes('priya') || blob.includes('email')) {
      fail('weekly report has no customer PII', blob.slice(0, 200));
    } else pass('weekly report has no customer PII');

    const bookingLeader = data?.leaders?.booking?.staff_name || '';
    if (!/ananya/i.test(bookingLeader)) fail('booking leader Ananya', bookingLeader);
    else pass('booking leader is Ananya');
    if (data.has_activity !== true) fail('has_activity', data.has_activity);
    else pass('week with bookings is marked active');
  } catch (err) {
    fail('weekly report ranking', err.message || err);
  }
});

console.log('\n== empty week + retry ==');
await asUser(OWNER_B, 'authenticated', async () => {
  try {
    await q(`select public.generate_staff_weekly_report('${OWNER_B}', current_date)`);
    const report = await q(`select public.get_owner_weekly_staff_report('${OWNER_B}', current_date) as payload`);
    const data = report.rows[0].payload.report_data;
    if (data.has_activity === true) fail('owner B empty week', JSON.stringify(data.leaders));
    else pass('empty week has_activity = false');
  } catch (err) {
    fail('empty week', err.message || err);
  }
});

{
  const pastEnd = d(-20);
  await db.exec(`
    insert into public.staff_weekly_reports (
      salon_id, report_period_start, report_period_end, report_data, generation_status, attempt_count, last_error
    ) values (
      '${OWNER_A}', ('${pastEnd}'::date - 6), '${pastEnd}'::date, '{}'::jsonb, 'failed', 1, 'synthetic failure'
    )
    on conflict (salon_id, report_period_start, report_period_end) do update set
      generation_status = 'failed', last_error = 'synthetic failure', attempt_count = 1
  `);
  await asUser(OWNER_A, 'authenticated', async () => {
    try {
      await q(`select public.generate_staff_weekly_report('${OWNER_A}', '${pastEnd}'::date)`);
      const row = await q(`select generation_status, attempt_count, last_error from public.staff_weekly_reports where salon_id='${OWNER_A}' and report_period_end='${pastEnd}'::date`);
      if (row.rows[0].generation_status !== 'ready') fail('retry sets ready', row.rows[0]);
      else if (Number(row.rows[0].attempt_count) < 2) fail('retry increments attempt_count', row.rows[0]);
      else pass('failed generation retries to ready');
    } catch (err) {
      fail('retry failed generation', err.message || err);
    }
  });
}

console.log('\n== alerts + read status ==');
await asUser(OWNER_A, 'authenticated', async () => {
  try {
    await q(`select public.refresh_staff_performance_alerts('${OWNER_A}')`);
    const again = await q(`select public.refresh_staff_performance_alerts('${OWNER_A}')`);
    if (Number(again.rows[0].refresh_staff_performance_alerts) !== 0) {
      fail('alert refresh is idempotent', again.rows[0]);
    } else pass('second alert refresh inserts 0 (deduped)');

    const notes = await q(`select * from public.get_owner_staff_notifications('${OWNER_A}')`);
    const types = new Set(notes.rows.map((r) => r.notification_type));
    if (!types.has('low_bookings')) fail('low bookings alert', [...types].join(','));
    else pass('low_bookings alert present');
    if (!types.has('refund_affects_commission')) fail('refund alert', [...types].join(','));
    else pass('refund_affects_commission alert present');
    if (!types.has('top_payment')) fail('top payment alert', [...types].join(','));
    else pass('top_payment alert present');
    if (notes.rows.some((r) => String(r.message).toLowerCase().includes('priya'))) {
      fail('alerts omit customer names', notes.rows[0].message);
    } else pass('alerts omit customer names');

    const unreadBefore = notes.rows.filter((r) => r.is_read === false).length;
    const one = notes.rows[0];
    await q(`select public.mark_staff_notification_read('${OWNER_A}', '${one.id}')`);
    const afterOne = await q(`select is_read from public.staff_performance_notifications where id='${one.id}'`);
    if (afterOne.rows[0].is_read !== true) fail('mark one read', afterOne.rows[0]);
    else pass('mark_staff_notification_read');

    const n = await q(`select public.mark_all_staff_notifications_read('${OWNER_A}') as n`);
    const left = await q(`select count(*)::int as n from public.staff_performance_notifications where salon_id='${OWNER_A}' and is_read=false`);
    if (left.rows[0].n !== 0) fail('mark all read', left.rows[0]);
    else pass('mark_all_staff_notifications_read');
    if (unreadBefore < 1) fail('had unread before mark', unreadBefore);
  } catch (err) {
    fail('alerts + read', err.message || err);
  }
});

console.log('\n== prefs + cron job ==');
await asUser(OWNER_A, 'authenticated', async () => {
  try {
    const prefs = await q(`select public.update_staff_notification_preferences('${OWNER_A}', '{"low_bookings": false, "bogus": true}'::jsonb) as alerts`);
    if (prefs.rows[0].alerts.low_bookings !== false) fail('prefs persist', prefs.rows[0].alerts);
    else if (prefs.rows[0].alerts.bogus) fail('unknown pref keys stripped', prefs.rows[0].alerts);
    else pass('notification preferences stored without unknown keys');
  } catch (err) {
    fail('prefs', err.message || err);
  }
});

await asUser('', 'service_role', async () => {
  try {
    const trusted = await q(`select public.staff_dashboard_is_trusted_server() as t, auth.role() as role`);
    const n = await q(`select public.run_staff_weekly_reports_job() as n`);
    if (Number(n.rows[0].n) < 1) fail('cron job generates for salons', JSON.stringify({ n: n.rows[0], trusted: trusted.rows[0] }));
    else pass('service_role weekly job runs');
    const dup = await q(`select count(*)::int as n from public.staff_weekly_reports where salon_id='${OWNER_A}' and report_period_end=current_date`);
    if (dup.rows[0].n !== 1) fail('job does not duplicate weekly rows', dup.rows[0].n);
    else pass('job does not duplicate weekly rows');
  } catch (err) {
    fail('cron job', err.message || err);
  }
});

{
  const sql = fs.readFileSync(PHASE6, 'utf8');
  if (/in_app_notifications/.test(sql) && /drop table.*in_app_notifications/i.test(sql)) {
    fail('must not drop in_app_notifications', 'drop found');
  } else pass('migration does not drop in_app_notifications');
  if (!/pg_cron/.test(sql) || !/run_staff_weekly_reports_job/.test(sql)) {
    fail('optional pg_cron wrapper', 'missing');
  } else pass('optional pg_cron wrapper around weekly job');
}

await db.close();
console.log(`\nRESULT: ${failures.length === 0 ? 'STAFF PERFORMANCE NOTIFICATIONS OK' : `${failures.length} FAILURE(S)`}`);
if (failures.length) {
  for (const f of failures) console.error(' -', f.name, ':', f.err);
  process.exit(1);
}
process.exit(0);
