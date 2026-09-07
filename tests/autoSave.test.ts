import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUTOSAVE_DEBOUNCE_MS,
  toDbId,
  isUuid,
  describeError,
  isRetriableError,
  withRetry,
  safeWriteLocalStorage,
  summarizeSaveError,
  isAuthLikeFailure,
  isSchemaLikeFailure,
  getSaveUiState,
  formatSavedAt,
} from '../src/lib/autoSave';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('the auto-save debounce delay stays inside the requested 1000–1500ms window', () => {
  assert.ok(AUTOSAVE_DEBOUNCE_MS >= 1000 && AUTOSAVE_DEBOUNCE_MS <= 1500);
});

test('toDbId passes valid uuids straight through so hydrated rows round-trip', () => {
  const uuid = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  assert.equal(toDbId(uuid, 'nexora-service'), uuid);
  assert.equal(toDbId(uuid.toUpperCase(), 'nexora-service'), uuid);
});

test('toDbId maps friendly string ids to deterministic, valid uuids', () => {
  // These are the ids the app actually uses (hs-1, hs-st-uma, rew-1, srv-…),
  // which the old save path sent to uuid columns and got rejected with
  // "invalid input syntax for type uuid".
  for (const appId of ['hs-1', 'hs-st-uma', 'rew-1', 'srv-1693999000777', 'bb-3']) {
    const dbId = toDbId(appId, 'nexora-service');
    assert.match(dbId, UUID_RE, `${appId} must map to a valid uuid, got ${dbId}`);
  }

  // Deterministic: same input, same output — repeated saves upsert, never duplicate.
  assert.equal(toDbId('hs-1', 'nexora-service'), toDbId('hs-1', 'nexora-service'));
  // Different namespaces must not collide for the same logical id.
  assert.notEqual(toDbId('hs-1', 'nexora-service'), toDbId('hs-1', 'nexora-stylist'));
  // Different ids must not collide.
  assert.notEqual(toDbId('hs-1', 'nexora-service'), toDbId('hs-2', 'nexora-service'));
});

test('isUuid only accepts real uuids', () => {
  assert.ok(isUuid('9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'));
  assert.ok(!isUuid('hs-1'));
  assert.ok(!isUuid(undefined));
  assert.ok(!isUuid('not-a-uuid'));
});

test('describeError extracts exact messages, codes, details and hints', () => {
  assert.equal(describeError('plain string'), 'plain string');
  assert.equal(describeError(new Error('boom')).includes('boom'), true);

  const supabaseLike = {
    message: 'invalid input syntax for type uuid: "hs-1"',
    code: '22P02',
    details: 'Some detail',
    hint: 'Try a valid uuid',
    status: 400,
  };
  const described = describeError(supabaseLike);
  assert.match(described, /invalid input syntax for type uuid/);
  assert.match(described, /code: 22P02/);
  assert.match(described, /details: Some detail/);
  assert.match(described, /hint: Try a valid uuid/);
  assert.match(described, /status: 400/);
});

test('network/transient failures are retriable, deterministic DB rejections are not', () => {
  assert.equal(isRetriableError(new TypeError('fetch failed')), true);
  assert.equal(isRetriableError({ message: 'network request failed' }), true);
  assert.equal(isRetriableError({ message: 'Request timed out', status: 504 }), true);
  assert.equal(isRetriableError({ message: 'Too many requests', status: 429 }), true);

  assert.equal(
    isRetriableError({ message: 'invalid input syntax for type uuid: "hs-1"', code: '22P02' }),
    false
  );
  assert.equal(
    isRetriableError({ message: 'duplicate key value violates unique constraint "profiles_subdomain_key"' }),
    false
  );
  assert.equal(isRetriableError({ message: 'Permission denied', status: 403 }), false);
});

