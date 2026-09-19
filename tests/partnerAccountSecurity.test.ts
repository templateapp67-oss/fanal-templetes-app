import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  beginPartnerTwoFactorEnrollment,
  cancelPartnerAccountDeactivation,
  changePartnerPassword,
  confirmPartnerTwoFactor,
  describeSession,
  disablePartnerTwoFactor,
  fetchPartnerSecurityOverview,
  requestPartnerAccountDeactivation,
  requestPartnerEmailChange,
  revokeOtherPartnerSessions,
  type SecurityOverviewClient,
} from '../src/lib/partnerAccountSecurity';
import { socialHandlesToLinks, normalizeSocialLinks } from '../src/lib/growthPartnerProfile';

// ============================================================================
// The ACCOUNT SECURITY client layer: honest error mapping, the exact RPC/auth
// call shapes, and the rule that the 2FA mirror is written only AFTER the
// auth backend verified a code.
// ============================================================================

const userId = 'a0000000-0000-4000-8000-000000000001';

function mockClient(overrides: Partial<Record<string, any>> = {}, state: { calls?: any[]; mfaError?: any } = {}): SecurityOverviewClient {
  const calls = state.calls ?? [];
  state.calls = calls;
  const base: any = {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ rpc: fn, args });
      if (fn === 'get_my_partner_security_overview') {
        return { data: overrides.overview ?? { two_factor_enabled: false, sessions_available: true, sessions: [], events: [], deactivation: null }, error: null };
      }
      if (fn === 'revoke_my_other_partner_sessions') return { data: overrides.revokedCount ?? 2, error: null };
      if (fn === 'set_my_partner_two_factor') return { data: { two_factor_enabled: args?.p_enabled }, error: null };
      if (fn === 'request_my_partner_account_deactivation') return { data: { id: 'req-1', status: 'pending', requested_at: '2026-09-19T00:00:00Z' }, error: null };
      if (fn === 'cancel_my_partner_account_deactivation') return { data: { status: 'cancelled' }, error: null };
      return { data: null, error: null };
    },
    auth: {
      getUser: async () => ({ data: { user: { id: userId, email: 'meera@example.com' } }, error: null }),
      updateUser: async (attributes: any) => {
        calls.push({ auth: 'updateUser', attributes });
        return { data: { user: { id: userId } }, error: null };
      },
      signInWithPassword: async (credentials: any) => {
        calls.push({ auth: 'signInWithPassword', credentials });
        if (state.mfaError && credentials.password === 'wrong-pass') return { data: null, error: { message: 'Invalid login credentials' } };
        return { data: { user: { id: userId } }, error: null };
      },
      mfa: {
        listFactors: async () => ({ data: { factors: overrides.factors ?? [] }, error: null }),
        enroll: async (attrs: any) => {
          calls.push({ mfa: 'enroll', attrs });
          if (overrides.enrollError) return { data: null, error: overrides.enrollError };
          return {
            data: {
              id: 'factor-1',
              type: 'totp',
              totp: { qr_code: overrides.rawQr ?? '', secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/Nexora:meera@example.com?secret=JBSWY3DPEHPK3PXP' },
            },
            error: null,
          };
        },
        challenge: async (attrs: any) => {
          calls.push({ mfa: 'challenge', attrs });
          return { data: { id: 'challenge-1' }, error: null };
        },
        verify: async (attrs: any) => {
          calls.push({ mfa: 'verify', attrs });
          if (overrides.verifyError) return { data: null, error: overrides.verifyError };
          return { data: { success: true }, error: null };
        },
        unenroll: async (attrs: any) => {
          calls.push({ mfa: 'unenroll', attrs });
          return { data: { id: attrs.factorId }, error: null };
        },
      },
    },
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  };
  return base as SecurityOverviewClient;
}

