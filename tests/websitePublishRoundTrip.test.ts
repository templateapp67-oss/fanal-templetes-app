import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { websiteDatabase, actor, other, salon } from './helpers/websiteDatabase';

// Auth/PostgREST are local test transports; the transaction itself runs in
// real PostgreSQL (PGlite), not a fake success-returning RPC.
test('HTTP save → PostgreSQL → private reload → public content → deletion and tenant isolation', async () => {
  const db = await websiteDatabase();
  await db.exec(`alter table salons add column owner_id uuid; alter table salons add column is_active boolean default true; alter table salons add column deleted_at timestamptz;
    alter table staff add column is_public boolean default true; create table salon_hours(salon_id uuid,day_of_week int,opens_at time,closes_at time,is_closed boolean);`);
  await db.query('update salons set owner_id=$1 where id=$2', [actor, salon]);
  const transport = express(); transport.use(express.json({ limit: '10mb' }));
  transport.get('/auth/v1/user', (req, res) => {
    const id = req.headers.authorization === 'Bearer owner-a' ? actor : req.headers.authorization === 'Bearer owner-b' ? other : null;
    res.status(id ? 200 : 401).json(id ? { id, aud: 'authenticated', role: 'authenticated' } : { message: 'Unauthorized' });
  });
  transport.post('/rest/v1/rpc/:fn', async (req, res) => {
    const id = req.headers.authorization === 'Bearer owner-a' ? actor : other;
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    try {
      if (req.params.fn === 'save_owner_editor_state') {
        await db.exec('set role authenticated');
        await db.query('select public.save_owner_editor_state($1::jsonb)', [JSON.stringify(req.body.p_state)]);
        res.json(null);
      } else if (req.params.fn === 'get_owner_editor_state') {
        res.json((await db.query<any>('select state from owner_editor_state where owner_id=$1', [id])).rows[0]?.state || null);
      } else res.status(404).json({ code: 'PGRST202', message: 'Unknown RPC' });
    } catch (e: any) { res.status(400).json({ code: e.code, message: e.message }); }
    finally { await db.exec('reset role'); }
  });
  const authServer = createServer(transport); await new Promise<void>(resolve => authServer.listen(0, '127.0.0.1', resolve));
  const authPort = (authServer.address() as any).port;
  process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL = `http://127.0.0.1:${authPort}`;
  process.env.SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY = 'test-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service';
  const { handleWebsiteSave, handleGetSalonState } = await import('../server/websiteSave');
  const { lookupSalon } = await import('../server/siteLookup');
  // Real SQL rows behind the public mapper's query interface.
  const publicDb = { from(table: string) {
    if (!['salons', 'services', 'staff', 'salon_hours', 'owner_editor_state'].includes(table)) throw Error('Unexpected table');
    const filters: Array<(row: any) => boolean> = []; let single = false;
    const q: any = {
      select: () => q, eq: (k: string, v: any) => { filters.push(r => r[k] === v); return q; },
      is: (k: string, v: any) => { filters.push(r => r[k] === v); return q; },
      or: () => { filters.push(r => r.is_bookable_online !== false); return q; }, order: () => q, limit: () => q,
      maybeSingle: () => { single = true; return q; },
      then: async (resolve: any, reject: any) => { try {
        const rows: any[] = (await db.query(`select * from public.${table}`)).rows.filter(r => filters.every(f => f(r)));
        if (table === 'staff') for (const row of rows) row.staff_services = (await db.query('select * from staff_services where staff_id=$1', [row.id])).rows;
        return resolve({ data: single ? rows[0] || null : rows, error: null });
      } catch (e) { return reject(e); } },
    }; return q;
  } };
  const app = express(); app.use(express.json({ limit: '10mb' }));
  app.post('/api/website/save', handleWebsiteSave({ mockSalons: {} }));
  app.get('/api/salon', handleGetSalonState({ mockSalons: {} }));
  app.get('/api/site/:slug', async (req, res) => res.json(await lookupSalon({ db: publicDb as any, isMockSupabase: false, mockSalons: {} }, req.params.slug)));
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const request = (data: any, token = 'owner-a') => fetch(`${base}/api/website/save`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ salonData: data }) });
  const state: any = {
    ownerId: actor, selectedTemplateId: 'nail_studio',
    profile: { ownerId: actor, businessName: 'My Nail Studio', ownerName: 'Priya', phone: '9876543210', businessType: 'nail_studio', address: 'Studio Road', city: 'Jaipur', subdomain: 'mine', ownerBio: 'Artist and founder', ownerPhotoUrl: 'https://example.com/priya.jpg', dob: '1990-01-01', socialVideos: [{ id: 'video-1', youtubeUrl: 'https://youtu.be/aqz-KE-bpKQ', title: 'Studio tour', categoryTag: 'SHOWCASE' }], gallery: [{ id: 'gallery-1', title: 'Studio', tag: 'Our work', url: 'https://example.com/gallery.jpg' }], sectionHeadings: { servicesTitle: 'Our nail menu' }, sectionVisibility: { metrics: false }, testimonials: [] },
    services: [{ id: 'nail-1', name: 'Gel nails', price: 900, durationMinutes: 45, description: 'A polished finish', imageUrl: 'https://example.com/nails.jpg', category: 'Nails', showDuration: false }], stylists: [],
  };
  try {
    assert.equal((await request(state)).status, 200);
    const saved = await fetch(`${base}/api/salon?ownerId=${other}`, { headers: { Authorization: 'Bearer owner-a' } }).then(r => r.json());
    assert.equal(saved.data.selectedTemplateId, 'nail_studio'); assert.equal(saved.data.profile.ownerBio, state.profile.ownerBio);
    let pub = await fetch(`${base}/api/site/mine`).then(r => r.json());
    assert.equal(pub.found, true); assert.equal(pub.salon.selectedTemplateId, 'nail_studio');
    assert.equal(pub.salon.profile.ownerBio, 'Artist and founder'); assert.equal(pub.salon.profile.ownerPhotoUrl, state.profile.ownerPhotoUrl);
    assert.equal(pub.salon.profile.sectionHeadings.servicesTitle, 'Our nail menu'); assert.equal(pub.salon.profile.sectionVisibility.metrics, false);
    assert.equal(pub.salon.services[0].name, 'Gel nails'); assert.equal(pub.salon.services[0].price, 900); assert.equal(pub.salon.services[0].showDuration, false);
    assert.equal(pub.salon.services[0].imageUrl, state.services[0].imageUrl); assert.notEqual(pub.salon.services[0].id, 'nail-1', 'bookable IDs come from PostgreSQL');
    assert.equal(pub.salon.profile.socialVideos[0].videoId, 'aqz-KE-bpKQ'); assert.equal(pub.salon.profile.gallery.length, 1);
    assert.equal(pub.salon.profile.ownerId, undefined); assert.equal(pub.salon.profile.dob, undefined);
    assert.equal((await request(state, 'owner-b')).status, 401);
    assert.equal((await request({ ...state, services: [{ ...state.services[0], price: -20 }] })).status, 400);
    const cleared = { ...state, services: [], profile: { ...state.profile, gallery: [], socialVideos: [], ownerPhotoUrl: '', coverImageUrl: '' } };
    assert.equal((await request(cleared)).status, 200);
    pub = await fetch(`${base}/api/site/mine`).then(r => r.json());
    assert.deepEqual(pub.salon.services, []); assert.deepEqual(pub.salon.profile.gallery, []); assert.deepEqual(pub.salon.profile.socialVideos, []);
    assert.equal(pub.salon.profile.ownerPhotoUrl, ''); assert.equal(pub.salon.profile.coverImageUrl, '');
    // A different salon's latest owner snapshot cannot bleed into this site.
    await db.query('update owner_editor_state set state=$1', [JSON.stringify({ salonId: 'another-site', selectedTemplateId: 'barber', profile: { ownerBio: 'Wrong site', socialVideos: [] } })]);
    pub = await fetch(`${base}/api/site/mine`).then(r => r.json());
    assert.equal(pub.salon.profile.ownerBio, 'Artist and founder'); assert.equal(pub.salon.selectedTemplateId, 'nail_studio');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await new Promise<void>(resolve => authServer.close(() => resolve()));
    await db.close();
  }
});
