import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supabase } from '../src/lib/supabaseClient';
import {
  validateGrowthReferralCode, linkMyGrowthReferral, getMyGrowthReferral,
  getMyOnboardingStatus, updateMyOnboardingProgress, fetchMyGrowthPartnerRow,
  ensureMyGrowthPartner, approveDemoGrowthPartnerAccount, fetchMyPartnerDashboard,
  fetchMyPartnerReferrals, fetchMyPartnerPerformance, fetchMyPartnerReferralDetail,
  resolveGrowthPartnerGate,
} from '../src/lib/growthPartner';
import { fetchGrowthPartnerProfile, fetchPartnerAccountSettings, savePartnerAccountSettings } from '../src/lib/growthPartnerProfile';

test('failed partner RPCs never become fabricated approval, referrals, progress or earnings', async (t) => {
  const failure = { code: 'PGRST202', message: 'Function missing from schema cache' };
  t.mock.method(supabase, 'rpc', () => Promise.resolve({ data: null, error: failure }));
  for (const operation of [
    () => validateGrowthReferralCode('NEXORA-ABC123'),
    () => linkMyGrowthReferral('NEXORA-ABC123'), getMyGrowthReferral, getMyOnboardingStatus,
    () => updateMyOnboardingProgress('complete_template'), fetchMyGrowthPartnerRow,
    ensureMyGrowthPartner, approveDemoGrowthPartnerAccount, fetchMyPartnerDashboard,
    () => fetchMyPartnerReferrals(), fetchMyPartnerPerformance,
    () => fetchMyPartnerReferralDetail('foreign-referral'),
  ]) {
    await assert.rejects(operation, (error: any) => error.code === failure.code);
  }
  assert.equal(resolveGrowthPartnerGate({ userId: 'user', loading: false, isMockMode: false,
    partnerRow: null, loadError: failure }), 'error');
});

test('profile and settings read/write failures never report stored values', async () => {
  for (const result of [{ data: null, error: { message: 'permission denied', code: '42501' } }, { data: null, error: null }]) {
    const client: any = { rpc: async () => result };
    await assert.rejects(fetchGrowthPartnerProfile(client));
    await assert.rejects(fetchPartnerAccountSettings(client));
    await assert.rejects(savePartnerAccountSettings({ agency_name: 'Not saved' }, client));
  }
});
