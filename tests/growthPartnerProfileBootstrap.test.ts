import assert from 'node:assert/strict';
import test from 'node:test';
import { getOrCreateMyGrowthPartnerProfile, type GrowthPartnerProfileClient } from '../src/lib/growthPartnerProfile';

const id = 'e0000000-0000-4000-8000-000000000001';
const profile = { full_name: 'Partner', email: 'partner@example.com', phone: null, photo_path: null, partner_id: id, referral_code: 'NEXORA-TEST01', account_status: 'Active', partner_role: 'Growth Partner', approval_status: 'Active', joined_at: '2026-09-24T00:00:00Z' };

function client(rpc: GrowthPartnerProfileClient['rpc']): GrowthPartnerProfileClient {
  return { rpc, auth: { getUser: async () => ({ data: { user: { id, email: 'partner@example.com', user_metadata: { full_name: 'Partner' } } }, error: null }), updateUser: async () => ({ data: null, error: null }) }, storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) } };
}

test('profile bootstrap resolves auth before caller-owned creation RPC', async () => {
  const calls: string[] = [];
  const result = await getOrCreateMyGrowthPartnerProfile(client(async (name) => { calls.push(name); return { data: profile, error: null }; }));
  assert.equal(result.partner_id, id);
  assert.deepEqual(calls, ['get_or_create_my_growth_partner_profile']);
});

test('profile bootstrap degrades to a non-blocking display model when database RPCs are unavailable', async () => {
  const result = await getOrCreateMyGrowthPartnerProfile(client(async () => ({ data: null, error: { message: 'database unavailable' } })));
  assert.equal(result.partner_id, id);
  assert.equal(result.account_status, 'Setting up');
  assert.equal(result.referral_code, 'Generating…');
});
