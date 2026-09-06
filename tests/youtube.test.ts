import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildYouTubeEmbedUrl,
  extractYouTubeId,
  getYouTubeDetails,
  isValidYouTubeUrl,
  resolveYouTubeVideoId,
} from '../src/utils/youtube';
import { addYouTubeItem, YOUTUBE_METADATA_TIMEOUT_MS } from '../src/utils/youtubeMetadata';

const ID = 'dQw4w9WgXcQ';
const WATCH_URL = `https://www.youtube.com/watch?v=${ID}`;
const SHARE_URLS = [
  `https://www.youtube.com/shorts/${ID}?si=shared-token`,
  `https://youtu.be/${ID}?si=shared-token&t=10`,
  `https://www.youtube.com/watch?feature=shared&si=token&v=${ID}&t=10#fragment`,
];

const VALID_URLS = [
  ...SHARE_URLS,
  WATCH_URL,
  ` youtube.com/shorts/${ID}?si=token `,
  `youtu.be/${ID}`,
  `http://WWW.YouTube.Com/watch?v=${ID}`,
  `https://m.youtube.com/watch?t=10&v=${ID}`,
  `https://music.youtube.com/watch?list=playlist&v=${ID}`,
  `https://gaming.youtube.com/watch?v=${ID}`,
  `https://www.youtu.be/${ID}?si=token`,
  `https://m.youtu.be/${ID}`,
  `https://www.youtube.com/embed/${ID}?start=10`,
  `https://www.youtube-nocookie.com/embed/${ID}?rel=0`,
  `https://youtube-nocookie.com/embed/${ID}`,
  `https://youtube.com/v/${ID}`,
  `https://youtube.com/live/${ID}?si=token`,
  `https://youtube.com/e/${ID}`,
  `https://youtube.com/u/0/${ID}`,
];

const INVALID_URLS: unknown[] = [
  null, undefined, 42, {}, [], '', '   ', 'not a URL', ID,
  `https://youtube.com/watch?v=${ID.slice(1)}`,
  `https://youtu.be/${ID}x`,
  'https://youtube.com/shorts/abcdefghij!',
  'https://youtube.com/watch',
  `https://youtube.com/watch#v=${ID}`,
  `https://youtube.com/watch?v=bad&v=${ID}`,
  'https://youtube.com/@salon',
  'https://youtube.com/playlist?list=example',
  `https://example.com/watch?v=${ID}`,
  `https://notyoutube.com/watch?v=${ID}`,
  `https://youtube.com.evil.example/shorts/${ID}`,
  `https://youtu.be.evil.example/${ID}`,
  `https://evil.example/youtube.com/shorts/${ID}`,
  `https://evil.example/?url=https://youtube.com/watch?v=${ID}`,
  `https://youtube.com@evil.example/watch?v=${ID}`,
  `https://evil.example@youtube.com/watch?v=${ID}`,
  `https://youtube-nocookie.com/watch?v=${ID}`,
  `https://youtube.com/u/0/extra/${ID}`,
  `ftp://youtube.com/watch?v=${ID}`,
  `file://youtube.com/shorts/${ID}`,
  `javascript:youtube.com/watch?v=${ID}`,
];

for (const url of VALID_URLS) {
  test(`extracts an exact ID from ${url}`, () => {
    assert.equal(extractYouTubeId(url), ID);
    assert.equal(isValidYouTubeUrl(url), true);
    assert.deepEqual(getYouTubeDetails(url), {
      videoId: ID,
      embedUrl: `https://www.youtube.com/embed/${ID}`,
      thumbnailUrl: `https://img.youtube.com/vi/${ID}/hqdefault.jpg`,
    });
  });
}

for (const url of INVALID_URLS) {
  test(`rejects non-YouTube or malformed input: ${JSON.stringify(url)}`, () => {
    assert.equal(extractYouTubeId(url), null);
    assert.equal(getYouTubeDetails(url), null);
    assert.equal(isValidYouTubeUrl(url), false);
  });
}

test('preserves ID case, underscores/hyphens and existing playback helpers', () => {
  const id = 'Abc_12-xyZ0';
  assert.equal(extractYouTubeId(`https://youtu.be/${id}`), id);
  assert.equal(resolveYouTubeVideoId('bad', SHARE_URLS[0]), ID);
  assert.equal(resolveYouTubeVideoId(id, WATCH_URL), id);
  assert.equal(buildYouTubeEmbedUrl('bad'), '');
  const embed = new URL(buildYouTubeEmbedUrl(id, { loop: true, autoplay: true }));
  assert.equal(embed.pathname, `/embed/${id}`);
  assert.equal(embed.searchParams.get('playlist'), id);
  assert.equal(embed.searchParams.get('autoplay'), '1');
});

const expectedFallback = (title: string) => ({
  videoId: ID,
  embedUrl: `https://www.youtube.com/embed/${ID}`,
  thumbnailUrl: `https://img.youtube.com/vi/${ID}/hqdefault.jpg`,
  youtubeUrl: WATCH_URL,
  title,
  description: '',
  likeCount: 0,
  commentCount: 0,
});

