// ============================================================================
// The admin HTTP surface — /api/admin/* and the public onboarding routes.
//
// `tests/adminManagementSql.test.ts` proves the DATABASE refuses what it should.
// This file proves the API layer does the two things SQL cannot:
//
//   • nobody reaches an operator handler without a verified bearer token AND a
//     live admin_members row (a blanket sweep over the registered table, so a
//     route added later cannot skip the gate);
//   • the public form is the ONLY unauthenticated surface, and it can do exactly
//     three things: read a link's area/role, upload a document, submit a PENDING
//     application. It can never read a partner, an application list or an audit
//     trail.
//
// It also pins the two privileged steps that need the service-role key —
// creating the approved manager's Auth user and storing documents — including
// the 503 they must answer on a deploy without one.
//
// No Express, no database: the registered handlers are invoked with a fake
// req/res and an injected `callRpc`, so the assertions are about this file.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ADMIN_ROUTES,
  PUBLIC_ONBOARDING_ROUTES,
  registerAdminRoutes,
  type AdminRouteDeps,
} from '../server/adminRoutes';

interface RpcCall {
  token: string;
  fn: string;
  args: Record<string, unknown>;
}

interface FakeResponse {
  statusCode: number;
  body: any;
  headers: Record<string, string>;
  headersSent: boolean;
  status(code: number): FakeResponse;
  json(payload: any): FakeResponse;
  send(payload: any): FakeResponse;
  set(name: string, value: string): FakeResponse;
  redirect(code: number, url: string): FakeResponse;
}

function fakeResponse(): FakeResponse {
  const res: FakeResponse = {
    statusCode: 200,
    body: null,
    headers: {},
    headersSent: false,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      res.headersSent = true;
      return res;
    },
    send(payload) {
      res.body = payload;
      res.headersSent = true;
      return res;
    },
    set(name, value) {
      res.headers[name.toLowerCase()] = value;
      return res;
    },
    redirect(code, url) {
      res.statusCode = code;
      res.headers.location = url;
      res.headersSent = true;
      return res;
    },
  };
  return res;
}

