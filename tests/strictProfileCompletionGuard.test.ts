import { test } from 'node:test';
import assert from 'node:assert/strict';
import { websiteDatabase, actor, other, salon } from './helpers/websiteDatabase';
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

test('normalized database gate uses the same core profile fields; saves remain isolated', async () => {
  const db = await websiteDatabase();
  const profile = { ownerId: actor, businessName: 'My Luxe Salon', phone: '+919845012345', city: 'Jaipur', businessType: 'hair_salon', subdomain: 'mine', address: 'Studio Road' };
  try {
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select public.save_owner_editor_state($1)', [JSON.stringify({ profile: { ...profile, address: '' } })]), /PROFILE_INCOMPLETE/);
    await db.query('select public.save_owner_editor_state($1)', [JSON.stringify({ profile })]);
    await db.exec('reset role');
    assert.equal((await db.query<any>('select name from salons where id=$1', [salon])).rows[0].name, 'My Luxe Salon');
    await db.exec('grant select on owner_editor_state to authenticated; create policy own_editor_read on owner_editor_state for select to authenticated using(owner_id=auth.uid())');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
    await db.exec('set role authenticated');
    assert.deepEqual((await db.query('select * from owner_editor_state where owner_id=$1', [actor])).rows, [], 'RLS hides another owner, rather than throwing on SELECT');
    await assert.rejects(db.query('select public.save_owner_editor_state($1)', [JSON.stringify({ profile })]), /another account/);
  } finally { await db.close(); }
});
