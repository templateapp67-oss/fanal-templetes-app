import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asyncRoute, normalizeApiRequestUrl } from '../server/expressSafety';

test('normalizeApiRequestUrl restores /api when a serverless invocation strips it', () => {
  const req: any = { url: '/health', headers: {} };
  let nextCalls = 0;
  normalizeApiRequestUrl(req, {}, () => { nextCalls += 1; });
  assert.equal(req.url, '/api/health');
  assert.equal(nextCalls, 1);
});

test('normalizeApiRequestUrl preserves an already-prefixed route and query string', () => {
  const req: any = { url: '/api/bookings/create?x=1', headers: {} };
  normalizeApiRequestUrl(req, {}, () => {});
  assert.equal(req.url, '/api/bookings/create?x=1');
});

test('normalizeApiRequestUrl honors a forwarded API path when req.url is rewritten', () => {
  const req: any = {
    url: '/health',
    headers: { 'x-forwarded-uri': '/api/payments/razorpay/webhook?x=1' },
  };
  normalizeApiRequestUrl(req, {}, () => {});
  assert.equal(req.url, '/api/payments/razorpay/webhook?x=1');
});

test('asyncRoute forwards rejected promises and synchronous throws to Express', async () => {
  const errors: any[] = [];
  const rejected = asyncRoute(async () => {
    throw new Error('rejected');
  });
  rejected({}, { headersSent: false }, (error: any) => errors.push(error));

  const thrown = asyncRoute(() => {
    throw new Error('thrown');
  });
  thrown({}, { headersSent: false }, (error: any) => errors.push(error));

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(errors.map((error) => error.message), ['thrown', 'rejected']);
});

test('asyncRoute suppresses a late rejection after the timeout response ended', async () => {
  const errors: any[] = [];
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: any) => warnings.push(String(message));
  try {
    const route = asyncRoute(async () => {
      await Promise.resolve();
      throw new Error('late failure');
    });
    route({}, { headersSent: true }, (error: any) => errors.push(error));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((message) => message.includes('after the response ended')));
});