function mount(
  overrides: {
    rpc?: (fn: string, args: Record<string, unknown>) => Promise<{ data?: any; error?: any }>;
    access?: { is_admin: boolean; role?: string | null; work_area?: string | null; can_manage_money?: boolean } | 'error';
    createAuthUser?: (input: any) => Promise<{ id: string }>;
    storeDocument?: (input: any) => Promise<string | null>;
    admin?: any;
    isMock?: boolean;
  } = {}
) {
  const rpcCalls: RpcCall[] = [];
  const routes = new Map<string, any>();
  const record = (method: 'get' | 'post') => (path: string, handler: any) => {
    routes.set(`${method.toUpperCase()} ${path}`, handler);
  };
  const app: any = { get: record('get'), post: record('post') };

  const db = {
    auth: {
      getUser: async (token: string) =>
        token === 'good'
          ? { data: { user: { id: 'staff-user-1' } }, error: null }
          : { data: { user: null }, error: null },
    },
  };

  const deps: AdminRouteDeps = {
    db,
    isMock: overrides.isMock ?? false,
    admin: overrides.admin,
    createAuthUser: overrides.createAuthUser,
    storeDocument: overrides.storeDocument,
    callRpc: async (token: string, fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ token, fn, args });
      if (fn === 'get_my_admin_access') {
        if (overrides.access === 'error') return { error: { message: 'boom' } };
        return {
          data:
            overrides.access ??
            { is_admin: true, role: 'super_admin', work_area: null, can_manage_money: true },
        };
      }
      if (overrides.rpc) return overrides.rpc(fn, args);
      if (fn === 'admin_list_manager_applications') {
        return {
          data: {
            items: [
              {
                id: 'a18d0df6-58b5-4bdc-a518-3a597d5b7195',
                full_name: 'Neha Sharma',
                email: 'neha@nexora.example',
                work_area: 'Vaishali Nagar',
                role: 'sub_admin',
                status: 'pending',
              },
            ],
          },
        };
      }
      if (fn === 'admin_create_manager_onboarding_link') {
        return { data: { id: 'link-1', token: 'tok_'.padEnd(40, 'x'), work_area: 'Jhotwara', role: 'area_manager', max_uses: 1, uses: 0 } };
      }
      if (fn === 'admin_partner_directory' || fn === 'admin_export_partner_directory') {
        return {
          data: {
            items: [
              {
                id: 'p-1',
                referral_code: 'JHO001',
                full_name: 'Partner One',
                email: 'one@partner.example',
                phone: '9876543210',
                whatsapp: '9876543211',
                work_area: 'Jhotwara',
                is_active: true,
                status: 'active',
                onboarded_salons: 2,
                active_referrals: 3,
                lifetime_paise: 150000,
                available_paise: 50000,
                open_payouts: 1,
              },
            ],
            total: 1,
            work_area: 'Jhotwara',
            can_manage_money: true,
            is_super_admin: true,
          },
        };
      }
      if (fn === 'admin_list_partner_payouts') {
        return { data: { items: [{ id: 'pay-1', amount_paise: 100000, status: 'pending', partner_code: 'JHO001' }], total: 1 } };
      }
      if (fn === 'get_manager_onboarding_link') {
        return { data: { valid: true, work_area: 'Malviya Nagar', role: 'area_manager' } };
      }
      return { data: { ok: true, fn } };
    },
  };

  registerAdminRoutes(app, deps);

  return {
    routes,
    rpcCalls,
    call: async (
      method: 'GET' | 'POST',
      path: string,
      options: { query?: any; body?: any; token?: string | null; params?: any } = {}
    ) => {
      const handler = routes.get(`${method} ${path}`);
      assert.ok(handler, `${method} ${path} is registered`);
      const req: any = {
        query: options.query ?? {},
        body: options.body ?? {},
        params: options.params ?? {},
        headers: options.token === null ? {} : { authorization: `Bearer ${options.token ?? 'good'}` },
      };
      const res = fakeResponse();
      await handler(req, res, (error: any) => {
        throw error;
      });
      return res;
    },
  };
}

const APPLICATION_ID = 'a18d0df6-58b5-4bdc-a518-3a597d5b7195';

// ---------------------------------------------------------------------------
// 1. The route table is complete and every operator route is gated
// ---------------------------------------------------------------------------
test('every operator route refuses an anonymous caller before it reads anything', async () => {
  const harness = mount();
  assert.ok(ADMIN_ROUTES.length >= 14, `expected the full operator surface, found ${ADMIN_ROUTES.length}`);
  for (const route of ADMIN_ROUTES) {
    const method = route.method.toUpperCase() as 'GET' | 'POST';
    const res = await harness.call(method, route.path, {
      token: null,
      params: { id: APPLICATION_ID, path: 'x/y.pdf' },
    });
    assert.equal(res.statusCode, 401, `${method} ${route.path} must answer 401 for an anonymous caller`);
    assert.equal(res.body?.error?.code, 'auth_required', `${method} ${route.path} uses the shared auth code`);
  }
  assert.equal(harness.rpcCalls.length, 0, 'nothing was read before the caller was verified');

  // Unknown paths are simply not registered — the list is the contract.
  assert.equal(harness.routes.get('POST /api/admin/partners/:id/delete'), undefined);
  for (const route of ADMIN_ROUTES) {
    assert.doesNotMatch(route.path, /:partnerId|:userId/, 'identity is never a path parameter');
  }
});

test('a signed-in account that is not an admin member is refused with the staff copy', async () => {
  const harness = mount({ access: { is_admin: false, role: null, work_area: null, can_manage_money: false } });
  const res = await harness.call('GET', '/api/admin/partners');
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'admin_required');
  assert.match(res.body.error.message, /Nexora staff accounts/);
  assert.deepEqual(harness.rpcCalls.map((call) => call.fn), ['get_my_admin_access'], 'no other read happened');
});

