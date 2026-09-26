import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerPartnerPortalRoutes } from '../server/partnerPortalRoutes';

test('partner API checks verified session and own approved active row before private RPCs', async () => {
  const routes = new Map<string, any>();
  const app: any = { get: (path: string, fn: any) => routes.set(path, fn), post: () => {} };
  let partnerRow: any = null;
  const calls: string[] = [];
  registerPartnerPortalRoutes(app, {
    isMock: false,
    db: { auth: { getUser: async (token: string) => ({
      data: { user: token === 'valid' ? { id: 'partner-A' } : null }, error: null,
    }) } },
    callRpc: async (_token, fn) => {
      calls.push(fn);
      return { data: fn === 'get_my_growth_partner' ? partnerRow : { currency: 'INR', totals: {} }, error: null };
    },
  } as any);
  const request = async (token: string) => {
    const res: any = { headersSent: false, statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(data: any) { this.body = data; this.headersSent = true; return this; } };
    await routes.get('/api/partner/earnings')({ headers: { authorization: `Bearer ${token}` }, query: {}, get: () => null }, res);
    return res;
  };
  assert.equal((await request('invalid')).statusCode, 401);
  calls.length = 0;
  assert.equal((await request('valid')).statusCode, 403);
  assert.deepEqual(calls, ['get_my_growth_partner']);
  partnerRow = { user_id: 'partner-B', is_active: true, status: 'approved' };
  assert.equal((await request('valid')).statusCode, 403);
  partnerRow = { user_id: 'partner-A', is_active: true, status: 'pending' };
  assert.equal((await request('valid')).statusCode, 403);
  partnerRow = { user_id: 'partner-A', is_active: false, status: 'approved' };
  assert.equal((await request('valid')).statusCode, 403);
  partnerRow = { user_id: 'partner-A', is_active: true, status: 'approved' };
  const approved = await request('valid');
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.body.data.currency, 'INR');
  assert.equal(calls.at(-1), 'get_my_partner_earnings');
});
