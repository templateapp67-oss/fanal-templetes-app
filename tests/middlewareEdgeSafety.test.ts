import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import middleware, { renderPublicSocialShell } from '../middleware';
import { publicSocialShellHandler } from '../server/publicSocialShell';

// ============================================================================
// Deploy guard for the Vercel middleware.
//
// PR #121 added `import { renderPublicSocialPage } from './server/publicSocialPage'`
// to the root middleware and added '/' to its matcher. Vercel builds that file
// with @vercel/node (per-file transpile + trace) and runs it on the Edge
// runtime, which does not resolve the traced sibling modules: the middleware
// module failed to LOAD and every matched route answered
// 500 MIDDLEWARE_INVOCATION_FAILED. These tests pin the fix — the middleware
// is import-free, delegates to the Node/API runtime, and never throws.
// ============================================================================

const html = '<html><head><title>Old</title></head><body><div id="root"></div></body></html>';

test('middleware.ts has no imports: a traced sibling module is not resolvable on the Edge runtime', () => {
  const source = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(codeOnly, /^\s*import\s/m, 'a static import makes the middleware module fail to load');
  assert.doesNotMatch(codeOnly, /\brequire\s*\(/, 'require() is not defined on the Edge runtime');
  assert.doesNotMatch(codeOnly, /\bimport\s*\(/, 'a dynamic import is not resolvable on the Edge runtime');
});

test('the app\'s own hosts and preview hosts are served the static shell without an API round trip', async () => {
  for (const host of ['fanal-templetes-app.vercel.app', 'nexora.in', 'www.nexora.in', 'localhost:3000']) {
    const calls: string[] = [];
    const fetcher: any = async (input: any) => {
      calls.push(String(input));
      return new Response(html, { headers: { 'content-type': 'text/html' } });
    };
    assert.equal(await renderPublicSocialShell(new Request(`https://${host}/`), fetcher), undefined);
    assert.deepEqual(calls, [], `${host} must not trigger /api/public-shell`);
    assert.equal(await middleware(new Request(`https://${host}/`)), undefined);
  }
});

test('non-renderable requests pass straight through without an API round trip', async () => {
  const fetcher: any = async () => { throw new Error('fetch must not be called'); };
  const notRenderable = [
    new Request('https://star-salon.nexora.in/dashboard'),
    new Request('https://star-salon.nexora.in/', { method: 'POST' }),
    new Request('https://app.vercel.app/?site=bad_slug'),
    new Request('https://app.vercel.app/?site='),
    new Request('https://app.vercel.app/'),
  ];
  for (const request of notRenderable) {
    assert.equal(await renderPublicSocialShell(request, fetcher), undefined, request.url);
  }
});

test('a salon host renders through /api/public-shell and forwards no browser credentials', async () => {
  const calls: any[] = [];
  const fetcher: any = async (input: any, init: any) => {
    calls.push({ url: String(input), init });
    return new Response('<html><head><title>Studio</title></head><body></body></html>', { headers: { 'content-type': 'text/html' } });
  };
  const response = await renderPublicSocialShell(
    new Request('https://star-salon.nexora.in/?utm_source=wa', { headers: { cookie: 'private=secret', authorization: 'Bearer owner' } }),
    fetcher,
  );
  assert.ok(response);
  assert.deepEqual(calls.map((c) => c.url), ['https://star-salon.nexora.in/api/public-shell?utm_source=wa']);
  assert.equal(calls[0].init.headers, undefined, 'no cookies or bearer tokens are forwarded');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(await response.text(), /<title>Studio<\/title>/);
});

test('?site sharing links are validated and forwarded with the slug intact', async () => {
  const calls: string[] = [];
  const fetcher: any = async (input: any) => {
    calls.push(String(input));
    return new Response(html, { headers: { 'content-type': 'text/html' } });
  };
  assert.ok(await renderPublicSocialShell(new Request('https://fanal-templetes-app.vercel.app/?site=star-salon'), fetcher));
  assert.deepEqual(calls, ['https://fanal-templetes-app.vercel.app/api/public-shell?site=star-salon']);
  assert.equal(await renderPublicSocialShell(new Request('https://fanal-templetes-app.vercel.app/?site=../etc'), fetcher), undefined);
});

test('HEAD returns an empty body; a failed or non-HTML shell degrades to the static page', async () => {
  const ok: any = async () => new Response(html, { headers: { 'content-type': 'text/html' } });
  const head = await renderPublicSocialShell(new Request('https://star-salon.nexora.in/', { method: 'HEAD' }), ok);
  assert.equal(head?.status, 200);
  assert.equal(await head!.text(), '');

  const broken: any = async () => { throw new Error('network down'); };
  assert.equal(await renderPublicSocialShell(new Request('https://star-salon.nexora.in/'), broken), undefined);

  const missing: any = async () => new Response('nope', { status: 503 });
  assert.equal(await renderPublicSocialShell(new Request('https://star-salon.nexora.in/'), missing), undefined);

  const json: any = async () => Response.json({ found: false });
  assert.equal(await renderPublicSocialShell(new Request('https://star-salon.nexora.in/'), json), undefined);

  // A runtime without AbortSignal.timeout must still render, not crash.
  const original = AbortSignal.timeout;
  (AbortSignal as any).timeout = undefined;
  try {
    const response = await renderPublicSocialShell(new Request('https://star-salon.nexora.in/'), ok);
    assert.ok(response);
  } finally {
    (AbortSignal as any).timeout = original;
  }
});

test('/api/public-shell renders the crawler HTML in the Node runtime and falls back to next()', async () => {
  const originalFetch = globalThis.fetch;
  const profile = { businessName: 'Studio', seoTitle: 'Studio bookings', socialShareImageUrl: 'https://images.example.com/card.jpg' };
  globalThis.fetch = (async (input: any) => {
    const url = new URL(String(input));
    if (url.pathname === '/index.html') return new Response(html, { headers: { 'content-type': 'text/html' } });
    return Response.json({ found: true, salon: { profile } });
  }) as any;

  const makeRes = () => {
    const res: any = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      body: '',
      status(code: number) { this.statusCode = code; return this; },
      set(name: string, value: string) { this.headers[name.toLowerCase()] = value; return this; },
      send(payload: string) { this.body = payload; return this; },
    };
    return res;
  };

  try {
    const req = {
      method: 'GET',
      protocol: 'http',
      headers: { host: 'star-salon.nexora.in', 'x-forwarded-proto': 'https' },
      originalUrl: '/api/public-shell?site=star-salon',
      get: (name: string) => (name === 'host' ? 'star-salon.nexora.in' : undefined),
    };
    const res = makeRes();
    let nexted = false;
    await publicSocialShellHandler(req, res, () => { nexted = true; });
    assert.equal(nexted, false);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.match(res.body, /property="og:image" content="https:\/\/images\.example\.com\/card\.jpg"/);
    assert.match(res.body, /<title>Studio bookings<\/title>/);

    // Nothing to render (site not found) → the caller's normal handling runs.
    globalThis.fetch = (async () => Response.json({ found: false })) as any;
    const missing = makeRes();
    let missingNexted = false;
    await publicSocialShellHandler(req, missing, () => { missingNexted = true; });
    assert.equal(missingNexted, true);
    assert.equal(missing.statusCode, 0);

    // No Host header → nothing to resolve the tenant from.
    let noHostNexted = false;
    await publicSocialShellHandler({ method: 'GET', headers: {} }, makeRes(), () => { noHostNexted = true; });
    assert.equal(noHostNexted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