test('security overview maps the payload and keeps missing arrays honest', async () => {
  const client = mockClient({ overview: { two_factor_enabled: true, sessions_available: false, deactivation: { id: 'd1', status: 'pending', requested_at: '2026-09-19T00:00:00Z', reason: null } } });
  const overview = await fetchPartnerSecurityOverview(client);
  assert.equal(overview.two_factor_enabled, true);
  assert.equal(overview.sessions_available, false);
  assert.deepEqual(overview.sessions, []);
  assert.deepEqual(overview.events, []);
  assert.equal(overview.deactivation?.status, 'pending');
  // An RPC failure becomes a safe message, never raw Postgres text.
  const broken = mockClient();
  (broken as any).rpc = async () => ({ data: null, error: { message: 'Active Growth Partner required' } });
  // Raw backend text never leaks to the surface.
  await assert.rejects(fetchPartnerSecurityOverview(broken), /Could not load your security overview/);
});

test('revoke reports a count and surfaces the deployment/identification refusals', async () => {
  const calls: any[] = [];
  const client = mockClient({ revokedCount: 3 }, { calls });
  assert.equal(await revokeOtherPartnerSessions(client), 3);
  assert.equal(calls.find((entry) => entry.rpc)?.rpc, 'revoke_my_other_partner_sessions');
  assert.equal(calls.filter((entry) => entry.rpc).length, 1, 'exactly one RPC, no partner id forwarded');

  const unavailable = mockClient();
  (unavailable as any).rpc = async () => ({ data: null, error: { message: 'Session management is not available on this deployment' } });
  await assert.rejects(revokeOtherPartnerSessions(unavailable), /not available on this deployment/);

  const unidentified = mockClient();
  (unidentified as any).rpc = async () => ({ data: null, error: { message: 'Current session could not be identified; sign in again and retry' } });
  await assert.rejects(revokeOtherPartnerSessions(unidentified), /could not be identified/);
});

test('password change verifies the CURRENT password first, then updates through Auth', async () => {
  const calls: any[] = [];
  const state = { calls, mfaError: true };
  const client = mockClient({}, state);
  await changePartnerPassword({ currentPassword: 'right-pass', newPassword: 'Better#2026', email: 'meera@example.com' }, client);
  const signIn = calls.find((entry) => entry.auth === 'signInWithPassword');
  const update = calls.find((entry) => entry.auth === 'updateUser');
  assert.deepEqual(signIn.credentials, { email: 'meera@example.com', password: 'right-pass' });
  assert.deepEqual(update.attributes, { password: 'Better#2026' });

  // A wrong current password never reaches the update call.
  const wrong = mockClient({}, { calls: [], mfaError: true });
  await assert.rejects(
    changePartnerPassword({ currentPassword: 'wrong-pass', newPassword: 'Better#2026', email: 'meera@example.com' }, wrong),
    /current password is not correct/
  );

  // No signInWithPassword arm → honest refusal instead of skipping the check.
  const legacy = { ...mockClient() } as any;
  legacy.auth = { ...legacy.auth, signInWithPassword: undefined };
  await assert.rejects(
    changePartnerPassword({ currentPassword: 'x', newPassword: 'y', email: 'e' }, legacy as SecurityOverviewClient),
    /live Supabase Auth/
  );
});

