import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { websiteDatabase, actor, other, salon, foreignSalon } from './helpers/websiteDatabase';
import { catalogId } from '../server/normalizedBookingCreate';

const state = () => ({
  selectedTemplateId: 'hair_salon',
  profile: { ownerId: actor, ownerName: 'Owner', businessName: 'My Studio', businessType: 'hair_salon', subdomain: 'mine', phone: '9876543210', address: 'Studio Road', city: 'Jaipur',
    ownerBio: 'My biography', ownerPhotoUrl: 'https://example.com/owner.jpg', gallery: [], socialVideos: [], sectionVisibility: { gallery: false } },
  services: [{ id: 'service-one', name: 'Precision Cut', description: 'Cut & finish', category: 'Hair', imageUrl: 'https://example.com/cut.jpg', price: 750, durationMinutes: 45, showDuration: false }],
  stylists: [{ id: 'stylist-one', name: 'Stylist', avatarUrl: 'https://example.com/stylist.jpg', assignedServices: ['service-one'] }],
});
const save = (db: any, input: unknown) => db.query('select public.save_owner_editor_state($1::jsonb)', [JSON.stringify(input)]);

test('repair applied AFTER relaxed overrides atomically saves the actual public catalogue and full editor state', async () => {
  const db = await websiteDatabase();
  try {
    await db.exec('set role authenticated'); await save(db, state()); await db.exec('reset role');
    const service: any = (await db.query('select * from services')).rows[0];
    assert.equal(service.id, catalogId(salon, 'service', 'service-one'));
    assert.equal(Number(service.price_paise), 75000);
    assert.equal(service.duration_minutes, 45);
    assert.equal((await db.query('select * from staff')).rows.length, 1);
    const saved: any = (await db.query('select state from owner_editor_state')).rows[0];
    assert.equal(saved.state.salonId, salon);
    assert.equal(saved.state.profile.ownerBio, 'My biography');
    const row: any = (await db.query('select data from salons where id=$1', [salon])).rows[0];
    assert.equal(row.data.website_content_version, 1);
    assert.equal(row.data.selected_template_id, 'hair_salon');
    assert.equal(row.data.editor_services[0].imageUrl, state().services[0].imageUrl);
    assert.equal(row.data.editor_profile.ownerId, undefined);
    await db.exec(await readFile(new URL('../supabase/migrations/20261022000000_restore_atomic_website_save.sql', import.meta.url), 'utf8'));
    await save(db, state());
    assert.equal((await db.query('select * from services')).rows.length, 1, 'retry does not duplicate services');
  } finally { await db.close(); }
});

test('delete + reload + re-add preserves historical rows and never fails on stale staff assignments', async () => {
  const db = await websiteDatabase();
  try {
    await save(db, state());
    const deleted = { ...state(), services: [] };
    await save(db, deleted);
    let service: any = (await db.query('select * from services')).rows[0];
    assert.equal(service.is_active, false); assert.equal(service.is_bookable_online, false);
    assert.deepEqual((await db.query<any>('select state from owner_editor_state')).rows[0].state.services, []);
    assert.equal((await db.query('select * from staff_services where is_active')).rows.length, 0);
    await save(db, state());
    service = (await db.query('select * from services')).rows[0];
    assert.equal(service.is_active, true); assert.equal(service.is_bookable_online, true);
    assert.equal((await db.query('select * from staff_services where is_active')).rows.length, 1);
  } finally { await db.close(); }
});

test('invalid catalogue, spoofed identities and anonymous calls cannot partially save', async () => {
  const db = await websiteDatabase();
  try {
    await save(db, state());
    const before = (await db.query<any>('select state from owner_editor_state')).rows[0].state;
    for (const bad of [
      { ...state(), profile: { ...state().profile, ownerId: other } },
      { ...state(), ownerId: other },
      { ...state(), services: [{ ...state().services[0], durationMinutes: 1.5 }] },
      { ...state(), services: [{ ...state().services[0], price: null }] },
      { ...state(), services: [{ ...state().services[0], price: -1 }] },
      { ...state(), profile: { ...state().profile, address: '' } },
      { ...state(), services: [...state().services, ...state().services] },
    ]) await assert.rejects(save(db, bad));
    assert.deepEqual((await db.query<any>('select state from owner_editor_state')).rows[0].state, before);
    await db.exec('set role anon'); await assert.rejects(save(db, state()), /permission denied/);
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
    await assert.rejects(save(db, { ...state(), profile: { ...state().profile, ownerId: other, subdomain: 'other' }, services: [{ ...state().services[0], id: catalogId(salon, 'service', 'service-one') }] }), /another salon/);
    assert.equal((await db.query<any>('select name from salons where id=$1', [foreignSalon])).rows[0].name, 'Other');
  } finally { await db.close(); }
});

