import test from 'node:test';
import assert from 'node:assert/strict';
import middleware from '../middleware';
import { readFileSync } from 'node:fs';

test('direct partner visits and refreshes reach the SPA without an auth cookie', () => {
  for (const path of ['/partner/dashboard', '/partner', '/partner/referrals?tab=active', '/growth-partner/dashboard', '/partner/login', '/partner/signup', '/partner/reset-password?code=example']) {
    // Browser local/sessionStorage tokens are absent from document requests.
    const req = new Request(`https://fanal-templetes-app.vercel.app${path}`);
    assert.equal(middleware(req), undefined, `${path} must reach browser session restoration`);
  }
});

test('cookie/header presence is not treated as edge authorization', () => {
  for (const headers of [{ cookie: 'sb-example-auth-token=invalid' }, { authorization: 'Bearer invalid' }]) {
    assert.equal(middleware(new Request('https://example.com/partner/dashboard', { headers })), undefined);
  }
});

test('Vercel serves deep links through index.html without swallowing API requests', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.rewrites, [
    { source: '/api/(.*)', destination: '/api/index.ts' },
    { source: '/(.*)', destination: '/index.html' },
  ]);
});
