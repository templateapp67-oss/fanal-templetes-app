import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifySafeError, safeDatabaseError, sendSafeError } from '../server/safeError';

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res;
}

test('unexpected route exceptions become generic JSON without leaking raw text', () => {
  const res = makeRes();
  sendSafeError(res, new Error('postgres password=secret internal stack'), { requestId: 'req_1' });

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, false);
  assert.equal(res.body.requestId, 'req_1');
  assert.equal(res.body.error, 'The server could not complete the request. Please try again.');
  assert.doesNotMatch(JSON.stringify(res.body), /password|postgres|internal stack/i);
});

test('database timeouts and transport failures are returned as retryable 503 errors', () => {
  const timeout = classifySafeError({ code: 'db_timeout', message: 'secret query details' }, 'database');
  assert.equal(timeout.status, 503);
  assert.equal(timeout.retryable, true);
  assert.doesNotMatch(timeout.message, /secret query details/i);

  const unavailable = safeDatabaseError({ code: 'db_unreachable', message: 'fetch failed at internal host' });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.retryable, true);
  assert.doesNotMatch(unavailable.message, /internal host/i);
});

test('safe JSON errors do not write a second response after timeout', () => {
  const res = makeRes();
  res.locals = { requestTimedOut: true };
  sendSafeError(res, new Error('should not be sent'));
  assert.equal(res.body, undefined);
  assert.equal(res.statusCode, 200);
});
