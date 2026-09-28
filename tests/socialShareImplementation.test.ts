import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { socialMetadata, injectSocialMetadata } from '../src/lib/socialMetadata';
import { renderPublicSocialPage } from '../server/publicSocialPage';
import { uploadSocialShareImage, validateSocialImage } from '../src/lib/socialShareAssets';
import { SocialSharePreview } from '../src/components/SocialSharePreview';
import { websiteDatabase, actor, salon } from './helpers/websiteDatabase';

const profile = { businessName: 'Studio', seoTitle: 'My SEO title', seoDescription: 'My SEO description', socialShareImageUrl: 'https://images.example.com/card.jpg' };
const html = '<html><head><title>Old</title><meta property="og:image" content="old"><meta name="description" content="old"><link rel="canonical" href="/"><script src="/assets/app.js"></script></head><body><div id="root"></div></body></html>';

test('crawler gets saved OG tags in initial HTML; query identity, dimensions and script assets survive', async () => {
  const calls: string[] = [];
  const fetcher: any = async (url: URL, init: any) => {
    calls.push(url.pathname);
    assert.equal(init.headers, undefined, 'no browser cookies or bearer token forwarded');
    return url.pathname === '/index.html'
      ? new Response(html, { headers: { 'content-type': 'text/html', 'content-length': '5', 'etag': 'old' } })
      : Response.json({ found: true, salon: { profile } });
  };
  const response = await renderPublicSocialPage(new Request('https://app.vercel.app/?site=star-salon&utm_source=test', { headers: { cookie: 'private=secret' } }), fetcher);
  assert.ok(response);
  const body = await response.text();
  assert.match(body, /property="og:image" content="https:\/\/images.example.com\/card.jpg"/);
  assert.match(body, /property="og:image:width" content="1200"/);
  assert.match(body, /property="og:image:height" content="630"/);
  assert.match(body, /<title>My SEO title<\/title>/);
  assert.match(body, /content="https:\/\/app.vercel.app\/\?site=star-salon"/);
  assert.match(body, /src="\/assets\/app.js"/);
  assert.equal((body.match(/property="og:image"/g) || []).length, 1);
  assert.equal(response.headers.get('etag'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(calls, ['/index.html', '/api/site/star-salon']);
  assert.equal(await renderPublicSocialPage(new Request('https://app.vercel.app/?site=invalid/path'), fetcher), undefined);
  assert.equal(await renderPublicSocialPage(new Request('https://app.vercel.app/'), fetcher), undefined);
  assert.equal(await renderPublicSocialPage(new Request('https://app.vercel.app/?site=missing'), (async () => new Response('', { status: 503 })) as any), undefined);
});

test('metadata escapes untrusted titles and rejects data/javascript image URLs; preview uses SEO fields', () => {
  const evil = injectSocialMetadata(html, { ...profile, seoTitle: '"></title><script>alert(1)</script>', socialShareImageUrl: 'javascript:alert(1)' }, 'https://app.vercel.app/?site=salon-b');
  assert.ok(!evil.includes('<script>alert(1)</script>'));
  assert.ok(!evil.includes('javascript:'));
  assert.ok(!evil.includes('og:image:width'));
  assert.equal(socialMetadata({ socialShareImageUrl: 'data:image/png;base64,AAA' }, 'https://example.com/').image, '');
  const markup = renderToStaticMarkup(React.createElement(SocialSharePreview, { profile: profile as any, pageUrl: 'https://app.vercel.app/?site=star-salon' }));
  assert.match(markup, /My SEO title/); assert.match(markup, /My SEO description/);
  assert.match(markup, /images.example.com\/card.jpg/);
});

test('upload enforces file limit, own folder, immutable URL and failure propagation', async () => {
  let owner = 'owner-a', fail = false;
  const calls: any[] = [];
  const client: any = { auth: { getUser: async () => ({ data: { user: { id: owner } } }) }, storage: { from: (bucket: string) => ({
    upload: async (path: string, _image: Blob, options: any) => { calls.push({ bucket, path, options }); return { error: fail ? { message: 'Bucket not found' } : null }; },
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://images.example.com/${path}` } }),
  }) } };
  const image = new Blob(['image'], { type: 'image/jpeg' });
  assert.match(await uploadSocialShareImage(client, image, owner), /owner-a\/social\//);
  assert.equal(calls[0].bucket, 'brand-assets'); assert.equal(calls[0].options.upsert, false);
  await assert.rejects(uploadSocialShareImage(client, image, 'other'), /Account changed/);
  assert.throws(() => validateSocialImage(new Blob([new Uint8Array(2097153)], { type: 'image/png' })), /2 MB/);
  assert.throws(() => validateSocialImage(new Blob(['svg'], { type: 'image/svg+xml' })), /PNG/);
  fail = true; await assert.rejects(uploadSocialShareImage(client, image, owner), /Bucket not found/);
});

test('brand bucket migration is repeatable and restricts cross-owner uploads/deletes', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage,auth to authenticated; grant select,insert,delete on storage.objects to authenticated;`);
    const sql = await readFile(new URL('../supabase/migrations/20261029000000_social_share_brand_assets.sql', import.meta.url), 'utf8');
    await db.exec(sql); await db.exec(sql);
    await db.exec(`insert into storage.objects(bucket_id,name) values('brand-assets','22222222-2222-4222-8222-222222222222/social/other.jpg');
      select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false); set role authenticated;`);
    await db.exec("insert into storage.objects(bucket_id,name) values('brand-assets','11111111-1111-4111-8111-111111111111/social/own.jpg')");
    await assert.rejects(db.exec("insert into storage.objects(bucket_id,name) values('brand-assets','22222222-2222-4222-8222-222222222222/social/spoof.jpg')"), /row-level security/);
    await db.exec("delete from storage.objects where name like '%other.jpg'; reset role;");
    assert.equal((await db.query<any>('select count(*)::int n from storage.objects')).rows[0].n, 2);
    await db.exec("update storage.buckets set public=false where id='brand-assets'");
    await assert.rejects(db.exec(sql), /private bucket/);
    await db.exec('rollback');
    assert.equal((await db.query<any>("select public from storage.buckets where id='brand-assets'")).rows[0].public, false);
  } finally { await db.close(); }
});

test('saved social URL/title/description reach private snapshot and public metadata and can be cleared', async () => {
  const db = await websiteDatabase();
  try {
    const p = { ...profile, ownerId: actor, businessType: 'hair_salon', subdomain: 'mine', phone: '9876543210', address: 'Studio Road', city: 'Jaipur' };
    for (const image of [profile.socialShareImageUrl, '']) {
      await db.query('select save_owner_editor_state($1::jsonb)', [JSON.stringify({ profile: { ...p, socialShareImageUrl: image } })]);
      const saved = (await db.query<any>('select state from owner_editor_state where owner_id=$1', [actor])).rows[0].state.profile;
      const pub = (await db.query<any>('select data from salons where id=$1', [salon])).rows[0].data.editor_profile;
      for (const row of [saved, pub]) {
        assert.equal(row.socialShareImageUrl, image); assert.equal(row.seoTitle, profile.seoTitle); assert.equal(row.seoDescription, profile.seoDescription);
      }
    }
  } finally { await db.close(); }
});
