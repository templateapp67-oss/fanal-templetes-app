import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_PUBLIC_SITE_ORIGIN,
  configuredPublicSiteOrigin,
  getPublicWebsiteUrl,
  isPreviewSiteHost,
  normalizePublicSiteSlug,
  publicSiteOrigin,
} from '../src/lib/publicSiteUrl';
import { getSiteUrl } from '../src/lib/salonStore';
import { parseSiteParam } from '../src/lib/router';

// ============================================================================
// ONE CANONICAL CUSTOMER SHARE URL.
//
// Every published salon website is shared as exactly:
//
//   https://fanal-templetes-app.vercel.app/?site=<published-slug>
//
// Preview origins (AI Studio / Cloud Run, localhost, sandboxes, preview
// deployments) must never leak into customer-facing links, QR payloads, or
// share text. These tests pin the central helper, its delegation through
// `getSiteUrl`, the publish-response round-trip back into the app's own
// `?site=` parser, and a codebase-wide ban on stray Cloud Run references.
// ============================================================================

const SITE_A_SLUG = 'hello';
const SITE_B_SLUG = 'abc-salon';
const SITE_A_URL = 'https://fanal-templetes-app.vercel.app/?site=hello';
const SITE_B_URL = 'https://fanal-templetes-app.vercel.app/?site=abc-salon';
const CLOUD_RUN_ORIGIN = 'https://ais-dev-wjwddzam65uesfat5wh54a-616909335986.asia-southeast1.run.app';

function withoutEnvOverride<T>(fn: () => T): T {
  const key = 'VITE_PUBLIC_WEBSITE_URL';
  const had = Object.prototype.hasOwnProperty.call(process.env, key);
  const previous = process.env[key];
  delete process.env[key];
  try {
    return fn();
  } finally {
    if (had) process.env[key] = previous as string;
    else delete process.env[key];
  }
}

test('Publish Site A returns the canonical production URL with its own slug', () => {
  assert.equal(withoutEnvOverride(() => getPublicWebsiteUrl(SITE_A_SLUG)), SITE_A_URL);
});

test('Publish Site B returns its own different canonical slug URL', () => {
  const urlB = withoutEnvOverride(() => getPublicWebsiteUrl(SITE_B_SLUG));
  assert.equal(urlB, SITE_B_URL);
  assert.notEqual(urlB, SITE_A_URL);
  assert.match(urlB, /^https:\/\/fanal-templetes-app\.vercel\.app\/\?site=abc-salon$/);
});

test('a Cloud Run preview origin falls back to the canonical production origin', () => {
  assert.equal(
    withoutEnvOverride(() => getPublicWebsiteUrl('mysalon', CLOUD_RUN_ORIGIN)),
    'https://fanal-templetes-app.vercel.app/?site=mysalon'
  );
  assert.equal(withoutEnvOverride(() => publicSiteOrigin(CLOUD_RUN_ORIGIN)), DEFAULT_PUBLIC_SITE_ORIGIN);
});

test('localhost, sandbox, and preview-deployment origins fall back to canonical', () => {
  withoutEnvOverride(() => {
    for (const origin of [
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'https://3000-abc123def.e2b.app',
      'https://fanal-templetes-app-git-branch.vercel.app',
      'https://my-preview.railway.app',
      'https://my-preview.onrender.com',
      'not a url',
      '',
    ]) {
      assert.equal(publicSiteOrigin(origin), DEFAULT_PUBLIC_SITE_ORIGIN, origin);
    }
  });
});

test('the canonical host normalizes to https even when reached over http', () => {
  assert.equal(
    withoutEnvOverride(() => publicSiteOrigin('http://fanal-templetes-app.vercel.app')),
    DEFAULT_PUBLIC_SITE_ORIGIN
  );
});

test('a genuine custom production origin is preserved verbatim', () => {
  assert.equal(
    withoutEnvOverride(() => publicSiteOrigin('https://app.example.com')),
    'https://app.example.com'
  );
  assert.equal(
    withoutEnvOverride(() => getPublicWebsiteUrl('hello', 'https://app.example.com/')),
    'https://app.example.com/?site=hello'
  );
});

