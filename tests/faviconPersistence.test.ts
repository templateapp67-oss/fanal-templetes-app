import test from 'node:test';
import assert from 'node:assert/strict';
import { websiteDatabase, actor, salon } from './helpers/websiteDatabase';
import { uploadWebsiteFavicon } from '../src/lib/faviconStorage';

test('favicon letter, color and image URL round-trip and clearing the custom image persists', async () => {
  const db = await websiteDatabase();
  try {
    const profile = { ownerId: actor, businessName: 'Studio', businessType: 'hair_salon', subdomain: 'mine', phone: '9876543210', address: 'Studio Road', city: 'Jaipur', faviconLetter: 'S', faviconColor: '#123456', customFaviconUrl: 'https://example.com/favicon.png' };
    for (const url of [profile.customFaviconUrl, '']) {
      profile.customFaviconUrl = url;
      await db.query('select public.save_owner_editor_state($1::jsonb)', [JSON.stringify({ profile })]);
      const saved = (await db.query<any>('select state from owner_editor_state where owner_id=$1', [actor])).rows[0].state.profile;
      const publicProfile = (await db.query<any>('select data from salons where id=$1', [salon])).rows[0].data.editor_profile;
      for (const p of [saved, publicProfile]) {
        assert.equal(p.faviconLetter, 'S'); assert.equal(p.faviconColor, '#123456'); assert.equal(p.customFaviconUrl, url);
      }
    }
  } finally { await db.close(); }
});

test('favicon uploads use the authenticated folder and propagate bucket errors', async () => {
  const calls: any[] = [];
  let fail = false;
  const client: any = {
    auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) },
    storage: { from: (bucket: string) => ({
      upload: async (path: string, image: Blob, options: any) => { calls.push({ bucket, path, options }); return { error: fail ? { message: 'Bucket not found' } : null }; },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.com/${path}` } }),
    }) },
  };
  const image = new Blob(['test'], { type: 'image/png' });
  const url = await uploadWebsiteFavicon(client, image, actor);
  assert.ok(url.startsWith(`https://example.com/${actor}/`));
  assert.equal(calls[0].bucket, 'website-favicons');
  assert.equal(calls[0].options.upsert, false);
  await assert.rejects(uploadWebsiteFavicon(client, image, 'other-owner'), /account changed/);
  assert.equal(calls.length, 1);
  await assert.rejects(uploadWebsiteFavicon(client, new Blob(['<svg/>'], { type: 'image/svg+xml' }), actor), /PNG/);
  fail = true;
  await assert.rejects(uploadWebsiteFavicon(client, image, actor), /Bucket not found/);
});
