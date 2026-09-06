import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Request, Response as ExpressResponse } from 'express';
import { getYouTubeDetails } from '../src/utils/youtube';
import {
  enrichServerYouTubeMetadata,
  handleFetchYouTubeMetadata,
  SERVER_YOUTUBE_METADATA_TIMEOUT_MS,
} from '../server/youtubeMetadata';

const ID = 'dQw4w9WgXcQ';
const WATCH_URL = `https://www.youtube.com/watch?v=${ID}`;
const SHARE_URLS = [
  `https://youtube.com/shorts/${ID}?si=token`,
  `https://youtu.be/${ID}?si=token`,
  `https://youtube.com/watch?feature=shared&v=${ID}&si=token`,
];
const expectedFallback = (title = 'YouTube Video') => ({
  videoId: ID,
  embedUrl: `https://www.youtube.com/embed/${ID}`,
  thumbnailUrl: `https://img.youtube.com/vi/${ID}/hqdefault.jpg`,
  youtubeUrl: WATCH_URL,
  title,
  description: '',
  likeCount: 0,
  commentCount: 0,
  source: 'local_fallback',
});

const oembedFailures = [
  { name: 'offline', fetch: async () => { throw new TypeError('Failed to fetch'); } },
  { name: '404', fetch: async () => Response.json({ title: 'Not found' }, { status: 404 }) },
  { name: '503', fetch: async () => new Response('Service unavailable', { status: 503 }) },
  { name: 'malformed JSON', fetch: async () => new Response('<html>Not JSON</html>') },
  { name: 'null', fetch: async () => Response.json(null) },
  { name: 'empty object', fetch: async () => Response.json({}) },
  { name: 'array', fetch: async () => Response.json([]) },
  { name: 'numeric title', fetch: async () => Response.json({ title: 123 }) },
  { name: 'object title', fetch: async () => Response.json({ title: { text: 'Bad shape' } }) },
  { name: 'blank title', fetch: async () => Response.json({ title: '  ' }) },
];

for (const failure of oembedFailures) {
  test(`server returns local metadata for every share format when oEmbed is ${failure.name}`, async (t) => {
    t.mock.method(globalThis, 'fetch', failure.fetch);
    for (const url of SHARE_URLS) {
      for (const title of ['YouTube Short', 'YouTube Video']) {
        const result = await enrichServerYouTubeMetadata(getYouTubeDetails(url)!, title);
        assert.deepEqual(result, expectedFallback(title));
      }
    }
  });
}

test('oEmbed always receives the canonical watch URL and trims usable metadata', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signals: AbortSignal[] = [];
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://www.youtube.com');
    assert.equal(parsed.pathname, '/oembed');
    assert.equal(parsed.searchParams.get('url'), WATCH_URL);
    assert.equal(parsed.searchParams.get('format'), 'json');
    signals.push(options.signal);
    return Response.json({ title: '  Salon transformation  ', author_name: '  Your Salon  ' });
  });
  for (const url of SHARE_URLS) {
    const result = await enrichServerYouTubeMetadata(getYouTubeDetails(url)!, 'YouTube Short');
    assert.deepEqual(result, {
      ...expectedFallback('Salon transformation'),
      description: 'By Your Salon',
      source: 'oembed_fallback',
    });
  }
  assert.equal(fetch.mock.callCount(), SHARE_URLS.length);
  t.mock.timers.tick(SERVER_YOUTUBE_METADATA_TIMEOUT_MS * 2);
  assert.ok(signals.every((signal) => !signal.aborted), 'finished requests clear their timers');
});

test('malformed optional oEmbed author data does not corrupt the saved description', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ title: 'Salon video', author_name: {} }));
  const result = await enrichServerYouTubeMetadata(getYouTubeDetails(WATCH_URL)!, 'YouTube Video');
  assert.equal(result.title, 'Salon video');
  assert.equal(result.description, '');
});

const dataApiFailures = [
  { name: 'network error', response: async () => { throw new TypeError('Failed to fetch'); } },
  { name: 'quota/auth error', response: async () => Response.json({ items: [{ snippet: { title: 'Do not use an error response' } }] }, { status: 403 }) },
  { name: 'malformed JSON', response: async () => new Response('{bad-json') },
  { name: 'no items', response: async () => Response.json({ items: [] }) },
  { name: 'wrong-shaped items', response: async () => Response.json({ items: 'not-an-array' }) },
  { name: 'null item', response: async () => Response.json({ items: [null] }) },
  { name: 'unusable title', response: async () => Response.json({ items: [{ snippet: { title: {} } }] }) },
];

for (const failure of dataApiFailures) {
  test(`Data API ${failure.name} falls through to optional oEmbed`, async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async (url) => {
      const parsed = new URL(url);
      if (parsed.hostname === 'www.googleapis.com') {
        assert.equal(parsed.searchParams.get('id'), ID);
        assert.equal(parsed.searchParams.get('key'), 'test-api-key');
        return failure.response();
      }
      assert.equal(parsed.searchParams.get('url'), WATCH_URL);
      return Response.json({ title: 'oEmbed title' });
    });
    const result = await enrichServerYouTubeMetadata(getYouTubeDetails(WATCH_URL)!, 'YouTube Video', 'test-api-key');
    assert.equal(result.title, 'oEmbed title');
    assert.equal(result.source, 'oembed_fallback');
    assert.equal(fetch.mock.callCount(), 2);
  });
}

