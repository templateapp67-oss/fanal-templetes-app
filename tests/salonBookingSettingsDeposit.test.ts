import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DEFAULT_DEPOSIT_PERCENT, normalizeDepositPercentage } from '../src/lib/advanceDeposit';
import { toProfileRow } from '../src/lib/salonSync';
import { prepareWebsiteStateForSave } from '../src/lib/websiteContentNormalize';

test('deposit payload is an integer 0–100 and defaults to 25', () => {
  assert.equal(DEFAULT_DEPOSIT_PERCENT, 25);
  assert.equal(normalizeDepositPercentage(undefined), 25);
  assert.equal(normalizeDepositPercentage(null), 25);
  assert.equal(normalizeDepositPercentage(''), 25);
  assert.equal(normalizeDepositPercentage(-1), 25);
  assert.equal(normalizeDepositPercentage(140), 25);
  assert.equal(normalizeDepositPercentage('25%'), 25);
  assert.equal(normalizeDepositPercentage(20), 20);
  assert.equal(normalizeDepositPercentage(25.4), 25);
});

test('website profile save rows send a check-safe deposit percentage', () => {
  const row = toProfileRow({
    businessName: 'Studio',
    requireDeposit: true,
    depositPercentage: Number.NaN,
  } as any, '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d');
  assert.equal(row.deposit_percentage, 25);
  assert.equal(row.require_deposit, true);

  const prepared = prepareWebsiteStateForSave({
    profile: { businessName: 'Studio', depositPercentage: 999 },
    services: [],
    stylists: [],
  });
  assert.equal((prepared.payload as any).profile.depositPercentage, 25);
  assert.equal((prepared.payload as any).profile.deposit_25, 25);
});

test('migration drops salon_booking_settings_deposit_25_check and upserts 25', async () => {
  const sql = await readFile(
    new URL('../supabase/migrations/20261102000000_salon_booking_settings_deposit.sql', import.meta.url),
    'utf8'
  );
  assert.match(sql, /salon_booking_settings_deposit_25_check/);
  assert.match(sql, /create table if not exists public\.salon_booking_settings/);
  assert.match(sql, /nexora_upsert_salon_booking_settings/);
  assert.match(sql, /deposit_25 numeric\(5,2\) not null default 25/);
  assert.match(sql, /check \(deposit_25 is null or \(deposit_25 >= 0 and deposit_25 <= 100\)\)/);
});

test('a 20% payload no longer violates salon_booking_settings_deposit_25_check after repair', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const sql = await readFile(
    new URL('../supabase/migrations/20261102000000_salon_booking_settings_deposit.sql', import.meta.url),
    'utf8'
  );
  const db = new PGlite();
  try {
    await db.exec(`
      create schema if not exists auth;
      create table public.salons (id uuid primary key, data jsonb default '{}'::jsonb);
      insert into public.salons(id) values ('20000000-0000-4000-8000-000000000001');
      create table public.salon_booking_settings (
        salon_id uuid primary key references public.salons(id),
        deposit_25 numeric not null default 20,
        constraint salon_booking_settings_deposit_25_check check (deposit_25 = 25)
      );
    `);
    await assert.rejects(
      db.query(`insert into public.salon_booking_settings(salon_id, deposit_25) values ('20000000-0000-4000-8000-000000000001', 20)`),
      /salon_booking_settings_deposit_25_check|23514/
    );
    await db.exec(sql);
    await db.query(`select public.nexora_upsert_salon_booking_settings('20000000-0000-4000-8000-000000000001'::uuid, true, 20)`);
    const row = (await db.query<any>(`select deposit_25, deposit_percent from public.salon_booking_settings`)).rows[0];
    assert.equal(Number(row.deposit_25), 20);
    assert.equal(Number(row.deposit_percent), 20);
    await db.query(`select public.nexora_upsert_salon_booking_settings('20000000-0000-4000-8000-000000000001'::uuid, true, 25)`);
    const saved = (await db.query<any>(`select deposit_25 from public.salon_booking_settings`)).rows[0];
    assert.equal(Number(saved.deposit_25), 25);
  } finally {
    await db.close();
  }
});