test('profile-only save preserves the catalogue and changing the public slug stays on the same salon', async () => {
  const db = await websiteDatabase();
  try {
    await save(db, state());
    await save(db, { profile: { ...state().profile, subdomain: 'renamed-studio', ownerPhotoUrl: '' } });
    const row: any = (await db.query('select * from salons where id=$1', [salon])).rows[0];
    assert.equal(row.slug, 'renamed-studio');
    assert.equal(row.data.editor_profile.ownerPhotoUrl, '');
    assert.equal(row.data.selected_template_id, 'hair_salon');
    assert.equal(row.data.editor_services.length, 1);
    assert.equal((await db.query('select * from services where is_active')).rows.length, 1);
  } finally { await db.close(); }
});

test('direct RPC rejects unsafe media and maintains fourteen-per-placement video limits', async () => {
  const db = await websiteDatabase();
  try {
    const video = { id: 'v1', title: 'Showcase', categoryTag: 'SHOWCASE', youtubeUrl: 'https://youtu.be/aqz-KE-bpKQ' };
    for (const youtubeUrl of ['https://youtu.be/aqz-KE-bpKQ', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=10', 'https://youtube.com/shorts/aqz-KE-bpKQ', 'https://youtube-nocookie.com/embed/aqz-KE-bpKQ']) await save(db, { ...state(), profile: { ...state().profile, socialVideos: [{ ...video, youtubeUrl }] } });
    for (const youtubeUrl of ['https://example.com/file.mp4', 'https://youtube.com/watch?bad=1', 'https://youtu.be/short', 'https://youtube.com.evil.test/watch?v=aqz-KE-bpKQ']) await assert.rejects(save(db, { ...state(), profile: { ...state().profile, socialVideos: [{ ...video, youtubeUrl }] } }));
    await assert.rejects(save(db, { ...state(), profile: { ...state().profile, socialVideos: Array.from({ length: 15 }, (_, i) => ({ ...video, id: `v${i}` })) } }), /placement limit/);
    for (const url of ['javascript:alert(1)', '//evil.test/file', '/\\evil.test/file', 'data:image/svg+xml,test']) await assert.rejects(save(db, { ...state(), profile: { ...state().profile, ownerPhotoUrl: url } }));
    await assert.rejects(save(db, { ...state(), profile: { ...state().profile, gallery: [{ id: 'p1', url: 'javascript:alert(1)' }] } }));
    await assert.rejects(save(db, { ...state(), profile: { ...state().profile, socialVideos: null } }));
    assert.equal((await db.query<any>('select count(*)::int as count from services')).rows[0].count, 1);
  } finally { await db.close(); }
});

test('multi-site saves and deletions use per-salon history; a rename changes only the selected salon contact', async () => {
  const db = await websiteDatabase();
  const second = '20000000-0000-4000-8000-000000000003';
  try {
    await db.query('insert into salons(id,slug,name) values($1,$2,$3)', [second, 'second-studio', 'Second']);
    await db.query('insert into membership(actor,salon_id) values($1,$2)', [actor, second]);
    await save(db, state());
    const b = { ...state(), selectedTemplateId: 'nail_studio', profile: { ...state().profile, subdomain: 'second-studio', businessName: 'Second', phone: '9000000001' } };
    await save(db, b);
    await save(db, { ...state(), services: [] });
    assert.equal((await db.query<any>('select count(*)::int as n from services where salon_id=$1 and is_active', [salon])).rows[0].n, 0);
    assert.equal((await db.query<any>('select count(*)::int as n from services where salon_id=$1 and is_active', [second])).rows[0].n, 1);
    assert.equal((await db.query<any>('select phone from salons where id=$1', [second])).rows[0].phone, '9000000001');
    await db.exec(`create function public.owner_workspace_pick_salon() returns jsonb language sql as $$ select jsonb_build_object('salon_id','${second}') $$`);
    await save(db, { ...b, profile: { ...b.profile, subdomain: 'renamed-second', phone: '9000000002' } });
    const secondRow = (await db.query<any>('select * from salons where id=$1', [second])).rows[0];
    assert.equal(secondRow.slug, 'renamed-second'); assert.equal(secondRow.phone, '9000000002');
    const firstRow = (await db.query<any>('select * from salons where id=$1', [salon])).rows[0];
    assert.equal(firstRow.slug, 'mine'); assert.equal(firstRow.phone, state().profile.phone);
  } finally { await db.close(); }
});

test('public per-site metadata drops arbitrary private profile fields while the private draft remains intact', async () => {
  const db = await websiteDatabase();
  try {
    await save(db, { ...state(), profile: { ...state().profile, dob: '1990-01-01', privateNotes: 'private-client-note', userId: actor } });
    const published = (await db.query<any>('select data from salons where id=$1', [salon])).rows[0].data.editor_profile;
    assert.equal(published.privateNotes, undefined); assert.equal(published.dob, undefined); assert.equal(published.ownerId, undefined); assert.equal(published.userId, undefined);
    assert.equal(published.ownerBio, 'My biography');
    assert.equal((await db.query<any>('select state from owner_editor_state')).rows[0].state.profile.privateNotes, 'private-client-note');
  } finally { await db.close(); }
});
