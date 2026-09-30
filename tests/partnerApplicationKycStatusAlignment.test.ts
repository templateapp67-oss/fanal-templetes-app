import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { toPartnerApplicationError } from '../src/lib/partnerApplicationErrors';
import { safePartnerErrorMessage } from '../src/lib/partnerUiErrors';

test('production legacy KYC CHECK rejects submission; migration repairs it without losing rows', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table public.growth_partner_applications (
      id integer primary key, kyc_status text not null,
      constraint growth_partner_applications_kyc_status_check
        check (kyc_status in ('pending', 'approved', 'rejected'))
    ); insert into public.growth_partner_applications values (1, 'pending');`);
    await assert.rejects(db.exec("insert into public.growth_partner_applications values (2, 'submitted')"),
      (error: any) => error.code === '23514');
    const migration = readFileSync(new URL('../supabase/migrations/20260930043232_partner_application_kyc_status_alignment.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration); // Reapplying remains safe.
    await db.exec("insert into public.growth_partner_applications values (2, 'submitted'), (3, 'under_review'), (4, 'not_submitted'), (5, 'approved'), (6, 'rejected')");
    assert.equal((await db.query('select * from public.growth_partner_applications')).rows.length, 6);
    await assert.rejects(db.exec("insert into public.growth_partner_applications values (7, 'invalid')"),
      (error: any) => error.code === '23514');
  } finally { await db.close(); }
});

test('KYC workflow schema error never blames application fields or leaks SQL', () => {
  const error = toPartnerApplicationError({code: '23514', message: 'new row for relation "growth_partner_applications" violates check constraint "growth_partner_applications_kyc_status_check"'});
  assert.equal(error.kind, 'schema');
  assert.equal(error.field, undefined);
  assert.equal(safePartnerErrorMessage(error), error.message);
  assert.doesNotMatch(error.message, /Check your application details|constraint|23514/);
});