test('VITE_PUBLIC_WEBSITE_URL overrides the origin; invalid values are ignored', () => {
  const key = 'VITE_PUBLIC_WEBSITE_URL';
  const previous = process.env[key];
  try {
    process.env[key] = 'https://sites.example.com/';
    assert.equal(configuredPublicSiteOrigin(), 'https://sites.example.com');
    assert.equal(getPublicWebsiteUrl('hello'), 'https://sites.example.com/?site=hello');
    process.env[key] = 'not a url';
    assert.equal(configuredPublicSiteOrigin(), '');
    assert.equal(getPublicWebsiteUrl('hello', CLOUD_RUN_ORIGIN), SITE_A_URL);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test('slugs are used verbatim (safely encoded); missing slugs refuse to build', () => {
  assert.equal(normalizePublicSiteSlug('  hello  '), 'hello');
  assert.equal(normalizePublicSiteSlug(''), '');
  assert.equal(normalizePublicSiteSlug(null), '');
  assert.equal(normalizePublicSiteSlug(undefined), '');
  assert.equal(
    withoutEnvOverride(() => getPublicWebsiteUrl('My Salon!')),
    'https://fanal-templetes-app.vercel.app/?site=My%20Salon!'
  );
  assert.equal(withoutEnvOverride(() => getPublicWebsiteUrl('   ')), '');
  assert.equal(withoutEnvOverride(() => getPublicWebsiteUrl(undefined)), '');
});

test('preview-host detection never flags the canonical production host', () => {
  assert.equal(isPreviewSiteHost('fanal-templetes-app.vercel.app'), false);
  assert.equal(isPreviewSiteHost('FANAL-TEMPLETES-APP.VERCEL.APP'), false);
  for (const host of [
    'localhost',
    '127.0.0.1',
    'ais-dev-wjwddzam65uesfat5wh54a-616909335986.asia-southeast1.run.app',
    'xyz.run.app',
    '3000-abc.e2b.app',
    'preview-1.vercel.app',
    '',
  ]) {
    assert.equal(isPreviewSiteHost(host), true, host);
  }
  assert.equal(isPreviewSiteHost('app.example.com'), false);
});

test('getSiteUrl delegates to the canonical helper from the saved slug', () => {
  withoutEnvOverride(() => {
    // No window in unit context: the canonical production URL, not nexora.in.
    assert.equal(getSiteUrl({ subdomain: 'hello' } as any), SITE_A_URL);
    assert.equal(getSiteUrl({ subdomain: 'abc-salon' } as any), SITE_B_URL);
    // An untrusted publishedOrigin is sanitized, never trusted blindly.
    assert.equal(getSiteUrl({ subdomain: 'hello' } as any, CLOUD_RUN_ORIGIN), SITE_A_URL);
    // Owner-configured production surfaces keep their deliberate format.
    assert.equal(
      getSiteUrl({ subdomain: 'hello', customDomain: 'salon.example' } as any),
      'https://salon.example'
    );
  });
});

test('canonical URLs round-trip through the app’s own ?site= parser', () => {
  for (const [url, slug] of [
    [SITE_A_URL, SITE_A_SLUG],
    [SITE_B_URL, SITE_B_SLUG],
  ] as const) {
    const search = new URL(url).search;
    assert.equal(parseSiteParam(search), slug, `${url} must resolve back to its slug`);
  }
});

test('the promo share flow uses the canonical site URL, not the editor origin', () => {
  const source = readFileSync(new URL('../src/components/OffersManagement.tsx', import.meta.url), 'utf8');
  assert.match(source, /getSiteUrl\(profile\)/, 'the share text and navigator.share use the central helper');
  assert.doesNotMatch(
    source,
    /window\.location\.origin/,
    'no editor-origin leak remains in the customer-facing share'
  );
});

test('no Cloud Run host remains anywhere except the sanitizer allowlist', () => {
  const allowlist = new Set([
    'src/lib/publicSiteUrl.ts', // the canonical-origin sanitizer itself
    'src/lib/partnerReferralLink.ts', // referral-link sanitizer (pre-existing)
    'src/lib/tenant.ts', // infra-host classification (pre-existing)
  ]);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry)) {
        const rel = full.replace(`${process.cwd()}/`, '');
        const content = readFileSync(full, 'utf8');
        if (/run\.app/.test(content) && !allowlist.has(rel)) offenders.push(rel);
      }
    }
  };
  walk(join(process.cwd(), 'src'));
  assert.deepEqual(offenders, [], 'customer-facing code must not reference Cloud Run hosts');
});
