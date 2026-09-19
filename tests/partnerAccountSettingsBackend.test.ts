import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalDatabase } from '../server/localSupabase';

// ============================================================================
// ACCOUNT SETTINGS v2 + SECURITY — the SQL contract behind
// /partner/account-settings, exercised on the real migration chain (PGlite):
//
//   • save_my_partner_account_settings persists the contact/payout fields the
//     profile page binds (the old bug: they only ever lived in component
//     state) and REFUSES malformed IFSC/PAN/SWIFT/UPI/account numbers and
//     social links;
//   • get_my_partner_security_overview / revoke_my_other_partner_sessions /
//     set_my_partner_two_factor / deactivation request+cancel scope everything
//     to the caller's own active partner, derived from auth.uid();
//   • sessions behave like GoTrue's: the CURRENT session (from the
//     request.jwt.claims session_id) survives "revoke the others", and the
//     function refuses when it cannot identify the current session.
// ============================================================================

interface Harness {
  local: Awaited<ReturnType<typeof createLocalDatabase>>;
  user: (name: string) => Promise<string>;
  partner: (name: string, code: string) => Promise<string>;
  rpc: (actor: string | null, fn: string, args?: unknown[], claims?: Record<string, unknown>) => Promise<any>;
}

async function harness(): Promise<Harness> {
  const local = await createLocalDatabase();
  const db = local.db;
  const user = async (name: string) => {
    const id = randomUUID();
    await db.query(
      "insert into auth.users(id,email,encrypted_password,raw_user_meta_data) values($1,$2,'x',$3::jsonb)",
      [id, `${name}@example.com`, JSON.stringify({ full_name: name })]
    );
    return id;
  };
  const partner = async (name: string, code: string) => {
    const id = await user(name);
    await db.query('select public.provision_growth_partner($1,$2)', [id, code]);
    return id;
  };
  const rpc = (actor: string | null, fn: string, args: unknown[] = [], claims?: Record<string, unknown>) =>
    local.asRequest({ sub: actor, isAdmin: false }, async (conn) => {
      if (claims) {
        await conn.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
      }
      const placeholders = args.map((_, index) => `$${index + 1}`).join(',');
      const result = await conn.query(`select public.${fn}(${placeholders}) as r`, args);
      return result.rows[0]?.r;
    });
  return { local, user, partner, rpc };
}

// ---------------------------------------------------------------------------
// Account settings read/write + validation
// ---------------------------------------------------------------------------

test('account settings persist every bound field and refuse malformed banking input', async () => {
  const h = await harness();
  try {
    const a = await h.partner('Meera', 'NEXORA-SET001');
    const defaults = await h.rpc(a, 'get_my_partner_account_settings');
    assert.equal(defaults.city, '');
    assert.equal(defaults.notify_email, true);
    assert.equal(defaults.notify_whatsapp, false);
    assert.equal(defaults.two_factor_enabled, false);
    assert.deepEqual(defaults.social_links, {});

    const saved = await h.rpc(a, 'save_my_partner_account_settings', [{
      agency_name: 'Meera Growth Desk',
      city: 'Bengaluru',
      state: 'Karnataka',
      full_address: '12, MG Road',
      alternate_phone: '+919876543211',
      website_url: 'https://meera.example',
      public_bio: 'Salon growth partner',
      social_links: {
        instagram: 'https://instagram.com/meera',
        linkedin: 'https://linkedin.com/in/meera',
        facebook: 'https://facebook.com/meera',
        twitter: 'https://x.com/meera',
      },
      payout_method: 'bank_transfer',
      payout_account_name: 'Meera Kumar',
      payout_account_number: '1234567890',
      payout_ifsc: 'hdfc0001234',
      payout_upi_id: 'meera@bank',
      bank_name: 'HDFC Bank',
      bank_branch: 'MG Road',
      swift_code: 'hdfcinbb',
      pan_number: 'abcde1234f',
      notify_email: true,
      notify_whatsapp: true,
      notify_sms: true,
    }]);
    // Normalized exactly the way the SQL promises (IFSC/SWIFT/PAN uppercased).
    assert.equal(saved.payout_ifsc, 'HDFC0001234');
    assert.equal(saved.swift_code, 'HDFCINBB');
    assert.equal(saved.pan_number, 'ABCDE1234F');
    assert.equal(saved.account_number_hack, undefined);
    assert.equal(saved.city, 'Bengaluru');
    assert.equal(saved.notify_whatsapp, true);
    assert.deepEqual(saved.social_links.instagram, 'https://instagram.com/meera');

    // The read path returns the same row — the summary card never goes stale.
    const reread = await h.rpc(a, 'get_my_partner_account_settings');
    assert.equal(reread.full_address, '12, MG Road');
    assert.equal(reread.alternate_phone, '+919876543211');
    assert.equal(reread.bank_name, 'HDFC Bank');
    assert.equal(reread.pan_number, 'ABCDE1234F');

    // Patches are partial: a payout-only save keeps the contact fields.
    const partial = await h.rpc(a, 'save_my_partner_account_settings', [{ payout_upi_id: 'meera@upi' }]);
    assert.equal(partial.city, 'Bengaluru');
    assert.equal(partial.payout_upi_id, 'meera@upi');

    for (const [patch, pattern] of [
      [{ payout_ifsc: 'HDFC1234' }, /valid IFSC/],
      [{ pan_number: '12345' }, /valid PAN/],
      [{ swift_code: 'HDFCIN' }, /SWIFT/],
      [{ payout_upi_id: 'meera' }, /valid UPI/],
      [{ payout_account_number: '12abc' }, /6–24 digits/],
      [{ social_links: { tiktok: 'https://tiktok.com/@x' } }, /Unsupported social network/],
      [{ social_links: { instagram: 'javascript:alert(1)' } }, /http\(s\) URLs/],
      [{ social_links: 'instagram' }, /Invalid social links/],
      [{ kiyb_status: 'approved' }, /Unsupported account setting/],
    ] as Array<[Record<string, unknown>, RegExp]>) {
      await assert.rejects(h.rpc(a, 'save_my_partner_account_settings', [patch]), pattern, JSON.stringify(patch));
    }
    // Nothing above persisted.
    const after = await h.rpc(a, 'get_my_partner_account_settings');
    assert.equal(after.payout_ifsc, 'HDFC0001234');
    assert.equal(after.payout_upi_id, 'meera@upi');
  } finally {
    await h.local.close();
  }
});

