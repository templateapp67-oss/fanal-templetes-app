import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('instant enrollment upgrades pending applicants and preserves KYC, codes and suspensions', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key, banned_until timestamptz);
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table public.growth_partners(user_id uuid primary key, referral_code text, is_active boolean default true);
      create table public.growth_partner_applications(user_id uuid primary key, status text, kyc_status text, kyc_document_reference text);
      create function public.normalize_partner_kyc_reference(p_reference text) returns text language sql immutable as $$ select upper(regexp_replace(p_reference,'[[:space:]-]','','g')) $$;
      create function public.provision_growth_partner(p_user_id uuid) returns jsonb language plpgsql as $$
      begin insert into public.growth_partners values(p_user_id,'CODE-' || p_user_id,true);
      return jsonb_build_object('user_id',p_user_id); end $$;
      insert into auth.users values
        ('00000000-0000-0000-0000-000000000001',null),
        ('00000000-0000-0000-0000-000000000002',null),
        ('00000000-0000-0000-0000-000000000003',now()+interval '1 day');
      insert into public.growth_partners values('00000000-0000-0000-0000-000000000002','KEEP-CODE',false);
      insert into public.growth_partner_applications values
        ('00000000-0000-0000-0000-000000000001','pending','submitted','123456789012'),
        ('00000000-0000-0000-0000-000000000002','pending','submitted','223456789012'),
        ('00000000-0000-0000-0000-000000000003','pending','submitted','323456789012');
    `);
    const migration=readFileSync(new URL('../supabase/migrations/20260930044315_growth_partner_instant_enrollment.sql',import.meta.url),'utf8');
    await db.exec(migration);
    await db.exec(migration);
    const {rows}=await db.query<any>('select * from public.growth_partner_applications order by user_id');
    assert.equal(rows[0].status,'approved');
    assert.equal(rows[0].kyc_status,'submitted');
    assert.equal(rows[1].status,'pending');
    assert.equal(rows[2].status,'pending');
    assert.equal((await db.query<any>("select * from public.growth_partners where referral_code='KEEP-CODE'")).rows[0].is_active,false);
    await assert.rejects(db.query('select public.ensure_my_growth_partner()'),(e:any)=>e.code==='42501');
    await db.exec("select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false)");
    assert.equal((await db.query<any>('select public.ensure_my_growth_partner() as partner')).rows[0].partner.is_active,true);
    await db.exec("delete from public.growth_partner_applications where user_id='00000000-0000-0000-0000-000000000001'; delete from public.growth_partners where user_id='00000000-0000-0000-0000-000000000001'; alter table public.growth_partners add column status text default 'pending'; insert into public.growth_partner_applications values('00000000-0000-0000-0000-000000000001','pending','submitted','123456789012')");
    assert.equal((await db.query<any>('select status from public.growth_partners where is_active=true')).rows[0].status,'approved');
  } finally { await db.close(); }
});
