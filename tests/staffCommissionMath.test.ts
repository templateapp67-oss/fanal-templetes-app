// ============================================================================
// Staff commission math (final audit) — the project's authoritative
// commission bodies, tested VERBATIM.
//
// PGlite cannot install the pgcrypto/uuid-ossp extensions the full staff
// migrations require, so these tests extract the exact function definitions
// from the migration files and apply them with a minimal settings table.
// Every assertion runs against the real shipped body text (extraction is
// asserted — if a body is ever edited, the tests track the new text, and if
// extraction fails the suite fails loudly instead of testing a stale copy).
//
// Pinned project rules:
//   • basis is per-staff configurable, DEFAULT NET (gross − discount)
//   • percentage applies to the basis and is capped at net (payout path)
//   • fixed is capped at net (payout path)
//   • a discount can NEVER increase commission on any path
//   • missing/disabled/'none' settings pay 0 (payout path)
//   • settings are effective-dated (payout path)
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const BACKEND_20260908 = readFileSync(
  new URL('../supabase/migrations/20260908_staff_performance_dashboard_backend.sql', import.meta.url),
  'utf8'
);
const PAYOUTS_20260909 = readFileSync(
  new URL('../supabase/migrations/20260909_staff_commission_payouts.sql', import.meta.url),
  'utf8'
);
const COMPLETE_20260910 = readFileSync(
  new URL('../supabase/migrations/20260910_complete_staff_performance_backend.sql', import.meta.url),
  'utf8'
);

