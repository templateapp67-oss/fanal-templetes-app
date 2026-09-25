import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDatabase, verifyBackendUser, ownerSalonIds, resolveOwnerSalonResolution } from '../server/backendContext.js';

test('every bearer token is checked by Auth, including former demo bypasses', async () => {
  for (const token of ['mock-owner', 'demo-owner', 'mock-token', 'arbitrary-token']) {
    const checked: string[] = [];
    const db = { auth: { getUser: async (value: string) => {
      checked.push(value);
      return { data: { user: null }, error: { status: 401, message: 'Invalid JWT' } };
    } } };
    await assert.rejects(verifyBackendUser(db, { headers: { authorization: `Bearer ${token}` } }),
      (error: any) => error.status === 401 && error.code === 'auth_required');
    assert.deepEqual(checked, [token]);
  }
});

test('valid identity comes from Auth rather than the bearer token text', async () => {
  const db = { auth: { getUser: async () => ({ data: { user: { id: 'verified-user' } }, error: null }) } };
  const result = await verifyBackendUser(db, { headers: { authorization: 'Bearer signed-token' } });
  assert.equal(result.user.id, 'verified-user');
});

test('injected database reads execute without deployment credentials and preserve errors', async () => {
  assert.deepEqual(await readDatabase(() => Promise.resolve({ data: ['saved-row'], error: null })), ['saved-row']);
  await assert.rejects(readDatabase(() => Promise.resolve({ data: null, error: { code: '42501' } })),
    (error: any) => error.code === '42501');
});

test('mock-looking actor ids cannot fabricate an owner workspace', async () => {
  let queries = 0;
  const db = { from: () => {
    queries++;
    const q: any = { select: () => q, eq: () => q, in: () => Promise.resolve({ data: [], error: null }) };
    return q;
  } };
  for (const actor of ['mock-owner', 'demo-owner']) {
    assert.deepEqual(await ownerSalonIds(db, actor), []);
    assert.deepEqual(await resolveOwnerSalonResolution(db, actor), { status: 'needs_onboarding', salon: null });
  }
  assert.equal(queries, 4);
});
