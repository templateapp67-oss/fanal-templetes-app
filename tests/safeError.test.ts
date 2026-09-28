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

test('a refused API key is reported as credentials-rejected, not "database not configured"', () => {
  // The production incident: every query failed with a gateway 401 body that
  // carried a code but NO message, and the answer told operators the database
  // was "not configured" — the wrong fix entirely.
  for (const error of [
    { code: '401', message: '' },
    { code: 'PGRST301', message: 'JWT expired' },
    { code: 'PGRST303', message: 'JWT claim validation failed' },
  ]) {
    const info = safeDatabaseError(error);
    assert.equal(info.status, 503);
    assert.equal(info.code, 'database_credentials_rejected');
    assert.equal(info.retryable, false, 'a refused key never starts working on retry');
    assert.match(info.message, /SUPABASE_ANON_KEY/);
    assert.match(info.message, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(info.message, /redeploy/i);
    assert.doesNotMatch(info.message, /database is not configured/i);
    assert.doesNotMatch(info.message, /JWT expired|JWT claim/i, 'raw gateway text is not echoed to callers');
  }
});

test('42501 keeps the existing database_not_configured contract', () => {
  const info = safeDatabaseError({ code: '42501', message: 'permission denied for table salons' });
  assert.equal(info.status, 503);
  assert.equal(info.code, 'database_not_configured');
  assert.equal(info.message, 'The database is not configured to accept this request. Please try again later.');
  assert.equal(info.retryable, true);
  assert.doesNotMatch(info.message, /permission denied/i);
});

test('classifySafeError routes raw gateway rejection codes to the credential answer', () => {
  for (const code of ['401', 'pgrst301', 'PGRST302']) {
    const info = classifySafeError({ code }, 'database');
    assert.equal(info.status, 503, code);
    assert.equal(info.code, 'database_credentials_rejected', code);
    assert.equal(info.retryable, false, code);
  }
});

test('a typed 401 auth error still means "sign in again", not key rejection', () => {
  const info = classifySafeError({ status: 401, code: 'token_expired', message: 'expired' });
  assert.equal(info.status, 401);
  assert.equal(info.code, 'auth_required');
});

test('safe JSON errors do not write a second response after timeout', () => {
  const res = makeRes();
  res.locals = { requestTimedOut: true };
  sendSafeError(res, new Error('should not be sent'));
  assert.equal(res.body, undefined);
  assert.equal(res.statusCode, 200);
});
