import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalDatabase } from '../server/localSupabase.ts';
import { resolveGrowthPartnerGate } from '../src/lib/growthPartner.ts';

test('Normal referred user is strictly denied access to Growth Partner dashboard, analytics and rewards', async () => {
  const local = await createLocalDatabase();
  const db = local.db;

  try {
    const partnerId = randomUUID();
    const refCode = 'NEXORA-DENYTEST25';
    const normalReferredUserId = randomUUID();

    // 1. Provision Growth Partner
    await db.query(
      "insert into auth.users(id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'partner-pw', $3::jsonb)",
      [partnerId, 'legit.partner@example.com', JSON.stringify({ full_name: 'Legit Partner' })]
    );
    await db.query("select public.provision_growth_partner($1, $2)", [partnerId, refCode]);

    // 2. Capture referral attribution token
    const attribution = (
      await local.asRequest({ sub: null, isAdmin: false }, async (conn) =>
        (await conn.query('select public.capture_growth_referral($1, $2) as result', [refCode, null])).rows[0].result
      )
    );
    assert.equal(attribution.valid, true);

    // 3. Provision Normal Referred User via attribution token
    await db.query(
      "insert into auth.users(id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'user-pw', $3::jsonb)",
      [
        normalReferredUserId,
        'normal.referred.user@example.com',
        JSON.stringify({
          full_name: 'Normal Referred Salon Owner',
          growth_referral_token: attribution.token,
        }),
      ]
    );

    // Verify normal user does NOT have a row in public.growth_partners
    const partnerCheck = (
      await db.query('select * from public.growth_partners where user_id = $1', [normalReferredUserId])
    ).rows;
    assert.equal(partnerCheck.length, 0, 'Normal referred user must NOT have a row in growth_partners');

    // 4. Test RPCs as normalReferredUserId
    // a. get_my_referral_code RPC returns null
    const refCodeResult = (
      await local.asRequest({ sub: normalReferredUserId, isAdmin: false }, async (conn) =>
        (await conn.query('select public.get_my_referral_code() as code')).rows[0]
      )
    );
    assert.equal(refCodeResult.code, null, 'Normal user calling get_my_referral_code must receive null');

    // b. get_my_growth_partner RPC returns null
    const partnerRowResult = (
      await local.asRequest({ sub: normalReferredUserId, isAdmin: false }, async (conn) =>
        (await conn.query('select public.get_my_growth_partner() as row')).rows[0]
      )
    );
    assert.equal(partnerRowResult.row, null, 'Normal user calling get_my_growth_partner must receive null');

    // c. get_my_partner_dashboard RPC rejects normal user
    await assert.rejects(
      local.asRequest({ sub: normalReferredUserId, isAdmin: false }, conn =>
        conn.query('select public.get_my_partner_dashboard()')
      ),
      /Growth Partner access required|Growth Partner.*not found|Access denied|unauthorized|42501/i,
      'Normal user cannot query get_my_partner_dashboard'
    );

    // d. get_my_partner_referrals RPC rejects normal user
    await assert.rejects(
      local.asRequest({ sub: normalReferredUserId, isAdmin: false }, conn =>
        conn.query("select public.get_my_partner_referrals('all', null, 50, 0)")
      ),
      /Growth Partner access required|Growth Partner.*not found|Access denied|unauthorized|42501/i,
      'Normal user cannot query get_my_partner_referrals'
    );

    // 5. Test Direct RLS Queries as normalReferredUserId
    // a. Selecting from growth_partners yields 0 rows
    const directPartnersSelect = (
      await local.asRequest({ sub: normalReferredUserId, isAdmin: false }, async (conn) =>
        (await conn.query('select * from public.growth_partners')).rows
      )
    );
    assert.equal(directPartnersSelect.length, 0, 'RLS must prevent normal user from reading growth_partners table');

    // 6. Test UI Gate Resolution
    const normalUserGateInput = {
      userId: normalReferredUserId,
      loading: false,
      isMockMode: false,
      partnerRow: null,
      loadError: null,
      applicationStatus: null,
    };

    const gate = resolveGrowthPartnerGate(normalUserGateInput);
    assert.equal(gate, 'unauthorized', 'Normal referred user must resolve gate to unauthorized');
  } finally {
    await local.close();
  }
});
