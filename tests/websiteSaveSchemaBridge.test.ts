import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { websiteDatabase, actor, other, salon, foreignSalon } from './helpers/websiteDatabase';

const repair = await readFile(new URL('../supabase/migrations/20261026000000_website_save_schema_bridge.sql', import.meta.url), 'utf8');
const legacyId = '30000000-0000-4000-8000-000000000001';
async function reportedDatabase() {
  const db = await websiteDatabase();
  // Reproduce the user's reported missing-column/function set, plus the
  // original 00001 services.owner_id NOT NULL constraint.
  await db.exec(`create table auth.users(id uuid primary key);
    insert into auth.users values('${actor}'),('${other}');
    alter table services add column owner_id uuid not null references auth.users(id);
    alter table services drop column salon_id, drop column price_paise,
      drop column is_active, drop column is_bookable_online, drop column is_featured, drop column display_order;
    alter table salons drop column address, drop column area, drop column city,
      drop column email, drop column landmark, drop column latitude, drop column longitude,
      drop column mobile, drop column pincode, drop column state, drop column whatsapp;
    alter table staff_schedules drop column is_working;
    drop function public.nexora_catalog_uuid(uuid,text,text);
    drop function public.nexora_save_owner_workspace(jsonb);
    drop function public.nexora_website_image_url(text);
    drop function public.nexora_website_youtube_id(text);
    drop function public.sync_owner_contact(jsonb);
    insert into services(id,owner_id,name,price,duration_minutes) values('${legacyId}','${other}','Legacy service',900,45);`);
  return db;
}
const state = () => ({
  profile: { ownerId: actor, ownerName: 'Test Owner', businessName: 'My Studio', businessType: 'hair_salon', subdomain: 'mine', phone: '9876543210', address: 'Studio Road', city: 'Jaipur' },
  services: [{ id: 'new-service', name: 'Haircut', price: 650, durationMinutes: 45 }],
  stylists: [{ id: 'stylist', name: 'Stylist', assignedServices: ['new-service'], schedule: [{ day: 'Monday', fromTime: '09:00', toTime: '18:00', enabled: true }] }],
});
const save = (db: any, input = state()) => db.query('select public.save_owner_editor_state($1::jsonb)', [JSON.stringify(input)]);

test('reported mixed schema fails before repair, then saves atomically and round-trips after repeat application', async () => {
  const db = await reportedDatabase();
  try {
    await assert.rejects(save(db), /does not exist/);
    await db.exec(repair);
    await db.exec(repair);
    await db.exec('set role authenticated');
    await save(db);
    await save(db);
    await db.exec('reset role');
    const rows = (await db.query<any>('select * from services order by name')).rows;
    assert.equal(rows.length, 2);
    const added = rows.find(r => r.name === 'Haircut');
    assert.equal(added.owner_id, actor);
    assert.equal(added.salon_id, salon);
    assert.equal(Number(added.price_paise), 65000);
    assert.equal(added.is_bookable_online, true);
    const legacy = rows.find(r => r.id === legacyId);
    assert.equal(legacy.owner_id, other);
    assert.equal(legacy.salon_id, null, 'never guess an existing service salon');
    assert.equal(Number(legacy.price), 900);
    assert.equal((await db.query<any>('select is_working from staff_schedules')).rows[0].is_working, true);
    const saved = (await db.query<any>('select state from owner_editor_state where owner_id=$1', [actor])).rows[0].state;
    assert.equal(saved.profile.ownerName, 'Test Owner');
    assert.equal(saved.services[0].name, 'Haircut');
    assert.equal((await db.query<any>('select phone from salons where id=$1', [foreignSalon])).rows[0].phone, 'private');
    const flags = (await db.query<any>("select relrowsecurity from pg_class where oid='public.services'::regclass")).rows[0];
    assert.equal(flags.relrowsecurity, true);
  } finally { await db.close(); }
});

test('repair retains atomic rollback, rejects unlinked legacy IDs and cross-account profile spoofing', async () => {
  const db = await reportedDatabase();
  try {
    await db.exec(repair);
    await save(db);
    const before = (await db.query<any>('select state from owner_editor_state')).rows[0].state;
    await db.exec('set role authenticated');
    for (const bad of [
      { ...state(), profile: { ...state().profile, ownerId: other } },
      { ...state(), services: [{ ...state().services[0], id: legacyId }] },
      { ...state(), services: [{ ...state().services[0], price: -1 }] },
    ]) await assert.rejects(save(db, bad));
    await db.exec('reset role');
    assert.deepEqual((await db.query<any>('select state from owner_editor_state')).rows[0].state, before);
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await assert.rejects(save(db), /Sign in required/);
  } finally { await db.close(); }
});


test('repair replaces a deployed JSONB-returning wrapper atomically and restores its execute grant', async () => {
  const db = await reportedDatabase();
  try {
    await db.exec(`drop function public.save_owner_editor_state(jsonb);
      create function public.save_owner_editor_state(p_state jsonb)
      returns jsonb language sql as $$ select p_state $$;`);
    await db.exec(repair);
    await db.exec(repair);
    const result = await db.query<any>(`select pg_get_function_result('public.save_owner_editor_state(jsonb)'::regprocedure) as result,
      has_function_privilege('authenticated','public.save_owner_editor_state(jsonb)','EXECUTE') as allowed,
      has_function_privilege('anon','public.save_owner_editor_state(jsonb)','EXECUTE') as anonymous`);
    assert.deepEqual(result.rows[0], { result: 'void', allowed: true, anonymous: false });
    await db.exec('set role authenticated');
    await save(db);
    await db.exec('reset role');
    assert.equal((await db.query<any>('select state from owner_editor_state where owner_id=$1', [actor])).rows[0].state.services[0].name, 'Haircut');
  } finally { await db.close(); }
});

test('a dependent view blocks wrapper replacement without deleting dependencies or leaving partial DDL', async () => {
  const db = await reportedDatabase();
  try {
    await db.exec(`drop function public.save_owner_editor_state(jsonb);
      create function public.save_owner_editor_state(p_state jsonb)
      returns jsonb language sql as $$ select p_state $$;
      create view public.wrapper_dependency as select public.save_owner_editor_state('{}'::jsonb) as value;`);
    await assert.rejects(db.exec(repair), /depend/);
    await db.exec('rollback');
    assert.equal((await db.query<any>("select pg_get_function_result('public.save_owner_editor_state(jsonb)'::regprocedure) result")).rows[0].result, 'jsonb');
    assert.deepEqual((await db.query('select value from wrapper_dependency')).rows, [{ value: {} }]);
    assert.equal((await db.query<any>("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='salons' and column_name='mobile'")).rows[0].n, 0);
  } finally { await db.close(); }
});


test('complete editor migration also upgrades the originally reported mixed schema directly', async () => {
  const db = await reportedDatabase();
  try {
    const complete = await readFile(new URL('../supabase/migrations/20261028000000_complete_website_editor_persistence.sql', import.meta.url), 'utf8');
    await db.exec(complete); await db.exec(complete);
    await db.exec('set role authenticated');
    await save(db);
    await db.exec('reset role');
    assert.equal((await db.query<any>('select state from owner_editor_state where owner_id=$1', [actor])).rows[0].state.services[0].name, 'Haircut');
  } finally { await db.close(); }
});
