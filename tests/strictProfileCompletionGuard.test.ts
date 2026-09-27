import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLocalDatabase } from '../server/localSupabase.ts';
import {
  isSalonProfileComplete,
  isProfileComplete,
  getSalonProfileCompletion,
} from '../src/lib/profileCompletion.ts';

test('isSalonProfileComplete strictly requires all mandatory operational fields', () => {
  const completeProfile = {
    businessName: 'Luxe Hair & Nail Lounge',
    phone: '+919845012345',
    businessType: 'hair_salon',
    address: 'Plot 42, Ring Road, Jhotwara',
    city: 'Jaipur',
    ownerName: 'Sunita Meena',
    tagline: 'Premium Hair & Beauty Experience',
    email: 'sunita@luxelounge.in',
  };

  assert.equal(isSalonProfileComplete(completeProfile as any), true);
  assert.equal(isProfileComplete(completeProfile as any), true);

  const info = getSalonProfileCompletion(completeProfile as any);
  assert.equal(info.isComplete, true);
  assert.equal(info.percentage, 100);
  assert.equal(info.mandatoryMissing.length, 0);

  // Missing salon_name / businessName
  assert.equal(isSalonProfileComplete({ ...completeProfile, businessName: '' } as any), false);
  const nameMissing = getSalonProfileCompletion({ ...completeProfile, businessName: '   ' } as any);
  assert.equal(nameMissing.isComplete, false);
  assert.ok(nameMissing.mandatoryMissing.includes('Salon Name'));

  // Missing phone / phone_number
  assert.equal(isSalonProfileComplete({ ...completeProfile, phone: '' } as any), false);
  const phoneMissing = getSalonProfileCompletion({ ...completeProfile, phone: '' } as any);
  assert.equal(phoneMissing.isComplete, false);
  assert.ok(phoneMissing.mandatoryMissing.includes('Contact Number'));

  // Missing category / businessType
  assert.equal(isSalonProfileComplete({ ...completeProfile, businessType: '' } as any), false);
  const catMissing = getSalonProfileCompletion({ ...completeProfile, businessType: '' } as any);
  assert.equal(catMissing.isComplete, false);
  assert.ok(catMissing.mandatoryMissing.includes('Business Category'));

  // Missing address
  assert.equal(isSalonProfileComplete({ ...completeProfile, address: '' } as any), false);
  const addressMissing = getSalonProfileCompletion({ ...completeProfile, address: '' } as any);
  assert.equal(addressMissing.isComplete, false);
  assert.ok(addressMissing.mandatoryMissing.includes('Address'));

  // Missing city
  assert.equal(isSalonProfileComplete({ ...completeProfile, city: '' } as any), false);
  const cityMissing = getSalonProfileCompletion({ ...completeProfile, city: '' } as any);
  assert.equal(cityMissing.isComplete, false);
  assert.ok(cityMissing.mandatoryMissing.includes('City'));
});

test('getSalonProfileCompletion computes accurate percentage and missing fields list', () => {
  // Empty profile: 0%
  const empty = {};
  const emptyInfo = getSalonProfileCompletion(empty as any);
  assert.equal(emptyInfo.isComplete, false);
  assert.equal(emptyInfo.percentage, 0);
  assert.equal(emptyInfo.mandatoryMissing.length, 5);

  // Partial profile with 4 fields filled out of 8 total
  const partial = {
    businessName: 'Style Studio',
    phone: '9876543210',
    businessType: 'hair_salon',
    city: 'Jaipur',
  };
  const partialInfo = getSalonProfileCompletion(partial as any);
  assert.equal(partialInfo.isComplete, false); // missing address
  assert.equal(partialInfo.percentage, 50); // 4/8 = 50%
  assert.ok(partialInfo.mandatoryMissing.includes('Address'));
});

test('Database Profile Completion RPC & Editor save gating integration tests', async () => {
  const local = await createLocalDatabase();
  const db = local.db;

  try {
    const userA = randomUUID();
    const userB = randomUUID();

    // Setup User A & User B sessions
    await db.query(
      "insert into auth.users(id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'pw', $3::jsonb)",
      [userA, 'usera@example.com', JSON.stringify({ full_name: '' })] // Incomplete: empty name
    );

    await db.query(
      "insert into auth.users(id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'pw', $3::jsonb)",
      [userB, 'userb@example.com', JSON.stringify({ full_name: 'User B Owner' })]
    );

    // Initial check: get_my_profile_completion_status for User A
    const resA = await local.asRequest({ sub: userA, isAdmin: false }, async (conn) => {
      const r = await conn.query('select public.get_my_profile_completion_status() as result');
      return r.rows[0].result;
    });

    assert.equal(resA.isComplete, false, 'New User A with no profile details must be incomplete');
    assert.ok(resA.missingFields.includes('ownerName'), 'Should miss ownerName');

    // Attempt save_owner_editor_state as User A with incomplete state -> must fail with PROFILE_INCOMPLETE
    await assert.rejects(
      local.asRequest({ sub: userA, isAdmin: false }, conn =>
        conn.query("select public.save_owner_editor_state($1)", [
          JSON.stringify({
            profile: {
              ownerName: '',
              businessName: 'My Salon',
              phone: '9845012345',
              city: 'Mumbai',
              businessType: 'hair_salon'
            }
          })
        ])
      ),
      /PROFILE_INCOMPLETE|Please complete your profile/i,
      'Should reject incomplete state with PROFILE_INCOMPLETE'
    );

    // Complete profile for User A (profiles + ensure_owner_workspace)
    await db.query(
      "insert into public.profiles(id, full_name, city, phone) values ($1, $2, $3, $4) on conflict(id) do update set full_name = excluded.full_name, city = excluded.city, phone = excluded.phone",
      [userA, 'User A Owner', 'Mumbai', '+919845012345']
    );

    // Run ensure_owner_workspace to provision salon
    const workspace = await local.asRequest({ sub: userA, isAdmin: false }, async (conn) => {
      const r = await conn.query('select public.ensure_owner_workspace() as result');
      return r.rows[0].result;
    });

    assert.ok(workspace.salon_id, 'Should provision a salon ID');

    // Check status again
    const resA2 = await local.asRequest({ sub: userA, isAdmin: false }, async (conn) => {
      const r = await conn.query('select public.get_my_profile_completion_status() as result');
      return r.rows[0].result;
    });
    console.log('RESA2 RESULT:', JSON.stringify(resA2, null, 2));
    assert.equal(resA2.isComplete, true, 'User A should now be complete: ' + JSON.stringify(resA2));

    // Save should succeed now
    await local.asRequest({ sub: userA, isAdmin: false }, async (conn) => {
      await conn.query("select public.save_owner_editor_state($1)", [
        JSON.stringify({
          profile: {
            ownerName: 'User A Owner',
            businessName: 'My Luxe Salon',
            phone: '+919845012345',
            city: 'Mumbai',
            businessType: 'hair_salon',
            subdomain: 'my-luxe-salon'
          }
        })
      ]);
    });

    // Check if details are auto-synchronized to the salons table
    const salonRow = (await db.query("select * from public.salons where id = $1", [workspace.salon_id])).rows[0];
    assert.equal(salonRow.name, 'My Luxe Salon', 'Salon name should be auto-synced to My Luxe Salon');

    // Account A cannot see or write Account B data
    await assert.rejects(
      local.asRequest({ sub: userB, isAdmin: false }, conn =>
        conn.query("select * from public.owner_editor_state where owner_id = $1", [userA])
      ),
      /row-level security|permission denied|42501/i,
      'User B cannot read User A editor state'
    );

  } finally {
    await local.close();
  }
});
