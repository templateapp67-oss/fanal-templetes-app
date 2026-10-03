// ============================================================================
// 20261103000000_salon_booking_settings_advance_25.sql, executed against a real
// Postgres engine (PGlite) instead of asserted with regular expressions.
//
// Existence of the trigger and the constraint is NOT proof the flows work —
// that was exactly the gap after the hand-applied hotfix reported
// trigger_status = PASS / constraint_status = PASS. So this file writes rows:
// valid 25 writes, and 0 / null / 20 / 999 writes that must come out as 25.
//
// Three shapes are exercised, because `salon_booking_settings` has existed in
// more than one:
//   A. the reported production shape — three advance columns, a
//      `salon_booking_settings_deposit_25_check` added NOT VALID over rows that
//      already held 0 / 20 / null, an unrelated check and an owner-written RLS
//      policy that must survive;
//   B. a project that only ever had `deposit_percent`;
//   C. the chain 20261102000000 → 20261103000000, i.e. the AFTER trigger on
//      public.salons from the previous migration writing through this one.
// ============================================================================

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = '../supabase/migrations/20261103000000_salon_booking_settings_advance_25.sql';
const PREVIOUS = '../supabase/migrations/20261102000000_salon_booking_settings_deposit.sql';

const SALON_A = '20000000-0000-4000-8000-000000000001';
const SALON_B = '20000000-0000-4000-8000-000000000002';
const SALON_C = '20000000-0000-4000-8000-000000000003';