// ---------------------------------------------------------------------------
// Security overview + sessions
// ---------------------------------------------------------------------------

test('the security overview lists sessions with the current one marked, and revoke keeps the current session', async () => {
  const h = await harness();
  try {
    const a = await h.partner('Revoke', 'NEXORA-SET002');
    const current = randomUUID();
    const other1 = randomUUID();
    const other2 = randomUUID();
    for (const [id, ua, ip] of [
      [current, 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0', '10.0.0.1'],
      [other1, 'Mozilla/5.0 (iPhone) Safari/605', '10.0.0.2'],
      [other2, 'Mozilla/5.0 (Macintosh) Firefox/128.0', '10.0.0.3'],
    ] as Array<[string, string, string]>) {
      await h.local.ownerQuery(
        "insert into auth.sessions(id,user_id,user_agent,ip) values($1,$2,$3,$4::inet)",
        [id, a, ua, ip]
      );
    }

    const overview = await h.rpc(a, 'get_my_partner_security_overview', [], { sub: a, session_id: current });
    assert.equal(overview.sessions_available, true);
    assert.equal(overview.sessions.length, 3);
    const marked = overview.sessions.filter((s: any) => s.is_current);
    assert.equal(marked.length, 1);
    assert.equal(marked[0].id, current);
    assert.equal(marked[0].user_agent.includes('Chrome'), true);
    assert.equal(marked[0].ip, '10.0.0.1');
    assert.deepEqual(overview.events, []);
    assert.equal(overview.deactivation, null);

    // Revoke the others: two gone, current kept, one event logged.
    const revoked = await h.rpc(a, 'revoke_my_other_partner_sessions', [], { sub: a, session_id: current });
    assert.equal(revoked, 2);
    const remaining = await h.local.ownerQuery('select id from auth.sessions where user_id = $1', [a]);
    assert.deepEqual(remaining.rows.map((row: any) => row.id), [current]);
    const after = await h.rpc(a, 'get_my_partner_security_overview', [], { sub: a, session_id: current });
    assert.equal(after.events.length, 1);
    assert.equal(after.events[0].event_type, 'sessions_revoked');

    // Without a current session id the revoke REFUSES instead of guessing.
    await assert.rejects(
      h.rpc(a, 'revoke_my_other_partner_sessions', [], { sub: a }),
      /could not be identified/
    );
    // A different partner sees only their own (empty) session list.
    const b = await h.partner('Other', 'NEXORA-SET003');
    const bOverview = await h.rpc(b, 'get_my_partner_security_overview', [], { sub: b });
    assert.deepEqual(bOverview.sessions, []);
  } finally {
    await h.local.close();
  }
});

test('two-factor mirror and the security event log', async () => {
  const h = await harness();
  try {
    const a = await h.partner('Totp', 'NEXORA-SET004');
    const on = await h.rpc(a, 'set_my_partner_two_factor', [true, 'factor-1']);
    assert.equal(on.two_factor_enabled, true);
    const overview = await h.rpc(a, 'get_my_partner_security_overview');
    assert.equal(overview.two_factor_enabled, true);
    assert.equal(overview.events[0].event_type, 'two_factor_enabled');
    await h.rpc(a, 'set_my_partner_two_factor', [false, 'factor-1']);
    const off = await h.rpc(a, 'get_my_partner_security_overview');
    assert.equal(off.two_factor_enabled, false);
    assert.equal(off.events[0].event_type, 'two_factor_disabled');
    await assert.rejects(h.rpc(a, 'set_my_partner_two_factor', [true, '../etc/passwd']), /authenticator reference/);
    // The client-side audit hook takes only the whitelisted types.
    await h.rpc(a, 'log_my_partner_security_event', ['credentials_changed', 'Password rotated from the account page.']);
    await assert.rejects(h.rpc(a, 'log_my_partner_security_event', ['sessions_revoked', 'spoofed']), /Unsupported security event/);
    const events = await h.rpc(a, 'get_my_partner_security_overview');
    assert.equal(events.events[0].event_type, 'credentials_changed');
  } finally {
    await h.local.close();
  }
});

// ---------------------------------------------------------------------------
// Deactivation request / cancel
// ---------------------------------------------------------------------------

test('deactivation is a request that can be filed once, cancelled and re-filed', async () => {
  const h = await harness();
  try {
    const a = await h.partner('Leave', 'NEXORA-SET005');
    const request = await h.rpc(a, 'request_my_partner_account_deactivation', ['Moving cities']);
    assert.equal(request.status, 'pending');
    await assert.rejects(
      h.rpc(a, 'request_my_partner_account_deactivation', ['changed my mind']),
      /already pending/
    );
    const overview = await h.rpc(a, 'get_my_partner_security_overview');
    assert.equal(overview.deactivation.status, 'pending');
    assert.equal(overview.deactivation.reason, 'Moving cities');
    // Long reasons are truncated, not refused.
    await h.rpc(a, 'cancel_my_partner_account_deactivation');
    const refiled = await h.rpc(a, 'request_my_partner_account_deactivation', ['x'.repeat(600)]);
    assert.equal(refiled.status, 'pending');
    const second = await h.local.ownerQuery(
      "select length(reason) as n from partner_deactivation_requests where partner_id = (select id from growth_partners where user_id = $1) and status = 'pending'",
      [a]
    );
    assert.equal(second.rows[0].n, 500);
    await h.rpc(a, 'cancel_my_partner_account_deactivation');
    await assert.rejects(h.rpc(a, 'cancel_my_partner_account_deactivation'), /No pending deactivation request/);
    const cancelled = await h.rpc(a, 'get_my_partner_security_overview');
    assert.equal(cancelled.deactivation, null);
    const events = cancelled.events.map((event: any) => event.event_type);
    assert.ok(events.includes('deactivation_requested'));
    assert.ok(events.includes('deactivation_cancelled'));
    // The partner's account itself is untouched by the request flow.
    const active = await h.local.ownerQuery('select is_active from growth_partners where user_id = $1', [a]);
    assert.equal(active.rows[0].is_active, true);
  } finally {
    await h.local.close();
  }
});

test('security RPCs and tables are partner-only, own-row only', async () => {
  const h = await harness();
  try {
    const a = await h.partner('Scoped', 'NEXORA-SET006');
    await h.rpc(a, 'set_my_partner_two_factor', [true, 'factor-1']);
    await h.user('Visitor');
    const nonPartner = await h.user('Plain');
    // A signed-in non-partner gets the active-partner refusal.
    await assert.rejects(h.rpc(nonPartner, 'get_my_partner_security_overview'), /Active Growth Partner required/);
    await assert.rejects(h.rpc(nonPartner, 'save_my_partner_account_settings', [{ city: 'x' }]), /Active Growth Partner required/);
    await assert.rejects(h.rpc(nonPartner, 'request_my_partner_account_deactivation', [null]), /Active Growth Partner required/);
    // Anonymous callers have no execute grant at all.
    await assert.rejects(h.rpc(null, 'get_my_partner_security_overview'), /permission denied/);
    await assert.rejects(h.rpc(null, 'save_my_partner_account_settings', [{}]), /permission denied/);
    // RLS keeps another partner's events invisible even with direct table access.
    const b = await h.partner('Peer', 'NEXORA-SET007');
    const rows = await h.local.asRequest({ sub: b, isAdmin: false }, async (conn) =>
      (await conn.query('select partner_id from partner_security_events')).rows
    );
    assert.deepEqual(rows, [], 'no cross-partner security rows leak through RLS');
    const ownRows = await h.local.asRequest({ sub: a, isAdmin: false }, async (conn) =>
      (await conn.query('select partner_id from partner_security_events')).rows
    );
    assert.ok(ownRows.length >= 1);
    assert.ok(ownRows.every((row: any) => row.partner_id !== b));
  } finally {
    await h.local.close();
  }
});