/** Extract one verbatim `create or replace function … $$;` block. */
function extractFunction(source: string, name: string): string {
  const match = source.match(
    new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`)
  );
  assert.ok(match, `${name} definition found verbatim in its migration`);
  return match[0];
}

const SALON = '30000000-0000-4000-8000-000000000001';
const STAFF = '50000000-0000-4000-8000-000000000001';

async function setup(): Promise<any> {
  const db = new PGlite();
  await db.exec(extractFunction(BACKEND_20260908, 'staff_dashboard_money'));
  // Minimal settings-table shape matching the columns the payout-path body reads.
  await db.exec(`
    create table public.staff_commission_settings (
      salon_id uuid not null,
      staff_id uuid not null,
      commission_type text not null,
      commission_rate numeric not null default 0,
      fixed_amount numeric not null default 0,
      is_enabled boolean not null default true,
      effective_from date,
      effective_to date,
      created_at timestamptz not null default now()
    );
  `);
  await db.exec(extractFunction(PAYOUTS_20260909, 'calculate_staff_commission'));
  await db.exec(extractFunction(COMPLETE_20260910, 'calculate_staff_booking_commission'));
  return db;
}

async function seedSetting(
  db: any,
  patch: Record<string, string | number | boolean | null> = {}
): Promise<void> {
  const row = {
    salon_id: SALON,
    staff_id: STAFF,
    commission_type: 'percentage',
    commission_rate: 10,
    fixed_amount: 0,
    is_enabled: true,
    effective_from: '2020-01-01',
    effective_to: null,
    ...patch,
  };
  const keys = Object.keys(row);
  await db.query(
    `insert into public.staff_commission_settings(${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(row)
  );
}

/** Payout-path table function result row. */
async function tableCommission(db: any, gross: number, discount: number): Promise<any> {
  const res = await db.query(
    'select * from public.calculate_staff_commission($1::uuid, $2::uuid, $3::numeric, $4::numeric)',
    [SALON, STAFF, gross, discount]
  );
  return res.rows[0];
}

/** Reporting scalar result. */
async function scalarCommission(
  db: any,
  gross: number,
  discount: number,
  rate: number,
  fixed: number,
  type: string | null,
  basis: string | null
): Promise<number> {
  const res = await db.query('select public.calculate_staff_booking_commission($1, $2, $3, $4, $5, $6) as c', [
    gross,
    discount,
    rate,
    fixed,
    type,
    basis,
  ]);
  return Number(res.rows[0].c);
}

// ---------------------------------------------------------------------------
// Payout path — calculate_staff_commission (canonical 5-arg, 20260909)
// ---------------------------------------------------------------------------

test('payout path: percentage applies to NET and missing/disabled/none settings pay 0', async () => {
  const db = await setup();
  try {
    // No settings row at all → 0, type none.
    assert.equal(Number((await tableCommission(db, 1000, 200)).commission_amount), 0);

    await seedSetting(db, { commission_type: 'percentage', commission_rate: 10 });
    const pct = await tableCommission(db, 1000, 200);
    assert.equal(Number(pct.gross_amount), 1000);
    assert.equal(Number(pct.discount_amount), 200);
    assert.equal(Number(pct.net_amount), 800);
    assert.equal(pct.commission_type, 'percentage');
    assert.equal(Number(pct.commission_amount), 80);
    assert.equal(Number(pct.salon_amount), 720);
  } finally {
    await db.close();
  }

  const db2 = await setup();
  try {
    await seedSetting(db2, { commission_type: 'none', commission_rate: 50 });
    assert.equal(Number((await tableCommission(db2, 1000, 0)).commission_amount), 0);
  } finally {
    await db2.close();
  }

  const db3 = await setup();
  try {
    await seedSetting(db3, { is_enabled: false, commission_rate: 50 });
    assert.equal(Number((await tableCommission(db3, 1000, 0)).commission_amount), 0);
  } finally {
    await db3.close();
  }
});

test('payout path: fixed and percentage are capped at net; negatives are floored', async () => {
  const db = await setup();
  try {
    await seedSetting(db, { commission_type: 'fixed', fixed_amount: 500 });
    // Fixed 500 on net 100 → capped at 100.
    assert.equal(Number((await tableCommission(db, 1000, 900)).commission_amount), 100);

    // Discount beyond gross → net 0 → commission 0, never negative.
    assert.equal(Number((await tableCommission(db, 500, 9999)).commission_amount), 0);
    assert.equal(Number((await tableCommission(db, 500, 9999)).net_amount), 0);
  } finally {
    await db.close();
  }

  const db2 = await setup();
  try {
    await seedSetting(db2, { commission_type: 'percentage', commission_rate: 200 });
    // 200% of net 800 → capped at 800.
    assert.equal(Number((await tableCommission(db2, 1000, 200)).commission_amount), 800);
  } finally {
    await db2.close();
  }
});

test('payout path: a discount can never increase commission (monotonicity)', async () => {
  const db = await setup();
  try {
    await seedSetting(db, { commission_type: 'percentage', commission_rate: 10 });
    let previous = Number.POSITIVE_INFINITY;
    for (const discount of [0, 1, 199.99, 200, 500, 1000, 5000]) {
      const current = Number((await tableCommission(db, 1000, discount)).commission_amount);
      assert.ok(current <= previous, `discount ${discount} raised commission ${previous} → ${current}`);
      assert.ok(current >= 0);
      previous = current;
    }
  } finally {
    await db.close();
  }

  const db2 = await setup();
  try {
    await seedSetting(db2, { commission_type: 'fixed', fixed_amount: 120 });
    let previous = Number.POSITIVE_INFINITY;
    for (const discount of [0, 500, 880, 900, 1000]) {
      const current = Number((await tableCommission(db2, 1000, discount)).commission_amount);
      assert.ok(current <= previous, `discount ${discount} raised fixed commission ${previous} → ${current}`);
      previous = current;
    }
  } finally {
    await db2.close();
  }
});

test('payout path: settings are effective-dated (future/expired settings pay 0)', async () => {
  const db = await setup();
  try {
    await seedSetting(db, { commission_rate: 10, effective_from: '2999-01-01' });
    assert.equal(Number((await tableCommission(db, 1000, 0)).commission_amount), 0);
  } finally {
    await db.close();
  }

  const db2 = await setup();
  try {
    await seedSetting(db2, { commission_rate: 10, effective_from: '2020-01-01', effective_to: '2020-12-31' });
    assert.equal(Number((await tableCommission(db2, 1000, 0)).commission_amount), 0);
  } finally {
    await db2.close();
  }
});

test('the obsolete 4-arg overload is dropped so only the canonical 5-arg body resolves', () => {
  assert.match(
    PAYOUTS_20260909,
    /drop function if exists public\.calculate_staff_commission\(uuid, uuid, numeric, numeric\);/
  );
  assert.match(
    PAYOUTS_20260909,
    /create or replace function public\.calculate_staff_commission\(\s*target_salon_id uuid,[\s\S]*?as_of date default current_date\s*\)/
  );
});

// ---------------------------------------------------------------------------
// Reporting scalar — calculate_staff_booking_commission (20260910 text wins)
// ---------------------------------------------------------------------------

test('reporting scalar: basis defaults to NET with a gross opt-in; both/percentage/fixed preserved', async () => {
  const db = await setup();
  try {
    // Default (null) basis → net: 10% of (1000−200).
    assert.equal(await scalarCommission(db, 1000, 200, 10, 0, 'percentage', null), 80);
    assert.equal(await scalarCommission(db, 1000, 200, 10, 0, 'percentage', 'net'), 80);
    // Explicit gross opt-in.
    assert.equal(await scalarCommission(db, 1000, 200, 10, 0, 'percentage', 'gross'), 100);
    // Fixed passthrough + combined mode.
    assert.equal(await scalarCommission(db, 1000, 200, 10, 150, 'fixed', 'net'), 150);
    assert.equal(await scalarCommission(db, 1000, 200, 10, 150, 'both', 'net'), 230);
    assert.equal(await scalarCommission(db, 1000, 200, 10, 150, 'both', 'gross'), 250);
  } finally {
    await db.close();
  }
});

test('reporting scalar: a discount can never increase commission on any basis', async () => {
  const db = await setup();
  try {
    for (const basis of [null, 'net', 'gross']) {
      let previous = Number.POSITIVE_INFINITY;
      for (const discount of [0, 200, 1000, 5000]) {
        const current = await scalarCommission(db, 1000, discount, 10, 0, 'percentage', basis);
        assert.ok(current <= previous, `basis ${basis}: discount ${discount} raised ${previous} → ${current}`);
        assert.ok(current >= 0);
        previous = current;
      }
    }
  } finally {
    await db.close();
  }
});
