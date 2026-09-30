import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {test} from 'node:test';import {PGlite} from '@electric-sql/pglite';
test('legacy staff inserts retain required unique editor identity',async()=>{const db=new PGlite();try{
 await db.exec('create role authenticated;create role anon;create table staff(id uuid primary key,salon_id uuid,editor_key text not null,unique(salon_id,editor_key));');
 const sql=readFileSync(new URL('../supabase/migrations/20260930065344_owner_workspace_staff_editor_key.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
 const id='00000000-0000-0000-0000-000000000001',salon='00000000-0000-0000-0000-000000000010';
 await db.query('insert into staff(id,salon_id) values($1,$2)',[id,salon]);
 assert.equal((await db.query<any>('select editor_key from staff where id=$1',[id])).rows[0].editor_key,id);
 await db.query("insert into staff values('00000000-0000-0000-0000-000000000002',$1,'EXPLICIT')",[salon]);
 assert.equal((await db.query<any>("select count(*)::int as n from staff where editor_key='EXPLICIT'")).rows[0].n,1);
 await assert.rejects(()=>db.query("insert into staff values('00000000-0000-0000-0000-000000000003',$1,'EXPLICIT')",[salon]),/unique constraint/);
 await db.query('insert into staff(id,salon_id) values($1,$2) on conflict(id) do update set salon_id=excluded.salon_id',[id,salon]);
 assert.equal((await db.query<any>('select count(*)::int as n from staff')).rows[0].n,2);
 }finally{await db.close();}});