test('withRetry retries retriable failures with backoff and logs the exact error', async () => {
  const logs: string[] = [];
  const log = (...args: unknown[]) => logs.push(args.join(' '));

  let attempts = 0;
  const result = await withRetry(
    async () => {
      attempts++;
      if (attempts < 3) throw new TypeError('fetch failed');
      return 'saved';
    },
    { label: 'cloud sync → save services', maxAttempts: 3, baseDelayMs: 1, log }
  );
  assert.equal(result, 'saved');
  assert.equal(attempts, 3);
  // The exact underlying error must be in the log for root-cause debugging.
  assert.ok(logs.some((l) => l.includes('fetch failed')));
  assert.ok(logs.some((l) => l.includes('save services')));
});

test('withRetry fails fast on deterministic DB errors without retrying', async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry(
      async () => {
        attempts++;
        throw { message: 'duplicate key value violates unique constraint', code: '23505' };
      },
      { maxAttempts: 3, baseDelayMs: 1, log: () => {} }
    ),
    (err: any) => {
      assert.match(err.message, /duplicate key/);
      return true;
    }
  );
  assert.equal(attempts, 1, 'deterministic errors must not be retried');
});

test('withRetry gives up after exhausting retries', async () => {
  let attempts = 0;
  await assert.rejects(
    withRetry(
      async () => {
        attempts++;
        throw new Error('Service Unavailable');
      },
      { maxAttempts: 3, baseDelayMs: 1, log: () => {} }
    ),
    /Service Unavailable/
  );
  assert.equal(attempts, 3);
});

test('summarizeSaveError turns raw root causes into actionable toast text', () => {
  assert.match(
    summarizeSaveError(
      'save salon profile: duplicate key value violates unique constraint "profiles_subdomain_key" | code: 23505'
    ),
    /subdomain is already taken/
  );
  assert.match(
    summarizeSaveError('save services: invalid input syntax for type uuid: "hs-1"'),
    /uuid mismatch/
  );
  assert.match(summarizeSaveError('save profile: TypeError: fetch failed'), /Network error/);
  // Long raw errors are truncated instead of overflowing the toast.
  const long = summarizeSaveError('x'.repeat(400));
  assert.ok(long.length <= 165);
});

test('summarizeSaveError classifies auth/RLS/grants rejections with the right remedy', () => {
  // PostgREST surfaces missing table grants for the authenticated role as 401.
  assert.match(
    summarizeSaveError('save salon profile: permission denied for table profiles | code: 42501'),
    /sign in again/i
  );
  // RLS rejecting the inserted row (upsert without a matching INSERT policy).
  assert.match(
    summarizeSaveError(
      'save stylists: new row violates row-level security policy on "stylists" | code: 42501'
    ),
    /permission problem/i
  );
  // Expired / invalid JWT after the session died in a backgrounded tab.
  assert.match(
    summarizeSaveError('save services: JWT expired | code: 403'),
    /sign in again/i
  );
  // The app's own pre-flight skip when no session exists.
  assert.match(
    summarizeSaveError('cloud sync skipped (no active session — sign in again to save to the cloud)'),
    /permission problem/i
  );
});

test('summarizeSaveError classifies missing schema and transient errors distinctly', () => {
  // Tables never created in the linked Supabase project (migrations not run).
  assert.match(
    summarizeSaveError('save services: relation "public.services" does not exist | code: 42P01'),
    /schema missing/i
  );
  // Transient gateway/5xx errors mention the automatic retry + local fallback.
  assert.match(
    summarizeSaveError('save salon profile: fetch failed | code: 502'),
    /retrying automatically/i
  );
  // The legacy generic "could not load" branch is reserved for real
  // hydration-level messages and still points the owner to the console.
  assert.match(
    summarizeSaveError('cloud hydration failed: could not load rows from the profiles table'),
    /could not load your existing data/i
  );
});

