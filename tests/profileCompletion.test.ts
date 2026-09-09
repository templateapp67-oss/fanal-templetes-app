import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPartnerProfileComplete } from '../src/lib/profileCompletion';
const saved = { name: 'User', whatsapp: '+919845077654', postal: '560038', city: 'Bengaluru', area: 'Locality', avatar: 'https://example.com/avatar.webp', dob: '1992-06-15' };
test('saved DOB and avatar complete the profile after reload', () => {
  assert.equal(isPartnerProfileComplete(JSON.parse(JSON.stringify(saved))), true);
});
test('missing private or shared fields never suppress first-time completion', () => {
  for (const key of Object.keys(saved)) assert.equal(isPartnerProfileComplete({ ...saved, [key]: '' }), false);
  assert.equal(isPartnerProfileComplete(null), false);
});
