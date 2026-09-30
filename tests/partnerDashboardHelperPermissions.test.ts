import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';

test('authenticated dashboard can call both invoker helpers while RLS isolates shops', async()=>{
  const db=new PGlite();
  const actor='00000000-0000-0000-0000-000000000001';
  const other='00000000-0000-0000-0000-000000000002';
  try {
    await db.exec(`create role authenticated; create role anon; create schema auth;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated;
      create table public.shops(id uuid primary key, partner_user_id uuid);
      insert into public.shops values ('10000000-0000-0000-0000-000000000001','${actor}'),('10000000-0000-0000-0000-000000000002','${other}');
      alter table public.shops enable row level security;
      create policy own_shop on public.shops for select to authenticated using(partner_user_id=auth.uid());
      grant select on public.shops to authenticated;
      create function public.gp_shop_qualifies(p_shop_id uuid) returns boolean language sql stable as $$ select exists(select 1 from public.shops where id=p_shop_id) $$;
      create function public.gp_qualifying_shop_count(p_partner uuid) returns integer language sql stable as $$ select count(*)::int from public.shops where partner_user_id=p_partner and public.gp_shop_qualifies(id) $$;
      create function public.get_my_partner_dashboard() returns jsonb language sql stable as $$ select jsonb_build_object('qualifying_shops',public.gp_qualifying_shop_count(auth.uid())) $$;
      revoke all on function public.gp_qualifying_shop_count(uuid),public.gp_shop_qualifies(uuid) from public,authenticated,anon;
      grant execute on function public.get_my_partner_dashboard() to authenticated;
      select set_config('request.jwt.claim.sub','${actor}',false);
      set role authenticated;`);
    await assert.rejects(db.query('select public.get_my_partner_dashboard()'),(e:any)=>e.code==='42501' && /gp_qualifying_shop_count/.test(e.message));
    await db.exec('reset role');
    const sql=readFileSync(new URL('../supabase/migrations/20260930045808_partner_dashboard_helper_permissions.sql',import.meta.url),'utf8');
    await db.exec(sql); await db.exec(sql);
    await db.exec('set role authenticated');
    assert.equal((await db.query<any>('select public.get_my_partner_dashboard() as payload')).rows[0].payload.qualifying_shops,1);
    assert.equal((await db.query<any>('select public.gp_qualifying_shop_count($1) as count',[other])).rows[0].count,0);
    await db.exec('reset role');
    const result=await db.query<any>("select has_function_privilege('anon','public.gp_qualifying_shop_count(uuid)','EXECUTE') as count_access, has_function_privilege('anon','public.gp_shop_qualifies(uuid)','EXECUTE') as shop_access");
    assert.equal(result.rows[0].count_access,false); assert.equal(result.rows[0].shop_access,false);
  }finally{await db.close();}
});

test('optional QR schema can be absent when the permission migration runs',async()=>{
  const db=new PGlite();
  try{await db.exec('create role anon; create role authenticated');
    await db.exec(readFileSync(new URL('../supabase/migrations/20260930045808_partner_dashboard_helper_permissions.sql',import.meta.url),'utf8'));
  }finally{await db.close();}
});