test('a deploy with no Supabase project answers 503 and calls nothing', async () => {
  const harness = mount({ isMock: true });
  const res = await harness.call('GET', '/api/admin/partners');
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'backend_unavailable');
  assert.equal(harness.rpcCalls.length, 0);
});

test('the caller’s own token rides along — never a service key', async () => {
  const harness = mount();
  await harness.call('GET', '/api/admin/partners');
  await harness.call('GET', '/api/admin/audit-logs');
  for (const call of harness.rpcCalls) {
    assert.equal(call.token, 'good', 'the verified bearer token, not a privileged one');
    assert.doesNotMatch(JSON.stringify(call.args), /service_role/i);
  }
});

// ---------------------------------------------------------------------------
// 2. Super-admin-only actions, enforced at the route as well as in SQL
// ---------------------------------------------------------------------------
test('super-admin-only routes refuse a manager before SQL is asked to', async () => {
  const manager = { is_admin: true, role: 'area_manager', work_area: 'Jhotwara', can_manage_money: false };
  const checks: Array<['GET' | 'POST', string, any]> = [
    ['POST', '/api/admin/onboarding-links', { body: { work_area: 'Jhotwara' } }],
    ['POST', '/api/admin/manager-applications/:id/approve', { body: { password: 'longenough1' }, params: { id: APPLICATION_ID } }],
    ['POST', '/api/admin/manager-applications/:id/reject', { body: { reason: 'documents unclear' }, params: { id: APPLICATION_ID } }],
    ['POST', '/api/admin/partners/:id/area', { body: { work_area: 'Malviya Nagar' }, params: { id: APPLICATION_ID } }],
    ['GET', '/api/admin/partners/export.csv', {}],
    ['GET', '/api/admin/manager-documents/:path', { params: { path: 'tok/aadhaar.pdf' } }],
  ];
  for (const [method, path, options] of checks) {
    const harness = mount({ access: manager });
    const res = await harness.call(method, path, options);
    assert.equal(res.statusCode, 403, `${method} ${path} must refuse a manager`);
    assert.equal(res.body.error.code, 'super_admin_required', `${method} ${path} names the missing role`);
    assert.equal(
      harness.rpcCalls.filter((call) => call.fn !== 'get_my_admin_access').length,
      0,
      `${method} ${path} must not reach the database`
    );
  }

  // Deletion is the same rule, from the moderation route.
  const harness = mount({ access: manager });
  const res = await harness.call('POST', '/api/admin/partners/:id/state', {
    body: { action: 'soft_delete', reason: 'duplicate' },
    params: { id: APPLICATION_ID },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'super_admin_required');
});

test('money routes need an Admin/Super Admin, and a reason/UTR is mandatory', async () => {
  const manager = { is_admin: true, role: 'area_manager', work_area: 'Jhotwara', can_manage_money: false };
  const bank = mount({ access: manager });
  const bankRes = await bank.call('POST', '/api/admin/partners/:id/bank-details', {
    body: { payout_upi_id: 'x@okbank' },
    params: { id: APPLICATION_ID },
  });
  assert.equal(bankRes.statusCode, 403);

  const payouts = mount({ access: manager });
  const payoutRes = await payouts.call('POST', '/api/admin/payouts/:id/process', {
    body: { action: 'mark_paid', utr: 'UTR123456' },
    params: { id: APPLICATION_ID },
  });
  assert.equal(payoutRes.statusCode, 403);

  // A ban without a reason is refused with the reason the operator needs.
  const noReason = mount({ access: { is_admin: true, role: 'admin', work_area: 'Jhotwara', can_manage_money: true } });
  const banRes = await noReason.call('POST', '/api/admin/partners/:id/state', {
    body: { action: 'ban' },
    params: { id: APPLICATION_ID },
  });
  assert.equal(banRes.statusCode, 400);
  assert.match(banRes.body.error.message, /reason is required/);

  // A payout marked paid without a real reference is refused before SQL.
  const noUtr = mount({ access: { is_admin: true, role: 'admin', work_area: 'Jhotwara', can_manage_money: true } });
  const utrRes = await noUtr.call('POST', '/api/admin/payouts/:id/process', {
    body: { action: 'mark_paid', utr: 'abc' },
    params: { id: APPLICATION_ID },
  });
  assert.equal(utrRes.statusCode, 400);
  assert.match(utrRes.body.error.message, /UTR|at least 6 characters/i);
});

// ---------------------------------------------------------------------------
// 3. The public onboarding surface
// ---------------------------------------------------------------------------
test('the public form reads a link, uploads a document and submits — and nothing else', async () => {
  const harness = mount({ storeDocument: async ({ kind }) => `tok/${kind}-abc.png` });

  const info = await harness.call('GET', '/api/public/manager-onboarding/:token', {
    token: null,
    params: { token: 'x'.repeat(40) },
  });
  assert.equal(info.statusCode, 200);
  assert.deepEqual(info.body.data, { valid: true, work_area: 'Malviya Nagar', role: 'area_manager' });
  const infoCall = harness.rpcCalls.find((call) => call.fn === 'get_manager_onboarding_link');
  assert.deepEqual(infoCall?.args, { p_token: 'x'.repeat(40) }, 'only the token is forwarded — never an actor id');

  const upload = await harness.call('POST', '/api/public/manager-onboarding/:token/documents', {
    token: null,
    params: { token: 'x'.repeat(40) },
    body: { kind: 'aadhaar_front', file_name: 'aadhaar.png', data_url: `data:image/png;base64,${Buffer.from('scan').toString('base64')}` },
  });
  assert.equal(upload.statusCode, 201);
  assert.equal(upload.body.data.path, 'tok/aadhaar_front-abc.png');

  const submit = await harness.call('POST', '/api/public/manager-onboarding/:token', {
    token: null,
    params: { token: 'x'.repeat(40) },
    body: { full_name: 'Neha Sharma', email: 'neha@nexora.example', phone: '9876500000' },
  });
  assert.equal(submit.statusCode, 201);
  const submitCall = harness.rpcCalls.find((call) => call.fn === 'submit_manager_onboarding_application');
  assert.equal((submitCall?.args as any).p_token, 'x'.repeat(40));

  // The public surface is exactly those three routes.
  assert.deepEqual(
    PUBLIC_ONBOARDING_ROUTES.map((route) => `${route.method.toUpperCase()} ${route.path}`).sort(),
    [
      'GET /api/public/manager-onboarding/:token',
      'POST /api/public/manager-onboarding/:token',
      'POST /api/public/manager-onboarding/:token/documents',
    ]
  );
});

test('the public routes refuse bad input and never invent storage', async () => {
  const harness = mount();
  const shortToken = await harness.call('GET', '/api/public/manager-onboarding/:token', {
    token: null,
    params: { token: 'too-short' },
  });
  assert.equal(shortToken.statusCode, 404);

  const badKind = await harness.call('POST', '/api/public/manager-onboarding/:token/documents', {
    token: null,
    params: { token: 'x'.repeat(40) },
    body: { kind: 'passport', file_name: 'x.png', data_url: 'data:image/png;base64,AAAA' },
  });
  assert.equal(badKind.statusCode, 400);
  assert.match(badKind.body.error.message, /kind must be/);

  const notADataUrl = await harness.call('POST', '/api/public/manager-onboarding/:token/documents', {
    token: null,
    params: { token: 'x'.repeat(40) },
    body: { kind: 'photo', file_name: 'x.png', data_url: 'https://example.com/x.png' },
  });
  assert.equal(notADataUrl.statusCode, 400);
  assert.match(notADataUrl.body.error.message, /base64 data URL/);

  // No document store configured → 503 with actionable copy, never a fake path.
  const noStore = mount({ storeDocument: async () => null });
  const degraded = await noStore.call('POST', '/api/public/manager-onboarding/:token/documents', {
    token: null,
    params: { token: 'x'.repeat(40) },
    body: { kind: 'photo', file_name: 'x.png', data_url: 'data:image/png;base64,AAAA' },
  });
  assert.equal(degraded.statusCode, 503);
  assert.equal(degraded.body.error.code, 'storage_unavailable');
});

// ---------------------------------------------------------------------------
// 4. Approval: the account comes from the application, never from the body
// ---------------------------------------------------------------------------
test('approving a manager creates the Auth user for the APPLICATION’s email, area and role', async () => {
  const created: any[] = [];
  const harness = mount({
    createAuthUser: async (input) => {
      created.push(input);
      return { id: 'new-manager-user' };
    },
  });
  const res = await harness.call('POST', '/api/admin/manager-applications/:id/approve', {
    params: { id: APPLICATION_ID },
    body: {
      password: 'TempPass123',
      // An attacker-controlled body trying to widen the grant: ignored.
      email: 'attacker@example.com',
      work_area: 'Malviya Nagar',
      role: 'super_admin',
    },
  });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(created[0], {
    email: 'neha@nexora.example',
    password: 'TempPass123',
    full_name: 'Neha Sharma',
    work_area: 'Vaishali Nagar',
    role: 'sub_admin',
  });
  const review = harness.rpcCalls.find((call) => call.fn === 'admin_review_manager_application');
  assert.deepEqual(review?.args, {
    p_application_id: APPLICATION_ID,
    p_approve: true,
    p_note: null,
    p_user_id: 'new-manager-user',
  });
  assert.equal(res.body.data.temporary_password, 'TempPass123', 'the operator is shown what to hand over');

  // A short password is refused before anything is created.
  const weak = mount({ createAuthUser: async () => ({ id: 'x' }) });
  const weakRes = await weak.call('POST', '/api/admin/manager-applications/:id/approve', {
    params: { id: APPLICATION_ID },
    body: { password: 'short' },
  });
  assert.equal(weakRes.statusCode, 400);
  assert.match(weakRes.body.error.message, /at least 8 characters/);

  // No service role on this deploy → 503 with the reason, and no half-created member.
  const noServiceRole = mount();
  const unavailable = await noServiceRole.call('POST', '/api/admin/manager-applications/:id/approve', {
    params: { id: APPLICATION_ID },
    body: { password: 'TempPass123' },
  });
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.body.error.code, 'storage_unavailable');
  assert.equal(
    noServiceRole.rpcCalls.some((call) => call.fn === 'admin_review_manager_application'),
    false,
    'the application is not marked approved when the account could not be created'
  );
});

