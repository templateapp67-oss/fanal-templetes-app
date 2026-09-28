import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { websiteDatabase, actor, other, salon } from './helpers/websiteDatabase';
import { mergeHydratedSalonState } from '../src/lib/hydrationMerge';
import { applyPublicWebsiteContent } from '../server/websiteContent';

const migration = await readFile(new URL('../supabase/migrations/20261028000000_complete_website_editor_persistence.sql', import.meta.url), 'utf8');
const profile = {
  ownerId: actor, businessName: 'My Studio', businessType: 'hair_salon', tagline: 'Your style', about: 'Our story', ownerName: 'Asha Sharma',
  phone: '9876543210', whatsapp: '9876543210', email: 'contact@example.com', city: 'Jaipur', postalCode: '302001', areaLocality: 'Central', address: 'Studio Road',
  faviconLetter: 'S', faviconColor: '#123456', customFaviconUrl: 'https://example.com/icon.png',
  primaryColor: '#111111', secondaryColor: '#222222', customAccentColor: '#333333', backgroundColor: '#ffffff', headingStyle: 'classic', buttonStyle: 'rounded', borderRadius: '12px', appearance: 'light',
  headingFont: 'Lora', bodyFont: 'Inter', socialShareImageUrl: 'https://example.com/og.png', seoTitle: 'Studio Jaipur', seoDescription: 'Local styling', seoKeywords: 'hair, salon',
  instagramHandle: '@studio', facebookPage: 'https://facebook.com/studio', tiktokUrl: 'https://tiktok.com/@studio',
  ownerPhotoUrl: 'https://example.com/owner.png', ownerRole: 'Founder', ownerExperience: '10 years', ownerQualifications: 'Certified stylist', ownerBio: 'My biography',
  socialVideos: [{ id: 'video', title: 'Studio tour', youtubeUrl: 'https://youtu.be/aqz-KE-bpKQ', categoryTag: 'SHOWCASE' }],
  gallery: [{ id: 'gallery', url: 'https://example.com/gallery.png', title: 'Our work', tag: 'Hair' }],
  lookbookPhotos: [{ id: 'lookbook', url: 'https://example.com/lookbook.png', title: 'Latest style', tag: 'Style' }],
  testimonials: [{ id: 'review', name: 'Client', comment: 'Great visit', rating: 5 }],
  sectionVisibility: { header: true, hero: false, about: true, services: true, offers: false, gallery: true, location: true, whatsappFloat: false },
  sectionHeadings: { servicesTitle: 'Treatments', servicesSubtitle: 'Our menu' },
  scentProfile: 'Citrus & Cedar', soundscape: 'Soft Piano & Spa', consultationStyle: 'Luxury Concierge', subdomain: 'mine', whiteLabelEnabled: true,
};

test('all editor sections round-trip through real RPC, refresh merge and public JSON; ownership stays isolated', async () => {
  const db = await websiteDatabase();
  try {
    await db.exec(`create table auth.users(id uuid primary key); insert into auth.users values('${actor}'),('${other}');
      grant usage on schema auth to authenticated; grant select on profiles to authenticated;`);
    await db.query('update profiles set full_name=$1 where id=$2', [profile.ownerName, actor]);
    await db.exec(migration); await db.exec(migration);
    await db.exec('set role authenticated');
    await db.query('select save_owner_editor_state($1::jsonb)', [JSON.stringify({ profile: { ...profile, ownerName: 'Demo Person' }, services: [], stylists: [] })]);
    const saved = (await db.query<any>('select get_owner_editor_state() as state')).rows[0].state;
    assert.deepEqual(saved.profile, profile, 'every field and array persisted, authoritative account name replaces demo');
    const current = { profile: { ownerName: 'User' }, services: [], stylists: [], loyaltyConfig: {}, selectedTemplateId: 'hair_salon' };
    const restored = mergeHydratedSalonState({ current, beforeRead: current, saved, userId: actor });
    assert.deepEqual(restored?.profile, profile, 'refresh restores saved fields over startup defaults');
    await db.exec('reset role');
    const publicProfile = (await db.query<any>('select data from salons where id=$1', [salon])).rows[0].data.editor_profile;
    const { ownerId, ...publicExpected } = profile;
    assert.deepEqual(publicProfile, publicExpected);
    const mapped = applyPublicWebsiteContent({} as any, publicProfile);
    assert.equal(mapped.scentProfile, profile.scentProfile);
    assert.equal(mapped.soundscape, profile.soundscape);
    assert.equal(mapped.consultationStyle, profile.consultationStyle);
    assert.deepEqual(mapped.lookbookPhotos?.map(p => p.id), ['lookbook']);
    // Editing Account Settings after a website save must survive the next load.
    await db.query('update profiles set full_name=$1 where id=$2', ['New Account Name', actor]);
    await db.exec('set role authenticated');
    assert.equal((await db.query<any>('select get_owner_editor_state() as state')).rows[0].state.profile.ownerName, 'New Account Name');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
    assert.equal((await db.query<any>('select get_owner_editor_state() as state')).rows[0].state, null);
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await assert.rejects(db.query('select get_owner_editor_state()'), /Sign in required/);
  } finally { await db.close(); }
});
