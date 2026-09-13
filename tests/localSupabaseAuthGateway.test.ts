import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerLocalSupabaseGateway } from '../server/localSupabase';

// ============================================================================
// The local Supabase gateway's /auth/v1 contract, as the onboarding signup and
// login screens depend on it (PHASE 2).
//
// Two things are pinned here that nothing else covers:
//
//   * the metadata the sign-up form sends (`full_name`, `phone_number`) really
//     reaches `raw_user_meta_data`, so the `handle_new_user()` trigger can
//     complete the `profiles` row — the gap that left every funnel signup with
//     a blank name;
//   * with LOCAL_SUPABASE_REQUIRE_EMAIL_CONFIRMATION the gateway behaves like a
//     project with "Confirm email" ON: a user with no session, a login refusal,
//     and a re-sendable confirmation mail that never reveals whether the
//     address exists.
//
// These are real HTTP calls against real PGlite and the real migration chain —
// the same surface the browser talks to.
// ============================================================================

interface Gateway {
  origin: string;
  close: () => Promise<void>;
}

const live: Gateway[] = [];
const dirs: string[] = [];

after(async () => {
  for (const g of live) await g.close();
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

async function boot(options: { requireEmailConfirmation?: boolean } = {}): Promise<Gateway> {
  const dataDir = await mkdtemp(join(tmpdir(), 'local-auth-gateway-'));
  dirs.push(dataDir);
  const previous = process.env.LOCAL_SUPABASE_REQUIRE_EMAIL_CONFIRMATION;
  if (options.requireEmailConfirmation) process.env.LOCAL_SUPABASE_REQUIRE_EMAIL_CONFIRMATION = 'true';
  else delete process.env.LOCAL_SUPABASE_REQUIRE_EMAIL_CONFIRMATION;

  const app = express();
  app.use(express.json());
  const gateway = await registerLocalSupabaseGateway(app, { dataDir, log: () => {} });
  const server: Server = await new Promise((resolve) => {
    const s = createServer(app);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Restore the caller's environment: the flag is read when the gateway is
  // registered, so leaving it set would leak into later tests.
  if (previous === undefined) delete process.env.LOCAL_SUPABASE_REQUIRE_EMAIL_CONFIRMATION;
  else process.env.LOCAL_SUPABASE_REQUIRE_EMAIL_CONFIRMATION = previous;

  const g: Gateway = {
    origin,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
      await gateway.close();
    },
  };
  live.push(g);
  return g;
}

const post = async (origin: string, path: string, body: unknown) => {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: 'local-dev-key' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const get = async (origin: string, path: string) => {
  const response = await fetch(`${origin}${path}`, { headers: { apikey: 'local-dev-key' } });
  return { status: response.status, body: await response.json() };
};

test('signup metadata reaches raw_user_meta_data and completes the profiles row', async () => {
  const { origin } = await boot();
  const email = `owner-${Date.now()}@example.com`;
  const signup = await post(origin, '/auth/v1/signup', {
    email,
    password: 'Secret123!',
    data: { full_name: 'Uma Rao', phone_number: '+919845077654' },
  });
  assert.equal(signup.status, 200);
  assert.ok(signup.body.access_token, 'auto-confirm issues a session');
  assert.deepEqual(signup.body.user.user_metadata, {
    full_name: 'Uma Rao',
    phone_number: '+919845077654',
  });

  // The owner reads back the row their own signup created — through the RLS
  // policy the gateway now enables on the profiles stand-in.
  const read = await fetch(
    `${origin}/rest/v1/profiles?select=full_name,phone_number,owner_role,email&id=eq.${signup.body.user.id}`,
    { headers: { apikey: 'local-dev-key', Authorization: `Bearer ${signup.body.access_token}` } }
  );
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), [
    {
      full_name: 'Uma Rao',
      phone_number: '+919845077654',
      owner_role: null,
      email,
    },
  ]);
});

test('a signup without metadata keeps the empty-string contract and never invents a phone', async () => {
  const { origin } = await boot();
  const signup = await post(origin, '/auth/v1/signup', {
    email: `bare-${Date.now()}@example.com`,
    password: 'Secret123!',
  });
  assert.equal(signup.status, 200);
  const read = await fetch(
    `${origin}/rest/v1/profiles?select=full_name,phone_number,owner_role&id=eq.${signup.body.user.id}`,
    { headers: { apikey: 'local-dev-key', Authorization: `Bearer ${signup.body.access_token}` } }
  );
  assert.deepEqual(await read.json(), [{ full_name: '', phone_number: null, owner_role: null }]);
});

test('profiles is owner-scoped: another owner and anon both see nothing', async () => {
  const { origin } = await boot();
  const first = await post(origin, '/auth/v1/signup', {
    email: `first-${Date.now()}@example.com`,
    password: 'Secret123!',
    data: { full_name: 'First Owner', phone_number: '+919845077654' },
  });
  const second = await post(origin, '/auth/v1/signup', {
    email: `second-${Date.now()}@example.com`,
    password: 'Secret123!',
    data: { full_name: 'Second Owner', phone_number: '+919845077655' },
  });

  const crossRead = await fetch(
    `${origin}/rest/v1/profiles?select=email&id=eq.${first.body.user.id}`,
    { headers: { apikey: 'local-dev-key', Authorization: `Bearer ${second.body.access_token}` } }
  );
  assert.equal(crossRead.status, 200);
  assert.deepEqual(await crossRead.json(), [], 'another owner cannot read this profile');

  const anonRead = await fetch(`${origin}/rest/v1/profiles?select=email`, {
    headers: { apikey: 'local-dev-key' },
  });
  // The gateway answers a client error for anon (it has no table privilege and
  // RLS is on); the exact status is the gateway's, the point is that no rows
  // come back.
  assert.ok(anonRead.status >= 400 && anonRead.status < 500, `anon refused with ${anonRead.status}`);
  const anonBody = await anonRead.json();
  assert.ok(!Array.isArray(anonBody) || anonBody.length === 0, 'anon receives no profile rows');
});

test('duplicate signup and missing credentials are both rejected', async () => {
  const { origin } = await boot();
  const email = `dupe-${Date.now()}@example.com`;
  const first = await post(origin, '/auth/v1/signup', { email, password: 'Secret123!' });
  assert.equal(first.status, 200);
  const again = await post(origin, '/auth/v1/signup', { email, password: 'Secret123!' });
  assert.equal(again.status, 422);
  assert.equal(again.body.error, 'user_already_exists');
  const noPassword = await post(origin, '/auth/v1/signup', { email: `np-${Date.now()}@example.com` });
  assert.equal(noPassword.status, 422);
});

test('with confirmation required: user without a session, login refused, resend safe', async () => {
  const { origin } = await boot({ requireEmailConfirmation: true });

  const settings = await get(origin, '/auth/v1/settings');
  assert.equal(settings.body.mailer_autoconfirm, false);

  const email = `pending-${Date.now()}@example.com`;
  const signup = await post(origin, '/auth/v1/signup', {
    email,
    password: 'Secret123!',
    data: { full_name: 'Pending Owner', phone_number: '+919845077654' },
  });
  assert.equal(signup.status, 200);
  // This exact shape is what signUpWithEmail() reports as confirmationRequired.
  assert.ok(signup.body.user, 'a user is returned');
  assert.equal(signup.body.access_token, undefined, 'but no session');
  assert.equal(signup.body.user.email_confirmed_at, null);

  // An unverified address cannot log in; the message is the one
  // toSafeAuthError maps to "Please verify your email, then log in."
  const login = await post(origin, '/auth/v1/token?grant_type=password', {
    email,
    password: 'Secret123!',
  });
  assert.equal(login.status, 400);
  assert.equal(login.body.error, 'email_not_confirmed');

  // Resend answers identically whether or not the address exists, so it cannot
  // be used to enumerate accounts.
  const known = await post(origin, '/auth/v1/resend', { type: 'signup', email });
  const unknown = await post(origin, '/auth/v1/resend', {
    type: 'signup',
    email: `nobody-${Date.now()}@example.com`,
  });
  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  assert.deepEqual(known.body, unknown.body);
  assert.deepEqual(known.body, {});

  const badType = await post(origin, '/auth/v1/resend', { type: 'banana', email });
  assert.equal(badType.status, 422);
});

test('auto-confirm is the default: an unchanged local environment still logs in', async () => {
  const { origin } = await boot();
  const settings = await get(origin, '/auth/v1/settings');
  assert.equal(settings.body.mailer_autoconfirm, true);
  const email = `auto-${Date.now()}@example.com`;
  await post(origin, '/auth/v1/signup', { email, password: 'Secret123!' });
  const login = await post(origin, '/auth/v1/token?grant_type=password', {
    email,
    password: 'Secret123!',
  });
  assert.equal(login.status, 200);
  assert.ok(login.body.access_token);
});