test('2FA enrollment returns the QR material; the mirror is written only after verify', async () => {
  const calls: any[] = [];
  const client = mockClient({}, { calls });
  const enrollment = await beginPartnerTwoFactorEnrollment(client);
  assert.equal(enrollment.factorId, 'factor-1');
  assert.equal(enrollment.secret, 'JBSWY3DPEHPK3PXP');
  assert.match(enrollment.uri, /^otpauth:\/\/totp\//);
  assert.equal(enrollment.qrDataUrl, null, 'an empty qr payload stays null, not a broken data URL');

  const raw = mockClient({ rawQr: '<svg/>' });
  const withQr = await beginPartnerTwoFactorEnrollment(raw);
  assert.equal(withQr.qrDataUrl, 'data:image/svg+xml;utf-8,<svg/>', 'a raw SVG payload is prefixed as a data URL');

  await confirmPartnerTwoFactor(client, 'factor-1', '123456');
  const flow = calls.filter((entry) => entry.mfa).map((entry) => entry.mfa);
  assert.deepEqual(flow, ['enroll', 'challenge', 'verify']);
  assert.deepEqual(calls.find((entry) => entry.rpc === 'set_my_partner_two_factor').args, { p_enabled: true, p_factor_id: 'factor-1' });

  // A wrong code NEVER reaches the mirror write.
  const wrong = mockClient({ verifyError: { message: 'Invalid TOTP code' } }, { calls: [] });
  await assert.rejects(confirmPartnerTwoFactor(wrong, 'factor-1', '000000'), /did not match|Invalid TOTP/i);
  assert.equal((wrong as any).__calls, undefined);

  // Enrollment refusal surfaces the duplicate-authenticator case.
  const dup = mockClient({ enrollError: { message: 'Factor already exists' } });
  await assert.rejects(beginPartnerTwoFactorEnrollment(dup), /already enrolled/i);
});

test('disable uses the verified factor and mirrors off', async () => {
  const calls: any[] = [];
  const client = mockClient({ factors: [{ id: 'factor-9', factor_type: 'totp', status: 'verified' }] }, { calls });
  await disablePartnerTwoFactor(client, 'factor-9');
  assert.ok(calls.some((entry) => entry.mfa === 'unenroll' && entry.attrs.factorId === 'factor-9'));
  assert.deepEqual(calls.find((entry) => entry.rpc === 'set_my_partner_two_factor').args, { p_enabled: false, p_factor_id: 'factor-9' });
});

test('email change keeps the Auth-only contract and logs the audit event', async () => {
  const calls: any[] = [];
  const client = mockClient({}, { calls });
  await requestPartnerEmailChange({ email: 'new@example.com', expectedUserId: userId, currentEmail: 'meera@example.com' }, client);
  assert.deepEqual(calls.find((entry) => entry.auth === 'updateUser').attributes, { email: 'new@example.com' });
  assert.equal(calls.find((entry) => entry.rpc === 'log_my_partner_security_event').args.p_type, 'email_change_requested');

  // Duplicate (current) email is refused before any auth call.
  const dupCalls: any[] = [];
  const dup = mockClient({}, { calls: dupCalls });
  await assert.rejects(
    requestPartnerEmailChange({ email: 'MEERA@example.com', expectedUserId: userId, currentEmail: 'meera@example.com' }, dup),
    /different email/
  );
  assert.equal(dupCalls.some((entry) => entry.auth === 'updateUser'), false);
});

test('deactivation request/cancel wrap the RPCs with friendly refusals', async () => {
  const client = mockClient();
  const request = await requestPartnerAccountDeactivation('  Moving cities  ', client);
  assert.equal(request.status, 'pending');

  const busy = mockClient();
  (busy as any).rpc = async (fn: string) => {
    if (fn === 'request_my_partner_account_deactivation') return { data: null, error: { message: 'A deactivation request is already pending review' } };
    return { data: null, error: null };
  };
  await assert.rejects(requestPartnerAccountDeactivation('', busy), /already pending/);

  const nothing = mockClient();
  (nothing as any).rpc = async (fn: string) => {
    if (fn === 'cancel_my_partner_account_deactivation') return { data: null, error: { message: 'No pending deactivation request to cancel' } };
    return { data: null, error: null };
  };
  await assert.rejects(cancelPartnerAccountDeactivation(nothing), /no pending deactivation/i);
});

test('describeSession turns user agents into honest device labels', () => {
  assert.equal(describeSession('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Safari/604.1'), 'iPhone · Safari');
  assert.equal(describeSession('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0'), 'Windows PC · Chrome');
  assert.equal(describeSession('Mozilla/5.0 (Macintosh) Firefox/128.0'), 'Mac · Firefox');
  assert.equal(describeSession('Mozilla/5.0 (X11; Linux) Edg/126.0'), 'Linux device · Edge');
  assert.equal(describeSession(null), 'Unknown device');
  assert.equal(describeSession('   '), 'Unknown device');
});

test('legacy social handle text migrates into the structured link fields', () => {
  assert.deepEqual(
    socialHandlesToLinks('instagram: @meera, linkedin=in/meera'),
    { instagram: '@meera', linkedin: 'in/meera', facebook: '', twitter: '' }
  );
  assert.deepEqual(socialHandlesToLinks(null), { instagram: '', linkedin: '', facebook: '', twitter: '' });
  assert.deepEqual(normalizeSocialLinks({ instagram: 'https://i.example', extra: 'dropped' }).instagram, 'https://i.example');
  assert.deepEqual(normalizeSocialLinks('junk').facebook, '');
});
