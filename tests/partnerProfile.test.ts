import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { normalizeWhatsApp } from '../src/lib/partnerProfile';

test('WhatsApp normalization accepts Indian and international numbers and rejects malformed values', () => {
  assert.equal(normalizeWhatsApp('98450 77654'), '+919845077654');
  assert.equal(normalizeWhatsApp('+44 7700 900123'), '+447700900123');
  for (const value of ['abc', '123', '+91<script>9845077654']) assert.throws(() => normalizeWhatsApp(value));
});

test('partner profile RPC persists atomically, validates fields, and isolates owners', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('app.uid',true),'')::uuid $$;
      create table public.profiles(id uuid primary key references auth.users(id),full_name text,whatsapp text,postal_code text,city text,owner_photo_url text);
      alter table public.profiles enable row level security;
      create policy owner_rows on public.profiles to authenticated using(id=auth.uid()) with check(id=auth.uid());
      grant usage on schema auth,storage to authenticated;
      grant select,insert,update on public.profiles to authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(bucket_id text,name text);
      create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
      insert into auth.users values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');`);
    await db.exec(readFileSync(new URL('../supabase/migrations/20260909035237_partner_profile_settings.sql',import.meta.url),'utf8'));
    await db.exec(`set role authenticated; set app.uid='11111111-1111-4111-8111-111111111111';`);
    const call = (pin: string) => db.query(`select public.save_partner_profile('Uma','+919845077654',$1,'Bengaluru','https://example.com/avatar.webp','1992-06-15','Bandra West',true)`,[pin]);
    await call('560038');
    assert.equal((await db.query<any>('select * from partner_settings')).rows[0].area,'Bandra West');
    assert.equal((await db.query<any>('select * from profiles')).rows[0].postal_code,'560038');
    await assert.rejects(call('000000'), /Invalid profile/);
    await db.exec(`set app.uid='22222222-2222-4222-8222-222222222222'`);
    assert.equal((await db.query('select * from partner_settings')).rows.length,0);
    await assert.rejects(db.exec(`insert into partner_settings values('11111111-1111-4111-8111-111111111111','2000-01-01','Other',false,now())`), /row-level security/);
    await db.exec(`set app.uid=''`);
    await assert.rejects(call('560038'), /Sign in/);
  } finally { await db.close(); }
});
