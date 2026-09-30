import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {test} from 'node:test';import {PGlite} from '@electric-sql/pglite';
test('blank staff drafts do not block named staff or lose editor draft data',async()=>{const db=new PGlite();try{
 await db.exec(`create table staff(name text);create table owner_editor_state(state jsonb);
 create function nexora_save_owner_workspace(p_state jsonb) returns void language plpgsql security definer as $$declare item jsonb;begin
 for item in select value from jsonb_array_elements(p_state->'stylists') loop
 if coalesce(btrim(item->>'name'),'')='' then raise exception 'Staff name is required' using errcode = '22023';end if;
 insert into staff values(item->>'name');end loop;insert into owner_editor_state values(p_state);end $$;`);
 const sql=readFileSync(new URL('../supabase/migrations/20260930070627_owner_workspace_empty_staff_drafts.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
 const state={stylists:[{name:'',avatarUrl:'https://example.test/draft.png'},{name:'   '},{name:'Named Stylist'}]};
 await db.query('select nexora_save_owner_workspace($1::jsonb)',[JSON.stringify(state)]);
 assert.deepEqual((await db.query('select name from staff')).rows,[{name:'Named Stylist'}]);
 assert.deepEqual((await db.query<any>('select state from owner_editor_state')).rows[0].state,state);
 assert.equal((await db.query<any>("select prosecdef from pg_proc where proname='nexora_save_owner_workspace'")).rows[0].prosecdef,true);
 }finally{await db.close();}});
