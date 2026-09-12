// ============================================================================
// Local Supabase-compatible gateway — end-to-end over real HTTP.
//
// Spins the gateway up on an ephemeral port and drives it exactly the way
// supabase-js does: sign up, submit a KYC application, review it as the admin,
// then read the partner area. Every step executes the committed migrations on
// PGlite, so this is the "does the local live stack actually work" gate.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  LOCAL_DEV_ADMIN_EMAIL,
  LOCAL_DEV_ADMIN_PASSWORD,
  registerLocalSupabaseGateway,
  signLocalToken,
  verifyLocalToken,
} from '../server/localSupabase';

async function startGateway() {
  const app = express();
  app.use(express.json());
  const gateway = await registerLocalSupabaseGateway(app, { log: () => {} });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await gateway.close();
    },
  };
}

async function rpc(
  origin: string,
  fn: string,
  args: Record<string, unknown> = {},
  token?: string
) {
  const res = await fetch(`${origin}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: 'local-dev-key',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(args),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function signUp(origin: string, email: string, password: string, fullName: string) {
  const res = await fetch(`${origin}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: 'local-dev-key' },
    body: JSON.stringify({ email, password, data: { full_name: fullName } }),
  });
  const body: any = await res.json();
  assert.equal(res.status, 200, `signup failed: ${JSON.stringify(body)}`);
  return body as { access_token: string; user: { id: string; email: string } };
}