const failedLookups = [
  { name: 'offline/CORS rejection', fetch: async () => { throw new TypeError('Failed to fetch'); } },
  { name: 'non-200 response', fetch: async () => Response.json({ success: true, videoId: ID, title: 'Error page' }, { status: 503 }) },
  { name: 'explicit API failure', fetch: async () => Response.json({ success: false, notice: 'Upstream unavailable' }) },
  { name: 'malformed JSON', fetch: async () => new Response('<html>Bad gateway</html>') },
  { name: 'empty response', fetch: async () => new Response(null, { status: 204 }) },
  { name: 'null JSON', fetch: async () => Response.json(null) },
  { name: 'array JSON', fetch: async () => Response.json([]) },
  { name: 'missing ID', fetch: async () => Response.json({ success: true, title: 'Missing video ID' }) },
  { name: 'mismatched ID', fetch: async () => Response.json({ success: true, videoId: 'Abc_12-xyZ0', title: 'Another video' }) },
  { name: 'wrong-shaped fields', fetch: async () => Response.json({ success: true, videoId: ID, title: {}, description: [], thumbnailUrl: 123, likeCount: -1, commentCount: 'NaN' }) },
  { name: 'blank title / invalid thumbnail', fetch: async () => Response.json({ success: true, videoId: ID, title: '  ', thumbnailUrl: 'not a URL' }) },
];

for (const failure of failedLookups) {
  test(`saves all share URL formats in both categories despite ${failure.name}`, async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', failure.fetch);
    for (const url of SHARE_URLS) {
      for (const title of ['YouTube Short', 'YouTube Video']) {
        const save = t.mock.fn(async (metadata) => {
          assert.deepEqual(metadata, expectedFallback(title));
          return 'saved-row-id';
        });
        assert.equal(await addYouTubeItem(url, title, save), 'saved-row-id');
        assert.equal(save.mock.callCount(), 1);
      }
    }
    assert.equal(fetch.mock.callCount(), SHARE_URLS.length * 2);
  });
}

test('rejects invalid input before metadata lookup or persistence', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not fetch'); });
  const save = t.mock.fn();
  for (const url of INVALID_URLS) {
    await assert.rejects(addYouTubeItem(url, 'YouTube Video', save), /Invalid YouTube URL/);
  }
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(save.mock.callCount(), 0);
});

test('enriches optional fields using a canonical same-origin request without changing the local identity', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/fetch-youtube-meta');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { youtubeUrl: WATCH_URL, fallbackTitle: 'YouTube Short' });
    signal = options.signal;
    return Response.json({
      success: true,
      videoId: ID,
      youtubeUrl: 'https://example.com',
      embedUrl: 'https://example.com/embed',
      title: '  Salon transformation  ',
      description: '  By the salon  ',
      thumbnailUrl: `https://img.youtube.com/vi/${ID}/maxresdefault.jpg`,
      likeCount: '123',
      commentCount: '10',
    });
  });
  const result = await addYouTubeItem(SHARE_URLS[0], 'YouTube Short', (metadata) => metadata);
  assert.deepEqual(result, {
    ...expectedFallback('Salon transformation'),
    description: 'By the salon',
    thumbnailUrl: `https://img.youtube.com/vi/${ID}/maxresdefault.jpg`,
    likeCount: 123,
    commentCount: 10,
  });
  t.mock.timers.tick(YOUTUBE_METADATA_TIMEOUT_MS * 2);
  assert.equal(signal.aborted, false, 'completed lookup must clear its abort timer');
});

test('a stalled lookup times out, aborts and still saves once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal;
  t.mock.method(globalThis, 'fetch', (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  });
  const save = t.mock.fn((metadata) => metadata);
  const pending = addYouTubeItem(SHARE_URLS[0], 'YouTube Short', save);
  t.mock.timers.tick(YOUTUBE_METADATA_TIMEOUT_MS);
  assert.deepEqual(await pending, expectedFallback('YouTube Short'));
  assert.equal(signal.aborted, true);
  assert.equal(save.mock.callCount(), 1);
});

test('the deadline also covers a stalled JSON body and ignores late metadata', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finishJson: (value: unknown) => void;
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: () => new Promise((resolve) => { finishJson = resolve; }),
  }));
  const save = t.mock.fn((metadata) => metadata);
  const pending = addYouTubeItem(WATCH_URL, 'YouTube Video', save);
  await Promise.resolve();
  assert.equal(typeof finishJson, 'function');
  t.mock.timers.tick(YOUTUBE_METADATA_TIMEOUT_MS);
  const saved = await pending;
  assert.deepEqual(saved, expectedFallback('YouTube Video'));
  finishJson({ success: true, videoId: ID, title: 'Too late' });
  await Promise.resolve();
  assert.equal(save.mock.callCount(), 1);
  assert.equal(saved.title, 'YouTube Video');
});

for (const metadataAvailable of [true, false]) {
  test(`persistence errors propagate when metadata is ${metadataAvailable ? 'available' : 'unavailable'}`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => {
      if (!metadataAvailable) throw new TypeError('Offline');
      return Response.json({ success: true, videoId: ID, title: 'Salon video' });
    });
    const dbError = { message: 'Insert denied by row-level security', code: '42501' };
    const save = t.mock.fn(async () => { throw dbError; });
    await assert.rejects(addYouTubeItem(WATCH_URL, 'YouTube Video', save), (error) => error === dbError);
    assert.equal(save.mock.callCount(), 1);
  });
}

test('adding awaits persistence instead of reporting success early', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Offline'); });
  let finishSave: (value: string) => void;
  let started: () => void;
  const saveStarted = new Promise<void>((resolve) => { started = resolve; });
  let settled = false;
  const pending = addYouTubeItem(WATCH_URL, 'YouTube Video', () => {
    started();
    return new Promise<string>((resolve) => { finishSave = resolve; });
  }).then((value) => { settled = true; return value; });
  await saveStarted;
  assert.equal(settled, false);
  finishSave('persisted-row-id');
  assert.equal(await pending, 'persisted-row-id');
});