async function migrationSql(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

const BOOTSTRAP = `
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table public.salons (
    id uuid primary key,
    data jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
  );
  insert into public.salons(id) values
    ('${SALON_A}'), ('${SALON_B}'), ('${SALON_C}');
`;

/** Shape A — the reported production table, with rows that violate the check. */
const LEGACY_SHAPE_A = `
  create table public.salon_booking_settings (
    salon_id uuid primary key references public.salons(id) on delete cascade,
    require_deposit boolean not null default true,
    accept_online_bookings boolean,
    deposit_percent numeric(5,2),
    deposit_percentage numeric(5,2),
    deposit_25 numeric(5,2),
    updated_at timestamptz not null default now(),
    constraint salon_booking_settings_unrelated_check
      check (updated_at > '2000-01-01'::timestamptz)
  );
  -- Written before the check existed: the exact 0 / 20 / null mix that made
  -- "alter column set not null" impossible and every save a 23514.
  insert into public.salon_booking_settings
    (salon_id, require_deposit, accept_online_bookings, deposit_percent, deposit_percentage, deposit_25)
  values
    ('${SALON_A}', true,  false, 20,   20,   20),
    ('${SALON_B}', false, true,  0,    null, null);
  alter table public.salon_booking_settings
    add constraint salon_booking_settings_deposit_25_check check (deposit_25 = 25) not valid;
`;

/** Shape B — a project that only ever had one advance column. */
const LEGACY_SHAPE_B = `
  create table public.salon_booking_settings (
    salon_id uuid primary key references public.salons(id) on delete cascade,
    deposit_percent numeric(5,2)
  );
  insert into public.salon_booking_settings(salon_id, deposit_percent)
  values ('${SALON_A}', 20), ('${SALON_B}', null);
`;

async function numbers(db: any, salonId: string) {
  const rows = (await db.query(
    `select deposit_percent, deposit_percentage, deposit_25
       from public.salon_booking_settings where salon_id = $1`,
    [salonId]
  )).rows;
  return rows[0]
    ? {
        percent: rows[0].deposit_percent === null ? null : Number(rows[0].deposit_percent),
        percentage: rows[0].deposit_percentage === null ? null : Number(rows[0].deposit_percentage),
        d25: rows[0].deposit_25 === null ? null : Number(rows[0].deposit_25),
      }
    : null;
}

/** Shape B has a single advance column, so it needs its own reader. */
async function onlyPercent(db: any, salonId: string): Promise<number | null> {
  const rows = (await db.query(
    `select deposit_percent from public.salon_booking_settings where salon_id = $1`,
    [salonId]
  )).rows;
  return rows.length && rows[0].deposit_percent !== null ? Number(rows[0].deposit_percent) : null;
}

async function constraintNames(db: any): Promise<string[]> {
  const rows = (await db.query(
    `select c.conname
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and t.relname = 'salon_booking_settings'
      order by c.conname`
  )).rows;
  return rows.map((r: any) => r.conname);
}

async function policyNames(db: any): Promise<string[]> {
  const rows = (await db.query(
    `select policyname from pg_policies
      where schemaname = 'public' and tablename = 'salon_booking_settings'
      order by policyname`
  )).rows;
  return rows.map((r: any) => r.policyname);
}

test('A: the normalizer is installed BEFORE the row is written', async () => {
  // `any` so PGlite's QueryResult<unknown> rows can be read field by field.
  const db: any = new PGlite();
  try {
    await db.exec(BOOTSTRAP + LEGACY_SHAPE_A);
    await db.exec(await migrationSql(MIGRATION));

    const fn = (await db.query(
      `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and proname = 'nexora_normalize_booking_settings'`
    )).rows;
    assert.equal(fn.length, 1, 'public.nexora_normalize_booking_settings() must exist');

    const trigger = (await db.query(
      `select t.tgname, (t.tgtype::int & 2) <> 0 as is_before,
              (t.tgtype::int & 4) <> 0 as is_insert,
              (t.tgtype::int & 16) <> 0 as is_update,
              (t.tgtype::int & 1) <> 0 as is_row
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'salon_booking_settings'
          and t.tgname = 'trg_nexora_normalize_booking_settings'`
    )).rows;
    assert.equal(trigger.length, 1, 'trg_nexora_normalize_booking_settings must exist');
    assert.equal(trigger[0].is_before, true, 'it must be BEFORE — an AFTER trigger normalizes too late for the check');
    assert.equal(trigger[0].is_insert, true);
    assert.equal(trigger[0].is_update, true);
    assert.equal(trigger[0].is_row, true);
  } finally {
    await db.close();
  }
});

test('A: existing 0 / 20 / null rows are repaired to 25 and the columns become NOT NULL 25', async () => {
  // `any` so PGlite's QueryResult<unknown> rows can be read field by field.
  const db: any = new PGlite();
  try {
    await db.exec(BOOTSTRAP + LEGACY_SHAPE_A);
    await db.exec(await migrationSql(MIGRATION));

    assert.deepEqual(await numbers(db, SALON_A), { percent: 25, percentage: 25, d25: 25 });
    assert.deepEqual(await numbers(db, SALON_B), { percent: 25, percentage: 25, d25: 25 });

    const cols = (await db.query(
      `select column_name, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'salon_booking_settings'
          and column_name in ('deposit_percent','deposit_percentage','deposit_25')
        order by column_name`
    )).rows;
    assert.equal(cols.length, 3);
    for (const col of cols) {
      assert.equal(col.is_nullable, 'NO', `${col.column_name} must be NOT NULL`);
      assert.match(String(col.column_default), /25/, `${col.column_name} must default to 25`);
    }
  } finally {
    await db.close();
  }
});

test('A: the deposit check is recreated as = 25 and unrelated constraints survive', async () => {
  // `any` so PGlite's QueryResult<unknown> rows can be read field by field.
  const db: any = new PGlite();
  try {
    await db.exec(BOOTSTRAP + LEGACY_SHAPE_A);
    await db.exec(await migrationSql(MIGRATION));

    const def = (await db.query(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public' and t.relname = 'salon_booking_settings'
          and c.conname = 'salon_booking_settings_deposit_25_check'`
    )).rows;
    assert.equal(def.length, 1, 'salon_booking_settings_deposit_25_check must exist');
    assert.match(def[0].def.replace(/\s+/g, ' '), /^CHECK \(\(deposit_25 = \(?25\)?(::numeric)?\)\)$/);

    const names = await constraintNames(db);
    assert.ok(names.includes('salon_booking_settings_unrelated_check'), 'the unrelated check must be preserved');
    assert.ok(names.includes('salon_booking_settings_salon_id_fkey'), 'the foreign key must be preserved');
    assert.ok(names.includes('salon_booking_settings_pkey'), 'the primary key must be preserved');
    assert.ok(names.includes('salon_booking_settings_deposit_percent_check'));
    assert.ok(names.includes('salon_booking_settings_deposit_percentage_check'));
  } finally {
    await db.close();
  }
});

test('A: RLS stays enabled and an owner-written policy is never replaced', async () => {
  // `any` so PGlite's QueryResult<unknown> rows can be read field by field.
  const db: any = new PGlite();
  try {
    await db.exec(BOOTSTRAP + LEGACY_SHAPE_A);
    await db.exec(`
      alter table public.salon_booking_settings enable row level security;
      create policy owner_custom_policy on public.salon_booking_settings
        for all to authenticated using (true) with check (true);
    `);
    await db.exec(await migrationSql(MIGRATION));

    assert.deepEqual(await policyNames(db), ['owner_custom_policy'], 'the existing policy must survive untouched');
    const rls = (await db.query(
      `select relrowsecurity from pg_class
        where oid = 'public.salon_booking_settings'::regclass`
    )).rows[0];
    assert.equal(rls.relrowsecurity, true);
  } finally {
    await db.close();
  }
});

test('A: with no policy at all, the owner policy is created', async () => {
  // `any` so PGlite's QueryResult<unknown> rows can be read field by field.
  const db: any = new PGlite();
  try {
    await db.exec(BOOTSTRAP + LEGACY_SHAPE_A);
    await db.exec(await migrationSql(MIGRATION));
    assert.deepEqual(await policyNames(db), ['salon_booking_settings_owner_all']);
  } finally {
    await db.close();
  }
});

test('valid 25% writes are accepted', async () => {
  // `any` so PGlite's QueryResult<unknown> rows can be read field by field.
  const db: any = new PGlite();
  try {
    await db.exec(BOOTSTRAP + LEGACY_SHAPE_A);
    await db.exec(await migrationSql(MIGRATION));
    // The migration backfills every salon, so start this salon clean.
    await db.query(`delete from public.salon_booking_settings where salon_id = $1`, [SALON_C]);

    await db.query(
      `insert into public.salon_booking_settings
         (salon_id, require_deposit, accept_online_bookings, deposit_percent, deposit_percentage, deposit_25)
       values ($1, true, true, 25, 25, 25)`,
      [SALON_C]
    );
    assert.deepEqual(await numbers(db, SALON_C), { percent: 25, percentage: 25, d25: 25 });

    await db.query(
      `update public.salon_booking_settings set deposit_25 = 25 where salon_id = $1`,
      [SALON_C]
    );
    assert.deepEqual(await numbers(db, SALON_C), { percent: 25, percentage: 25, d25: 25 });
  } finally {
    await db.close();
  }
});

test('0, null, 20 and 999 are normalized to 25 on both INSERT and UPDATE', async () => {
  // `any` so PGlite's QueryResult<unknown> rows can be read field by field.
  const db: any = new PGlite();
  try {
    await db.exec(BOOTSTRAP + LEGACY_SHAPE_A);
    await db.exec(await migrationSql(MIGRATION));
    await db.query(`delete from public.salon_booking_settings where salon_id = $1`, [SALON_C]);

    // INSERT with a wrong percentage.
    await db.query(
      `insert into public.salon_booking_settings
         (salon_id, deposit_percent, deposit_percentage, deposit_25)
       values ($1, 20, 0, 999)`,
      [SALON_C]
    );
    assert.deepEqual(await numbers(db, SALON_C), { percent: 25, percentage: 25, d25: 25 });

    // UPDATE to a wrong percentage.
    await db.query(
      `update public.salon_booking_settings set deposit_25 = 10, deposit_percentage = null
        where salon_id = $1`,
      [SALON_C]
    );
    const after = await numbers(db, SALON_C);
    assert.equal(after!.d25, 25);
    assert.equal(after!.percentage, 25, 'a NULL written by an old client must not survive as NULL');

    // A partial INSERT that omits the advance entirely still lands on 25.
    await db.query(`delete from public.salon_booking_settings where salon_id = $1`, [SALON_C]);
    await db.query(`insert into public.salon_booking_settings(salon_id) values ($1)`, [SALON_C]);
    assert.deepEqual(await numbers(db, SALON_C), { percent: 25, percentage: 25, d25: 25 });

    // Bypassing the trigger is still refused — the check is the last line.
    await assert.rejects(
      db.query(`alter table public.salon_booking_settings disable trigger trg_nexora_normalize_booking_settings`)
        .then(() => db.query(
          `update public.salon_booking_settings set deposit_25 = 20 where salon_id = $1`,
          [SALON_C]
        )),
      /salon_booking_settings_deposit_25_check/
    );
  } finally {
    await db.close();
  }
});

test('accept_online_bookings defaults to true and an explicit false is preserved', async () => {
  // `any` so PGlite's QueryResult<unknown> rows can be read field by field.
  const db: any = new PGlite();
  try {
    await db.exec(BOOTSTRAP + LEGACY_SHAPE_A);
    await db.exec(await migrationSql(MIGRATION));
    await db.query(`delete from public.salon_booking_settings where salon_id = $1`, [SALON_C]);

    // Unspecified → true.
    await db.query(`insert into public.salon_booking_settings(salon_id) values ($1)`, [SALON_C]);
    let row = (await db.query(
      `select require_deposit, accept_online_bookings from public.salon_booking_settings where salon_id = $1`,
      [SALON_C]
    )).rows[0];
    assert.equal(row.accept_online_bookings, true, 'unspecified means accepting bookings');
    assert.equal(row.require_deposit, true);

    // An owner who switched bookings off keeps false — including across an
    // UPDATE that does not mention the column at all.
    await db.query(
      `update public.salon_booking_settings set accept_online_bookings = false where salon_id = $1`,
      [SALON_C]
    );
    await db.query(
      `update public.salon_booking_settings set require_deposit = false where salon_id = $1`,
      [SALON_C]
    );
    row = (await db.query(
      `select require_deposit, accept_online_bookings from public.salon_booking_settings where salon_id = $1`,
      [SALON_C]
    )).rows[0];
    assert.equal(row.accept_online_bookings, false, 'an explicit false must never be upgraded to true');
    assert.equal(row.require_deposit, false, 'the require switch is the owner’s and is preserved');

    // A NULL written by an old client falls back to the STORED value, not true.
    await db.query(
      `update public.salon_booking_settings set accept_online_bookings = null where salon_id = $1`,
      [SALON_C]
    );
    row = (await db.query(
      `select accept_online_bookings from public.salon_booking_settings where salon_id = $1`,
      [SALON_C]
    )).rows[0];
    assert.equal(row.accept_online_bookings, false);

    // The pre-existing false from the legacy row is untouched by the repair.
    const legacy = (await db.query(
      `select accept_online_bookings from public.salon_booking_settings where salon_id = $1`,
      [SALON_A]
    )).rows[0];
    assert.equal(legacy.accept_online_bookings, false, 'the repair must not touch owner settings');
  } finally {
    await db.close();
  }
});

test('every salon without a settings row is backfilled with 25', async () => {
  // `any` so PGlite's QueryResult<unknown> rows can be read field by field.
  const db: any = new PGlite();
  try {
    await db.exec(BOOTSTRAP + LEGACY_SHAPE_A);
    await db.exec(await migrationSql(MIGRATION));
    const count = (await db.query(`select count(*)::int as n from public.salon_booking_settings`)).rows[0].n;
    assert.equal(count, 3, 'the two legacy rows plus the salon that had none');
    assert.deepEqual(await numbers(db, SALON_C), { percent: 25, percentage: 25, d25: 25 });
  } finally {
    await db.close();
  }
});

test('the migration is rerunnable and idempotent', async () => {
  // `any` so PGlite's QueryResult<unknown> rows can be read field by field.
  const db: any = new PGlite();
  try {
    const sql = await migrationSql(MIGRATION);
    await db.exec(BOOTSTRAP + LEGACY_SHAPE_A);
    await db.exec(sql);
    const first = {
      rows: (await db.query(`select * from public.salon_booking_settings order by salon_id`)).rows,
      constraints: await constraintNames(db),
      policies: await policyNames(db),
      triggers: (await db.query(
        `select tgname from pg_trigger
          where tgrelid = 'public.salon_booking_settings'::regclass and not tgisinternal
          order by tgname`
      )).rows.map((r: any) => r.tgname),
    };

    await db.exec(sql);
    await db.exec(sql);

    const second = {
      rows: (await db.query(`select * from public.salon_booking_settings order by salon_id`)).rows,
      constraints: await constraintNames(db),
      policies: await policyNames(db),
      triggers: (await db.query(
        `select tgname from pg_trigger
          where tgrelid = 'public.salon_booking_settings'::regclass and not tgisinternal
          order by tgname`
      )).rows.map((r: any) => r.tgname),
    };
    assert.deepEqual(second, first, 'a second and third run must change nothing');
    assert.equal(second.triggers.length, 1, 'the trigger must not accumulate');
  } finally {
    await db.close();
  }
});

test('B: a project with only deposit_percent is repaired and still reports the named constraint', async () => {
  // `any` so PGlite's QueryResult<unknown> rows can be read field by field.
  const db: any = new PGlite();
  try {
    await db.exec(BOOTSTRAP + LEGACY_SHAPE_B);
    await db.exec(await migrationSql(MIGRATION));

    assert.equal(await onlyPercent(db, SALON_A), 25);
    assert.equal(await onlyPercent(db, SALON_B), 25);

    const def = (await db.query(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public' and t.relname = 'salon_booking_settings'
          and c.conname = 'salon_booking_settings_deposit_25_check'`
    )).rows;
    assert.equal(def.length, 1, 'the reported constraint name must exist even without a deposit_25 column');
    assert.match(def[0].def.replace(/\s+/g, ' '), /^CHECK \(\(deposit_percent = \(?25\)?(::numeric)?\)\)$/);

    // No invented columns: the table keeps exactly the columns it had.
    const cols = (await db.query(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'salon_booking_settings'
        order by column_name`
    )).rows.map((r: any) => r.column_name);
    assert.deepEqual(cols, ['deposit_percent', 'salon_id']);

    await db.query(
      `update public.salon_booking_settings set deposit_percent = 0 where salon_id = $1`,
      [SALON_A]
    );
    assert.equal(await onlyPercent(db, SALON_A), 25);
  } finally {
    await db.close();
  }
});

test('C: chains onto 20261102000000 and normalizes what the salons trigger writes', async () => {
  // `any` so PGlite's QueryResult<unknown> rows can be read field by field.
  const db: any = new PGlite();
  try {
    await db.exec(BOOTSTRAP);
    await db.exec(await migrationSql(PREVIOUS));
    // The previous migration backfilled the salons; give one a 20% editor
    // payload, which is what the app used to send.
    await db.exec(await migrationSql(MIGRATION));

    await db.query(
      `update public.salons
          set data = jsonb_build_object('editor_profile', jsonb_build_object('depositPercentage', 20))
        where id = $1`,
      [SALON_A]
    );

    const after = await numbers(db, SALON_A);
    assert.deepEqual(after, { percent: 25, percentage: 25, d25: 25 },
      'the AFTER trigger on public.salons writes through the BEFORE normalizer');

    // Both migrations’ objects coexist.
    const fns = (await db.query(
      `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and proname in ('nexora_normalize_booking_settings','nexora_upsert_salon_booking_settings')
        order by proname`
    )).rows.map((r: any) => r.proname);
    assert.deepEqual(fns, ['nexora_normalize_booking_settings', 'nexora_upsert_salon_booking_settings']);
  } finally {
    await db.close();
  }
});
