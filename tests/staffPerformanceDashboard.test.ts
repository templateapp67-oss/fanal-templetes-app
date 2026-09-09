import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { registerStaffPerformanceRoutes } from '../server/staffPerformanceRoutes';

function createTestApp() {
  const app = express();
  app.use(express.json());
  registerStaffPerformanceRoutes(app);
  return app;
}

test('GET /api/owner/staff-performance/summary rejects unauthorized requests without owner header/token', async () => {
  const app = createTestApp();
  const server = app.listen(0);
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/owner/staff-performance/summary`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /Unauthorized/i);
  } finally {
    server.close();
  }
});

test('POST /api/owner/staff-performance/commission rejects a spoofed owner header before validating fields', async () => {
  const app = createTestApp();
  const server = app.listen(0);
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/owner/staff-performance/commission`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-owner-id': '11111111-1111-4111-8111-111111111111',
      },
      body: JSON.stringify({ commissionRate: 25 }),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /Unauthorized/i);
  } finally {
    server.close();
  }
});

test('GET /api/owner/staff-performance/summary rejects an owner id header without a verified token', async () => {
  const app = createTestApp();
  const server = app.listen(0);
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/owner/staff-performance/summary`, {
      headers: {
        'x-owner-id': '11111111-1111-4111-8111-111111111111',
      },
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /Unauthorized/i);
  } finally {
    server.close();
  }
});
