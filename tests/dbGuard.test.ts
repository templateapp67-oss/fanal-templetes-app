// ============================================================================
// Timeout / retry guards around every database call on a customer-facing path.
//
// Reproduced before the fix: with a Supabase stub that accepts the connection
// and never answers, POST /api/bookings/create hung indefinitely. On a
// serverless host the platform then kills the invocation and returns its own
// HTML error page, which the checkout can only show as
// "Server error (HTTP 500)".
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  withDbTimeout,
  runDb,
  isTransientDbError,
  withRequestTimeout,
  newRequestId,
  DbTimeoutError,
} from '../server/dbGuard';

const never = () => new Promise(() => {});

test('withDbTimeout rejects with DbTimeoutError instead of hanging forever', async () => {
  const startedAt = Date.now();
  await assert.rejects(() => withDbTimeout(never() as any, 'stuck query', 50), (err: any) => {
    assert.ok(err instanceof DbTimeoutError);
    assert.match(err.message, /stuck query timed out after 50ms/);
    return true;
  });
  assert.ok(Date.now() - startedAt < 1000, 'must reject promptly');
});

test('withDbTimeout resolves normally when the query answers in time', async () => {
  const value = await withDbTimeout(Promise.resolve({ data: [1], error: null }), 'fast query', 500);
  assert.deepEqual(value, { data: [1], error: null });
});

test('runDb converts a hung query into a catchable db_timeout error result', async () => {
  const result = await runDb(() => never() as any, { label: 'hung insert', timeoutMs: 40, retry: false });
  assert.equal(result.data, null);
  assert.equal(result.error.code, 'db_timeout');
  assert.equal(result.timedOut, true);
  assert.match(result.error.message, /did not respond within 40ms/);
});

test('runDb retries a transient network fault once and then succeeds', async () => {
  let attempts = 0;
  const result = await runDb(
    () => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new TypeError('fetch failed'));
      return Promise.resolve({ data: { id: 'ok' }, error: null });
    },
    { label: 'flaky insert', timeoutMs: 500, retryDelayMs: 1 }
  );
  assert.equal(attempts, 2);
  assert.equal(result.error, null);
  assert.deepEqual(result.data, { id: 'ok' });
});

test('runDb does NOT retry a real data error (a constraint violation)', async () => {
  let attempts = 0;
  const result = await runDb(
    () => {
      attempts += 1;
      return Promise.resolve({ data: null, error: { code: '23502', message: 'null value in column "owner_id"' } });
    },
    { label: 'bad row', timeoutMs: 500, retryDelayMs: 1 }
  );
  assert.equal(attempts, 1, 'a constraint violation is deterministic — retrying only wastes the budget');
  assert.equal(result.error.code, '23502');
});

test('runDb never throws — an exploding client becomes an error result', async () => {
  const result = await runDb(
    () => {
      throw new Error('client exploded');
    },
    { label: 'explode', timeoutMs: 100, retry: false }
  );
  assert.equal(result.data, null);
  assert.match(result.error.message, /client exploded/);
});

test('isTransientDbError distinguishes infrastructure faults from data faults', () => {
  assert.equal(isTransientDbError(new TypeError('fetch failed')), true);
  assert.equal(isTransientDbError({ code: 'ECONNRESET' }), true);
  assert.equal(isTransientDbError({ message: 'upstream connect error: 503' }), true);
  assert.equal(isTransientDbError({ code: 'db_timeout' }), true);
  assert.equal(isTransientDbError({ code: '23505', message: 'duplicate key' }), false);
  assert.equal(isTransientDbError(null), false);
});

test('withRequestTimeout answers JSON 504 before the platform can kill the request', async () => {
  const middleware = withRequestTimeout(30, 'Saving took too long.');
  const res: any = {
    headersSent: false,
    locals: {},
    statusCode: 200,
    body: null,
    listeners: {} as Record<string, any>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
    on(event: string, cb: any) {
      this.listeners[event] = cb;
    },
  };
  let nextCalled = false;
  middleware({ method: 'POST', originalUrl: '/api/bookings/create' }, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true, 'the handler must still run — the guard only races it');

  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(res.statusCode, 504);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'request_timeout');
  assert.equal(res.body.error, 'Saving took too long.');
  assert.ok(res.body.requestId, 'the answer must carry a correlation id');
});

test('withRequestTimeout stays silent when the handler answers in time', async () => {
  const middleware = withRequestTimeout(1000);
  const res: any = {
    headersSent: false,
    locals: {},
    body: null,
    status() {
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    on(event: string, cb: any) {
      if (event === 'finish') this.finish = cb;
    },
  };
  middleware({ method: 'GET', originalUrl: '/api/bookings' }, res, () => {});
  res.finish();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(res.body, null);
});

test('newRequestId produces unique, prefixed correlation ids', () => {
  const a = newRequestId('bk');
  const b = newRequestId('bk');
  assert.match(a, /^bk_/);
  assert.notEqual(a, b);
});
