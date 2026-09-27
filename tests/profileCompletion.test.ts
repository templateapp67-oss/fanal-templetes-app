import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPartnerProfileComplete,
  isSalonProfileComplete,
  isProfileComplete,
  getSalonProfileCompletion,
} from '../src/lib/profileCompletion.ts';

const savedPartner = {
  name: 'User',
  whatsapp: '+919845077654',
  postal: '560038',
  city: 'Bengaluru',
  area: 'Locality',
  avatar: 'https://example.com/avatar.webp',
  dob: '1992-06-15',
};

test('saved DOB and avatar complete the partner profile after reload', () => {
  assert.equal(isPartnerProfileComplete(JSON.parse(JSON.stringify(savedPartner))), true);
});

test('missing private or shared fields never suppress first-time completion', () => {
  for (const key of Object.keys(savedPartner)) {
    assert.equal(isPartnerProfileComplete({ ...savedPartner, [key]: '' }), false);
  }
  assert.equal(isPartnerProfileComplete(null), false);
});

test('salon profile completion strict gatekeeper checks mandatory fields', () => {
  const completeSalon = {
    businessName: 'Miraki Luxury Hair Lounge',
    phone: '9845077654',
    businessType: 'hair_salon',
    address: '104, 100ft Road, Indiranagar',
    city: 'Bengaluru',
    ownerName: 'Priya Sharma',
    tagline: 'Artistry in every snip',
    email: 'priya@miraki.com',
  };

  assert.equal(isSalonProfileComplete(completeSalon as any), true);
  assert.equal(isProfileComplete(completeSalon as any), true);

  const metric = getSalonProfileCompletion(completeSalon as any);
  assert.equal(metric.isComplete, true);
  assert.equal(metric.percentage, 100);
  assert.equal(metric.mandatoryMissing.length, 0);

  // Missing mandatory field: salon name
  assert.equal(isSalonProfileComplete({ ...completeSalon, businessName: '' } as any), false);
  const nameMissing = getSalonProfileCompletion({ ...completeSalon, businessName: '' } as any);
  assert.equal(nameMissing.isComplete, false);
  assert.ok(nameMissing.mandatoryMissing.includes('Salon Name'));

  // Missing mandatory field: phone
  assert.equal(isSalonProfileComplete({ ...completeSalon, phone: '' } as any), false);

  // Missing mandatory field: address
  assert.equal(isSalonProfileComplete({ ...completeSalon, address: '' } as any), false);

  // Missing mandatory field: city
  assert.equal(isSalonProfileComplete({ ...completeSalon, city: '' } as any), false);

  // Partial non-mandatory (tagline empty) still passes isComplete if mandatory are present
  const partial = { ...completeSalon, tagline: '' };
  assert.equal(isSalonProfileComplete(partial as any), true);
  const partialMetric = getSalonProfileCompletion(partial as any);
  assert.equal(partialMetric.isComplete, true);
  assert.ok(partialMetric.percentage < 100);
  assert.ok(partialMetric.missingFields.includes('Tagline'));
});