test('isAuthLikeFailure and isSchemaLikeFailure flag the right server errors', () => {
  assert.ok(isAuthLikeFailure('permission denied for table profiles | code: 42501'));
  assert.ok(isAuthLikeFailure('new row violates row-level security policy | code: 42501'));
  assert.ok(isAuthLikeFailure('JWT expired'));
  assert.ok(isAuthLikeFailure('HTTP 401 Unauthorized'));
  assert.ok(!isAuthLikeFailure('relation "public.profiles" does not exist | code: 42P01'));
  assert.ok(isSchemaLikeFailure('relation "public.profiles" does not exist | code: 42P01'));
  assert.ok(isSchemaLikeFailure('undefined table: services'));
  assert.ok(!isSchemaLikeFailure('TypeError: fetch failed'));
  assert.ok(!isAuthLikeFailure('duplicate key value violates unique constraint'));
});

// ---------------------------------------------------------------------------
// safeWriteLocalStorage — needs a stubbed window.localStorage
// ---------------------------------------------------------------------------
class MemoryStorage {
  private store = new Map<string, string>();
  quotaLimit = Infinity;
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    if (value.length > this.quotaLimit) {
      throw new DOMException('The quota has been exceeded', 'QuotaExceededError');
    }
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

test('safeWriteLocalStorage writes normally when there is room', () => {
  const storage = new MemoryStorage();
  (globalThis as any).localStorage = storage;
  const result = safeWriteLocalStorage('k', '{"a":1}');
  assert.deepEqual(result, { ok: true });
  assert.equal(storage.getItem('k'), '{"a":1}');
});

test('safeWriteLocalStorage degrades gracefully on quota errors instead of throwing', () => {
  const storage = new MemoryStorage();
  // Big enough for the trimmed JSON (no inline image), too small for the full
  // payload with a ~500-char base64 image.
  storage.quotaLimit = 100;
  (globalThis as any).localStorage = storage;

  const payload = JSON.stringify({
    businessName: 'Arts By Uma',
    coverImageUrl: `data:image/jpeg;base64,${'A'.repeat(500)}`,
  });
  const result = safeWriteLocalStorage('salon', payload);

  // The save must survive (this used to throw and fail the whole save flow).
  assert.equal(result.ok, true);
  assert.equal(result.degraded, true);
  assert.match(result.error!, /quota has been exceeded/i);
  // The fallback write strips the inline image but keeps the text data.
  const stored = JSON.parse(storage.getItem('salon')!);
  assert.equal(stored.businessName, 'Arts By Uma');
  assert.ok(!String(stored.coverImageUrl).startsWith('data:image/jpeg'));
});

test('safeWriteLocalStorage reports the exact error when even the trimmed write fails', () => {
  const storage = new MemoryStorage();
  storage.quotaLimit = 0; // nothing fits, ever
  (globalThis as any).localStorage = storage;
  const result = safeWriteLocalStorage('salon', JSON.stringify({ a: 'x'.repeat(200) }));
  assert.equal(result.ok, false);
  assert.match(result.error!, /quota has been exceeded/i);
});

test('the status pill shows the three dynamic states: Saving… / All changes saved / Save failed', () => {
  // Debounce countdown after an edit.
  assert.deepEqual(getSaveUiState('pending'), { busy: true, failed: false, label: 'Saving…', savedAtLabel: null });
  // Save request in flight (auto or manual).
  assert.deepEqual(getSaveUiState('saving'), { busy: true, failed: false, label: 'Saving…', savedAtLabel: null });
  // Manual button spin counts as busy too, whatever the underlying status.
  assert.equal(getSaveUiState('idle', { busyOverride: true }).label, 'Saving…');
  assert.equal(getSaveUiState('error', { busyOverride: true }).failed, false);

  // Fresh app with no edits yet.
  assert.equal(getSaveUiState('idle').label, 'All changes saved');
  // Successful save shows the confirmation (plus last-saved time when known).
  const savedAt = new Date('2026-09-06T14:32:00').getTime();
  const saved = getSaveUiState('saved', { lastSavedAt: savedAt });
  assert.equal(saved.failed, false);
  assert.match(saved.label, /All changes saved/);
  assert.ok(saved.label.includes(formatSavedAt(savedAt)));
  // Failed save.
  assert.deepEqual(getSaveUiState('error'), { busy: false, failed: true, label: 'Save failed', savedAtLabel: null });
});