async function signIn(origin: string, email: string, password: string) {
  const res = await fetch(`${origin}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: 'local-dev-key' },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

test('1. sign-up creates a session, a profile row and rejects a wrong password', async () => {
  const gateway = await startGateway();
  try {
    const session = await signUp(gateway.origin, 'asha@example.com', 'Str0ngPass!1', 'Asha Sharma');
    assert.ok(session.access_token.split('.').length === 3, 'a real JWT is issued');
    assert.equal(session.user.email, 'asha@example.com');

    const claims = verifyLocalToken(session.access_token);
    assert.ok(claims);
    assert.equal(claims.sub, session.user.id);
    assert.equal(claims.isAdmin, false);

    // /auth/v1/user resolves the session, which is what a page refresh does.
    const me = await fetch(`${gateway.origin}/auth/v1/user`, {
      headers: { authorization: `Bearer ${session.access_token}` },
    });
    assert.equal(me.status, 200);
    const meBody: any = await me.json();
    assert.equal(meBody.email, 'asha@example.com');
    assert.equal(meBody.user_metadata.full_name, 'Asha Sharma');

    const wrong = await signIn(gateway.origin, 'asha@example.com', 'nope');
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error, 'invalid_grant');
    assert.match(wrong.body.error_description, /Invalid login credentials/);

    const right = await signIn(gateway.origin, 'asha@example.com', 'Str0ngPass!1');
    assert.equal(right.status, 200);
    assert.ok(right.body.access_token);
  } finally {
    await gateway.close();
  }
});

test('2. the full partner journey works over HTTP: apply → review → area', async () => {
  const gateway = await startGateway();
  try {
    const partner = await signUp(gateway.origin, 'asha@example.com', 'Str0ngPass!1', 'Asha Sharma');

    // The sign-up form's call.
    const submitted = await rpc(
      gateway.origin,
      'submit_growth_partner_application',
      {
        p_full_name: 'Asha Sharma',
        p_phone: '9876543210',
        p_kyc_document_type: 'pan',
        p_kyc_document_reference: 'ABCDE1234F',
      },
      partner.access_token
    );
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.equal(submitted.body.status, 'pending');
    assert.equal(submitted.body.kyc_status, 'submitted');

    // Not a partner yet → the area gate returns null, which the UI renders as
    // "Growth Partners only".
    const before = await rpc(gateway.origin, 'get_my_growth_partner', {}, partner.access_token);
    assert.equal(before.status, 200);
    assert.equal(before.body, null);

    // The documented local admin account reviews it.
    const admin = await signIn(gateway.origin, LOCAL_DEV_ADMIN_EMAIL, LOCAL_DEV_ADMIN_PASSWORD);
    assert.equal(admin.status, 200, 'the seeded local admin must be able to sign in');
    assert.equal(verifyLocalToken(admin.body.access_token)?.isAdmin, true);

    const reviewed = await rpc(
      gateway.origin,
      'review_growth_partner_application',
      { p_application_id: submitted.body.id, p_approve: true, p_note: 'KYC verified' },
      admin.body.access_token
    );
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    assert.equal(reviewed.body.status, 'approved');
    assert.match(reviewed.body.referral_code, /^[A-Z0-9]{6,12}$/);

    // The partner area now opens and its reads return real (empty) numbers.
    const after = await rpc(gateway.origin, 'get_my_growth_partner', {}, partner.access_token);
    assert.equal(after.body.is_active, true);
    assert.equal(after.body.referral_code, reviewed.body.referral_code);

    const dashboard = await rpc(gateway.origin, 'get_my_partner_dashboard', {}, partner.access_token);
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.body.kpis.total_referrals, 0);

    const performance = await rpc(
      gateway.origin,
      'get_my_partner_performance',
      {},
      partner.access_token
    );
    assert.equal(performance.status, 200);
    assert.ok(Array.isArray(performance.body.monthly));

    // A second user links with the code and shows up in the partner's numbers.
    const referred = await signUp(gateway.origin, 'ravi@example.com', 'Str0ngPass!2', 'Ravi Kumar');
    const linked = await rpc(
      gateway.origin,
      'link_my_growth_referral',
      { p_code: reviewed.body.referral_code },
      referred.access_token
    );
    assert.equal(linked.status, 200, JSON.stringify(linked.body));
    const dashboard2 = await rpc(gateway.origin, 'get_my_partner_dashboard', {}, partner.access_token);
    assert.equal(dashboard2.body.kpis.total_referrals, 1);
  } finally {
    await gateway.close();
  }
});

test('3. review is admin-only and anonymous calls are denied', async () => {
  const gateway = await startGateway();
  try {
    const partner = await signUp(gateway.origin, 'asha@example.com', 'Str0ngPass!1', 'Asha Sharma');
    const submitted = await rpc(
      gateway.origin,
      'submit_growth_partner_application',
      {
        p_full_name: 'Asha Sharma',
        p_phone: null,
        p_kyc_document_type: 'pan',
        p_kyc_document_reference: 'ABCDE1234F',
      },
      partner.access_token
    );

    const selfApproval = await rpc(
      gateway.origin,
      'review_growth_partner_application',
      { p_application_id: submitted.body.id, p_approve: true },
      partner.access_token
    );
    assert.equal(selfApproval.status, 403);
    assert.equal(selfApproval.body.code, '42501');

    const anon = await rpc(gateway.origin, 'get_my_partner_dashboard', {});
    assert.equal(anon.status, 403);
    assert.equal(anon.body.code, '42501');

    // A forged token is rejected before it reaches the database.
    const forged = signLocalToken({
      sub: partner.user.id,
      email: 'asha@example.com',
      isAdmin: true,
      fullName: 'Asha',
    }).accessToken.replace(/.$/, (char) => (char === 'a' ? 'b' : 'a'));
    const withForged = await rpc(gateway.origin, 'get_my_partner_dashboard', {}, forged);
    assert.equal(withForged.status, 403);
  } finally {
    await gateway.close();
  }
});

test('4. unknown functions and table reads answer honestly, never fake data', async () => {
  const gateway = await startGateway();
  try {
    const missing = await rpc(gateway.origin, 'no_such_function', {});
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'PGRST202');

    // Not one of the Growth Partner area's own tables → 501, no invented rows.
    const table = await fetch(`${gateway.origin}/rest/v1/salons?select=*`, {
      headers: { apikey: 'local-dev-key' },
    });
    assert.equal(table.status, 501);
    const body: any = await table.json();
    assert.match(body.message, /serves the Growth Partner area only/);
  } finally {
    await gateway.close();
  }
});

test('5. the area\'s own table read is RLS-scoped: callers see only their own application', async () => {
  const gateway = await startGateway();
  try {
    const asha = await signUp(gateway.origin, 'asha@example.com', 'Str0ngPass!1', 'Asha Sharma');
    await rpc(
      gateway.origin,
      'submit_growth_partner_application',
      {
        p_full_name: 'Asha Sharma',
        p_phone: '9876543210',
        p_kyc_document_type: 'pan',
        p_kyc_document_reference: 'ABCDE1234F',
      },
      asha.access_token
    );
    const ravi = await signUp(gateway.origin, 'ravi@example.com', 'Str0ngPass!2', 'Ravi Kumar');

    const read = async (token?: string, accept?: string) => {
      const res = await fetch(
        `${gateway.origin}/rest/v1/growth_partner_applications?select=id,status,kyc_status,created_at&order=created_at.desc&limit=1`,
        {
          headers: {
            apikey: 'local-dev-key',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(accept ? { accept } : {}),
          },
        }
      );
      return { status: res.status, body: await res.json().catch(() => null) };
    };

    // The applicant sees their own pending application (the self-select policy).
    const own = await read(asha.access_token);
    assert.equal(own.status, 200);
    assert.equal(Array.isArray(own.body) ? own.body.length : -1, 1);
    assert.equal(own.body[0].status, 'pending');
    assert.equal(own.body[0].kyc_status, 'submitted');

    // .maybeSingle() style read: one object, and its shape is the same row.
    const single = await read(asha.access_token, 'application/vnd.pgrst.object+json');
    assert.equal(single.status, 200);
    assert.equal(single.body.status, 'pending');

    // Another signed-in user gets zero rows — RLS, not application code.
    const other = await read(ravi.access_token);
    assert.equal(other.status, 200);
    assert.deepEqual(other.body, []);

    // Anonymous has no SELECT grant on the table at all — refused, not emptied.
    const anon = await read();
    assert.equal(anon.status, 400);
    assert.equal(anon.body.code, '42501');

    // An unknown column is refused the way PostgREST refuses it.
    const badColumn = await fetch(
      `${gateway.origin}/rest/v1/growth_partner_applications?select=id,encrypted_password`,
      { headers: { apikey: 'local-dev-key', authorization: `Bearer ${asha.access_token}` } }
    );
    assert.equal(badColumn.status, 400);
    const badBody: any = await badColumn.json();
    assert.equal(badBody.code, 'PGRST204');
  } finally {
    await gateway.close();
  }
});

// ---------------------------------------------------------------------------
// PART 2 — password reset over the local gateway (/auth/v1/recover + PUT /user)
// ---------------------------------------------------------------------------

test('6. the partner forgot-password flow works end to end over HTTP', async () => {
  const logs: string[] = [];
  const app = express();
  app.use(express.json());
  const gateway = await registerLocalSupabaseGateway(app, { log: (line: string) => logs.push(line) });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const session = await signUp(origin, 'partner-reset@example.com', 'Str0ngPass!1', 'Reset Partner');

    // 1) Request the reset for the account. The response never reveals
    //    existence — the same 200 comes back for an unknown email.
    const requested = await fetch(`${origin}/auth/v1/recover?redirect_to=/partner/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: 'local-dev-key' },
      body: JSON.stringify({ email: 'partner-reset@example.com' }),
    });
    assert.equal(requested.status, 200);
    assert.deepEqual(await requested.json(), {});
    const unknown = await fetch(`${origin}/auth/v1/recover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: 'local-dev-key' },
      body: JSON.stringify({ email: 'nobody@example.com' }),
    });
    assert.equal(unknown.status, 200);
    assert.deepEqual(await unknown.json(), {});

    // 2) The logged dev link uses Supabase's implicit recovery format, lands
    //    on /partner/login and carries a token the gateway itself accepts.
    const linkLine = logs.find((line) => line.includes('/partner/login#'));
    assert.ok(linkLine, 'the gateway must log the one-time recovery link');
    assert.match(linkLine, /access_token=[^&]+/);
    assert.match(linkLine, /token_type=recovery/);
    assert.match(linkLine, /type=recovery/);
    assert.match(linkLine, /refresh_token=/);
    const recoveryToken = /access_token=([^&]+)/.exec(linkLine)![1];
    const me = await fetch(`${origin}/auth/v1/user`, {
      headers: { authorization: `Bearer ${recoveryToken}` },
    });
    assert.equal(me.status, 200, 'the recovery token must resolve to a real session');
    assert.equal((await me.json() as any).email, 'partner-reset@example.com');

    // 3) Set the new password through PUT /auth/v1/user (what updateUser sends).
    const weak = await fetch(`${origin}/auth/v1/user`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', apikey: 'local-dev-key', authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ password: 'short' }),
    });
    assert.equal(weak.status, 422);
    assert.equal((await weak.json() as any).error, 'weak_password');

    const anonymous = await fetch(`${origin}/auth/v1/user`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', apikey: 'local-dev-key' },
      body: JSON.stringify({ password: 'BrandNewPass!2' }),
    });
    assert.equal(anonymous.status, 401, 'a bearer token is required');

    const updated = await fetch(`${origin}/auth/v1/user`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', apikey: 'local-dev-key', authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ password: 'BrandNewPass!2' }),
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json() as any).email, 'partner-reset@example.com');

    // 4) The old password is gone; the new one signs in.
    const oldSignIn = await signIn(origin, 'partner-reset@example.com', 'Str0ngPass!1');
    assert.equal(oldSignIn.status, 400, 'the old password must stop working');
    const newSignIn = await signIn(origin, 'partner-reset@example.com', 'BrandNewPass!2');
    assert.equal(newSignIn.status, 200);
    assert.ok(newSignIn.body.access_token);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await gateway.close();
  }
});