// ---------------------------------------------------------------------------
// 5. Export
// ---------------------------------------------------------------------------
test('the CSV export is super-admin only, escapes properly, and carries no secrets', async () => {
  const manager = mount({ access: { is_admin: true, role: 'admin', work_area: 'Jhotwara', can_manage_money: true } });
  const refused = await manager.call('GET', '/api/admin/partners/export.csv');
  assert.equal(refused.statusCode, 403);

  const harness = mount({
    rpc: async (fn) => {
      if (fn === 'admin_export_partner_directory') {
        return {
          data: {
            items: [
              {
                id: 'p-1',
                referral_code: 'JHO001',
                full_name: 'Partner, "One"',
                email: 'one@partner.example',
                phone: '9876543210',
                work_area: 'Jhotwara',
                is_active: true,
                onboarded_salons: 2,
                lifetime_paise: 150000,
                available_paise: 50000,
                open_payouts: 1,
              },
            ],
          },
        };
      }
      return { data: {} };
    },
  });
  const res = await harness.call('GET', '/api/admin/partners/export.csv');
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type']), /text\/csv/);
  const csv = String(res.body);
  const [header, row] = csv.split('\r\n');
  assert.match(header, /^partner_id,referral_code,full_name,email,phone/);
  assert.match(row, /"Partner, ""One"""/, 'a comma and a quote in a name are escaped, not broken');
  assert.doesNotMatch(csv, /account_number|upi|ifsc/i, 'no bank details can reach the export');
  const exportCall = harness.rpcCalls.find((call) => call.fn === 'admin_export_partner_directory');
  assert.ok(exportCall, 'the export runs through SQL, which writes the audit row');
});
