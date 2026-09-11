import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInviteUrl, inviteCode, restoreInvite } from '../src/onboarding/lib/invite';

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}
test('invite points to business signup on the same origin and round-trips the referral code', () => {
  const url = new URL(buildInviteUrl('https://example.com', 'REF-abc_123'));
  assert.equal(url.pathname, '/onboarding/signup');
  assert.equal(url.origin, 'https://example.com');
  assert.equal(inviteCode(url.search), 'REF-abc_123');
});
test('referral hint survives signup navigation and refresh but expires after one day', () => {
  const saved = storage();
  assert.equal(restoreInvite('?ref=REF-123', saved, 100), 'REF-123');
  assert.equal(restoreInvite('', saved, 200), 'REF-123');
  assert.equal(restoreInvite('', saved, 100 + 86400000), '');
});
test('new invite replaces the previous hint and invalid input is rejected', () => {
  const saved = storage();
  restoreInvite('?ref=OLD', saved, 100);
  assert.equal(restoreInvite('?ref=NEW', saved, 200), 'NEW');
  assert.equal(restoreInvite('', saved, 300), 'NEW');
  assert.equal(inviteCode('?ref=%3Cscript%3E'), '');
  assert.equal(inviteCode('?ref=' + 'A'.repeat(121)), '');
});
test('disabled storage does not break a valid incoming invite', () => {
  const unavailable = { getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } };
  assert.equal(restoreInvite('?ref=VALID', unavailable), 'VALID');
});
