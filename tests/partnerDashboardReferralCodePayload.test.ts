import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';

test('reward dashboard retains metrics and returns only the caller stored referral code', async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role authenticated; create role anon; create schema auth;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated;
      create table public.growth_partners(user_id uuid primary key,referral_code text,is_active boolean,created_at timestamptz default now());
      insert into public.growth_partners(user_id,referral_code,is_active) values
        ('00000000-0000-0000-0000-000000000001','EXISTING1',true),
        ('00000000-0000-0000-0000-000000000002','OTHER222',true);
      alter table public.growth_partners enable row level security;
      create policy own_partner on public.growth_partners for select to authenticated using(user_id=auth.uid());
      grant select on public.growth_partners to authenticated;
      create function public.get_my_partner_dashboard() returns jsonb language plpgsql stable as $$ begin return jsonb_build_object('total_shops_onboarded',0,'qualifying_shops',0); end $$;
      grant execute on function public.get_my_partner_dashboard() to authenticated;
    `);
    const sql=readFileSync(new URL('../supabase/migrations/20260930050447_partner_dashboard_referral_code_payload.sql',import.meta.url),'utf8');
    await db.exec(sql); await db.exec(sql);
    await db.exec("select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false); set role authenticated");
    const {rows}=await db.query<any>('select public.get_my_partner_dashboard() as payload');
    assert.equal(rows[0].payload.partner.referral_code,'EXISTING1');
    assert.equal((await db.query<any>('select public.get_my_referral_code() as code')).rows[0].code,'EXISTING1');
    assert.equal(rows[0].payload.total_shops_onboarded,0);
    assert.equal(rows[0].payload.qualifying_shops,0);
    assert.doesNotMatch(JSON.stringify(rows),/OTHER222/);
    await db.exec('reset role');
    assert.equal((await db.query<any>("select has_function_privilege('anon','public.get_my_referral_code()','EXECUTE') as allowed")).rows[0].allowed,false);
    assert.equal((await db.query<any>("select prosecdef from pg_proc where proname='get_my_partner_dashboard'")).rows[0].prosecdef,false);
  }finally{await db.close();}
});