test('Data API enriches valid fields, normalizes counts and does not require oEmbed', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({
    items: [{
      id: ID,
      snippet: {
        title: '  Salon showcase  ',
        description: { invalid: true },
        thumbnails: { high: { url: `https://img.youtube.com/vi/${ID}/hqdefault.jpg` } },
      },
      statistics: { likeCount: '123', commentCount: 'Infinity' },
    }],
  }));
  const result = await enrichServerYouTubeMetadata(getYouTubeDetails(WATCH_URL)!, 'YouTube Video', 'test-api-key');
  assert.deepEqual(result, {
    ...expectedFallback('Salon showcase'),
    likeCount: 123,
    source: 'youtube_data_api',
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test('a missing/placeholder API key skips the Data API', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(new URL(url).pathname, '/oembed');
    return Response.json({ title: 'Salon video' });
  });
  for (const key of ['', 'YOUR_YOUTUBE_DATA_API_KEY']) {
    await enrichServerYouTubeMetadata(getYouTubeDetails(WATCH_URL)!, 'YouTube Video', key);
  }
  assert.equal(fetch.mock.callCount(), 2);
});

test('both upstreams failing still return valid fallback metadata and do not parse error bodies', async (t) => {
  const json = t.mock.fn(async () => { throw new Error('Do not parse non-200 metadata'); });
  const fetch = t.mock.method(globalThis, 'fetch', async () => ({ ok: false, json }));
  const result = await enrichServerYouTubeMetadata(getYouTubeDetails(WATCH_URL)!, 'YouTube Short', 'test-api-key');
  assert.deepEqual(result, expectedFallback('YouTube Short'));
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal(json.mock.callCount(), 0);
});

test('the server bounds a stalled oEmbed request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal;
  t.mock.method(globalThis, 'fetch', (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  });
  const pending = enrichServerYouTubeMetadata(getYouTubeDetails(WATCH_URL)!, 'YouTube Short');
  t.mock.timers.tick(SERVER_YOUTUBE_METADATA_TIMEOUT_MS);
  assert.deepEqual(await pending, expectedFallback('YouTube Short'));
  assert.equal(signal.aborted, true);
});

test('Data API and oEmbed share one total deadline rather than multiplying the timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finishApi: (value: Response) => void;
  let startOembed: () => void;
  const oembedStarted = new Promise<void>((resolve) => { startOembed = resolve; });
  const signals: AbortSignal[] = [];
  t.mock.method(globalThis, 'fetch', (url, options) => {
    signals.push(options.signal);
    if (new URL(url).hostname === 'www.googleapis.com') {
      return new Promise<Response>((resolve) => { finishApi = resolve; });
    }
    startOembed();
    return new Promise(() => {});
  });
  const pending = enrichServerYouTubeMetadata(getYouTubeDetails(WATCH_URL)!, 'YouTube Video', 'test-api-key');
  t.mock.timers.tick(2000);
  finishApi(new Response(null, { status: 403 }));
  await oembedStarted;
  assert.equal(signals.length, 2);
  assert.equal(signals[0], signals[1]);
  t.mock.timers.tick(SERVER_YOUTUBE_METADATA_TIMEOUT_MS - 2000);
  assert.deepEqual(await pending, expectedFallback());
  assert.equal(signals[0].aborted, true);
});

async function callEndpoint(body: unknown) {
  let status = 200;
  let json: any;
  const res = {
    status(code: number) { status = code; return this; },
    json(value: unknown) { json = value; return this; },
  } as ExpressResponse;
  await handleFetchYouTubeMetadata({ body } as Request, res);
  return { status, json };
}

test('the shared endpoint rejects invalid inputs with HTTP 400 before any upstream call', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not fetch'); });
  for (const body of [undefined, null, {}, { youtubeUrl: 42 }, { youtubeUrl: '' }, { youtubeUrl: 'https://notyoutube.com/watch?v=' + ID }]) {
    const result = await callEndpoint(body);
    assert.equal(result.status, 400);
    assert.equal(result.json.success, false);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('the shared endpoint returns HTTP 200/success for valid IDs even when all upstream requests fail', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Offline'); });
  for (const url of SHARE_URLS) {
    const result = await callEndpoint({ youtubeUrl: url, fallbackTitle: 'YouTube Short' });
    assert.equal(result.status, 200);
    assert.deepEqual(result.json, {
      success: true,
      ...expectedFallback('YouTube Short'),
      notice: 'YouTube metadata is unavailable; using fallback details.',
    });
  }
});

test('missing or malformed fallback titles are safely defaulted by the endpoint', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(null));
  for (const fallbackTitle of [undefined, null, {}, [], 42, '  ']) {
    const result = await callEndpoint({ youtubeUrl: WATCH_URL, fallbackTitle });
    assert.equal(result.status, 200);
    assert.equal(result.json.title, 'YouTube Video');
  }
});

test('the production API wires the shared fallback handler to the real HTTP route', async (t) => {
  const { default: app } = await import('../api/index');
  const server = app.listen(0, '0.0.0.0');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/fetch-youtube-meta`;
  const request = globalThis.fetch;
  const upstream = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('YouTube is offline'); });

  for (const youtubeUrl of SHARE_URLS) {
    const response = await request(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ youtubeUrl, fallbackTitle: 'YouTube Short' }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.videoId, ID);
    assert.equal(body.title, 'YouTube Short');
    assert.equal(body.source, 'local_fallback');
  }
  const upstreamCount = upstream.mock.callCount();
  const invalid = await request(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ youtubeUrl: `https://notyoutube.com/watch?v=${ID}` }),
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).success, false);
  assert.equal(upstream.mock.callCount(), upstreamCount);
});
