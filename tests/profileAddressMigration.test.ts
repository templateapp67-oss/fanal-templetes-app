import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('address repair preserves legacy values and RLS, accepts both address fields, and is repeatable', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table public.profiles(id integer primary key, full_address text);
      alter table public.profiles enable row level security;
      insert into public.profiles values (1, 'Existing address');`);
    const sql = await readFile(new URL('../supabase/migrations/20261024000000_profile_address_schema_cache.sql', import.meta.url), 'utf8');
    await assert.rejects(db.query('update public.profiles set address=$1 where id=1', ['New address']), /column "address"/);
    await db.exec(sql);
    await db.exec(sql);
    assert.deepEqual((await db.query('select full_address, address from profiles')).rows, [{ full_address: 'Existing address', address: null }]);
    await db.query('update public.profiles set address=$1, full_address=$1 where id=1', ['New address']);
    assert.deepEqual((await db.query('select address, full_address from profiles')).rows, [{ address: 'New address', full_address: 'New address' }]);
    assert.equal((await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid='public.profiles'::regclass")).rows[0].relrowsecurity, true);
  } finally { await db.close(); }
});
