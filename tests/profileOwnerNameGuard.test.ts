import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { mapProfileSettingsRow, resolveOwnerProfileName } from '../src/lib/readPartnerProfile';

test('mapper uses each verified account fallback, preserves real names, and rejects placeholder fallbacks', () => {
  assert.equal(mapProfileSettingsRow({ full_name: 'User' }, 'Asha Sharma')?.ownerName, 'Asha Sharma');
  assert.equal(mapProfileSettingsRow({ full_name: null }, 'Ravi Kumar')?.ownerName, 'Ravi Kumar');
  assert.equal(mapProfileSettingsRow({ full_name: 'Custom Name' }, 'Old Signup Name')?.ownerName, 'Custom Name');
  assert.equal(resolveOwnerProfileName('User', 'Salon Owner'), '');
  assert.equal(resolveOwnerProfileName('User'), '');
});

test('generic migration backfills accounts independently and protects future profile writes', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth;
      create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
      create table public.profiles(id uuid primary key references auth.users(id), full_name text, user_id uuid);
      insert into auth.users values
        ('11111111-1111-4111-8111-111111111111','{"full_name":"Asha Sharma"}'),
        ('22222222-2222-4222-8222-222222222222','{"name":"Ravi Kumar"}'),
        ('33333333-3333-4333-8333-333333333333','{}');
      insert into profiles(id,full_name) select id,'User' from auth.users;`);
    const sql = await readFile(new URL('../supabase/migrations/20261025000000_profile_owner_name_guard.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    const names = async () => (await db.query<{ full_name: string | null }>('select full_name from profiles order by id')).rows.map(r => r.full_name);
    assert.deepEqual(await names(), ['Asha Sharma', 'Ravi Kumar', 'User']);
    await db.exec("update profiles set full_name='User'");
    assert.deepEqual(await names(), ['Asha Sharma', 'Ravi Kumar', null]);
    await db.exec("update profiles set full_name='New Personal Name' where id='11111111-1111-4111-8111-111111111111'");
    await db.exec(sql);
    assert.deepEqual(await names(), ['New Personal Name', 'Ravi Kumar', null]);
    // A conflicting legacy alias cannot borrow somebody else's metadata.
    await db.exec("update profiles set user_id='11111111-1111-4111-8111-111111111111',full_name='User' where id='33333333-3333-4333-8333-333333333333'");
    assert.equal((await names())[2], null);
    await db.exec("delete from profiles where id='22222222-2222-4222-8222-222222222222'; insert into profiles(id,full_name) values ('22222222-2222-4222-8222-222222222222','User')");
    assert.equal((await names())[1], 'Ravi Kumar');
  } finally { await db.close(); }
});
