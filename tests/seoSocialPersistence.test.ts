import test from 'node:test';
import assert from 'node:assert/strict';
import { websiteDatabase, actor, salon } from './helpers/websiteDatabase';
import { injectSocialMetadata } from '../src/lib/socialMetadata';
import { parseSeoKeywords } from '../src/lib/seoKeywords';
import { getTikTokValue, formatInstagramUrl, formatFacebookUrl, formatTikTokUrl } from '../src/utils/social';
import { applyPublicWebsiteContent } from '../server/websiteContent';

test('shared keywords and social normalization support handles, full URLs, legacy values and clears', () => {
  assert.deepEqual(parseSeoKeywords(' salon, Hair Care, ,SALON, hair care, Jaipur '), ['salon', 'Hair Care', 'Jaipur']);
  assert.equal(formatInstagramUrl('@studio'), 'https://www.instagram.com/studio');
  assert.equal(formatFacebookUrl('https://facebook.com/my.page'), 'https://facebook.com/my.page');
  assert.equal(formatTikTokUrl('www.tiktok.com/@studio'), 'https://www.tiktok.com/@studio');
  assert.equal(formatTikTokUrl('javascript:alert(1)'), '');
  assert.equal(formatInstagramUrl('https://instagram.com.evil.example/'), '');
  assert.equal(getTikTokValue({ tiktokProfile: '@legacy' }), '@legacy');
  assert.equal(getTikTokValue({ tiktokHandle: '', tiktokProfile: '@legacy' }), '@legacy');
  assert.equal(getTikTokValue({ tiktokHandle: '', tiktokProfile: '', tiktokUrl: '' }), '');
});

test('all six fields persist, publish, update and clear through the real Supabase transaction', async () => {
  const db = await websiteDatabase();
  try {
    const profile = { ownerId: actor, businessName: 'Studio', businessType: 'hair_salon', subdomain: 'mine', phone: '9876543210', address: 'Road', city: 'Jaipur' };
    for (const suffix of ['first', 'updated', '']) {
      const fields = { seoTitle: suffix, seoDescription: suffix, seoKeywords: suffix ? `${suffix}, salon, SALON` : '', instagramHandle: suffix ? `@${suffix}` : '', facebookPage: suffix ? `https://facebook.com/${suffix}` : '', tiktokHandle: suffix ? `@${suffix}` : '', tiktokProfile: suffix ? `@${suffix}` : '', tiktokUrl: suffix ? `@${suffix}` : '' };
      await db.query('select save_owner_editor_state($1::jsonb)', [JSON.stringify({ profile: { ...profile, ...fields } })]);
      const saved = (await db.query<any>('select state from owner_editor_state where owner_id=$1', [actor])).rows[0].state.profile;
      const publicJson = (await db.query<any>('select data from salons where id=$1', [salon])).rows[0].data.editor_profile;
      const published = applyPublicWebsiteContent({} as any, publicJson);
      for (const [key, value] of Object.entries(fields)) {
        assert.equal(saved[key], value); assert.equal((published as any)[key], value);
      }
      const html = injectSocialMetadata('<html><head><meta name="keywords" content="OLD"></head><body></body></html>', published, 'https://app.vercel.app/?site=mine');
      assert.ok(html.includes(`<meta name="keywords" content="${suffix ? `${suffix}, salon` : ''}">`));
      assert.equal((html.match(/name="keywords"/g) || []).length, 1);
      assert.ok(!html.includes('content="OLD"'));
      if (suffix) { assert.ok(html.includes(`<title>${suffix}</title>`)); assert.ok(html.includes(`<meta name="description" content="${suffix}">`)); }
    }
  } finally { await db.close(); }
});
