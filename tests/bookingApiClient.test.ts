// ============================================================================
// Client-side booking save (src/lib/bookingApi.ts).
//
// The reported failure — "We couldn't save your booking (Server error (HTTP
// 500))" — was produced here: any answer that was not parseable JSON collapsed
// into a bare status number, and a single transient failure ended the checkout.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postBookingWithRetry, summarizeBody, isRetryableStatus } from '../src/lib/bookingApi';

const BODY = JSON.stringify({ booking: { customer_name: 'Riya' } });
const noSleep = async () => {};

function jsonResponse(status: number, payload: any): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    text: async () => JSON.stringify(payload),
  };
}

function textResponse(status: number, body: string, statusText = ''): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => body,
  };
}

test('a successful save returns the stored row and the server request id', async () => {
  const fetchImpl = async () => jsonResponse(200, { success: true, data: { id: 'b1' }, requestId: 'bk_1' });
  const outcome = await postBookingWithRetry(BODY, { fetchImpl: fetchImpl as any, sleepImpl: noSleep });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.data.id, 'b1');
  assert.equal(outcome.requestId, 'bk_1');
  assert.equal(outcome.attempts, 1);
});

test('a transient 500 is retried and the second attempt can succeed', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1
      ? jsonResponse(500, { success: false, error: 'database hiccup' })
      : jsonResponse(200, { success: true, data: { id: 'b2' } });
  };
  const outcome = await postBookingWithRetry(BODY, { fetchImpl: fetchImpl as any, sleepImpl: noSleep });
  assert.equal(calls, 2);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.data.id, 'b2');
});

test('a 4xx is never retried — the answer cannot change', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(400, { success: false, code: 'invalid_booking', error: 'Customer name is required.' });
  };
  const outcome = await postBookingWithRetry(BODY, { fetchImpl: fetchImpl as any, sleepImpl: noSleep });
  assert.equal(calls, 1);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.kind, 'rejected');
  assert.equal(outcome.code, 'invalid_booking');
  assert.equal(outcome.detail, 'Customer name is required.');
  assert.equal(outcome.retryable, false);
});

test('an HTML error page is reported with its content, not as a bare status', async () => {
  const html = '<!doctype html><html><head><title>500</title></head><body><h1>FUNCTION_INVOCATION_FAILED</h1></body></html>';
  const fetchImpl = async () => textResponse(500, html, 'Internal Server Error');
  const outcome = await postBookingWithRetry(BODY, {
    fetchImpl: fetchImpl as any,
    sleepImpl: noSleep,
    maxAttempts: 2,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.kind, 'server');
  assert.match(outcome.detail, /FUNCTION_INVOCATION_FAILED/);
  assert.equal(outcome.attempts, 2);
});

test('a 503 from the server is surfaced as retryable with its own wording', async () => {
  const fetchImpl = async () =>
    jsonResponse(503, {
      success: false,
      code: 'db_timeout',
      retryable: true,
      requestId: 'bk_9',
      error: 'The booking database is not responding right now.',
    });
  const outcome = await postBookingWithRetry(BODY, { fetchImpl: fetchImpl as any, sleepImpl: noSleep, maxAttempts: 2 });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.retryable, true);
  assert.equal(outcome.requestId, 'bk_9');
  assert.match(outcome.detail, /not responding/);
});

test('a network failure is classified as offline so the local copy is kept', async () => {
  const fetchImpl = async () => {
    throw new TypeError('Failed to fetch');
  };
  const outcome = await postBookingWithRetry(BODY, { fetchImpl: fetchImpl as any, sleepImpl: noSleep, maxAttempts: 2 });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.kind, 'offline');
  assert.match(outcome.detail, /Failed to fetch/);
});

test('HTTP 200 with success:false is treated as a failure, not a saved booking', async () => {
  const fetchImpl = async () => jsonResponse(200, { success: false, error: 'owner unresolved' });
  const outcome = await postBookingWithRetry(BODY, { fetchImpl: fetchImpl as any, sleepImpl: noSleep });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.detail, 'owner unresolved');
});

test('summarizeBody strips markup and truncates long error pages', () => {
  assert.equal(summarizeBody('<html><body>  Bad   Gateway </body></html>'), 'Bad Gateway');
  assert.ok(summarizeBody('x'.repeat(400)).length <= 140);
  assert.equal(summarizeBody('   '), '');
});

test('isRetryableStatus retries infrastructure statuses only', () => {
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(502), true);
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(422), false);
  assert.equal(isRetryableStatus(400), false);
});
