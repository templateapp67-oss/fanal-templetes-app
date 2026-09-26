import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSignup } from '../src/onboarding/lib/flow';
import { captureReferralIntentFromLocation } from '../src/onboarding/lib/referralPersistence';
import { resolveGrowthPartnerGate } from '../src/lib/growthPartner';
import { buildTemplateHandoffUrl, exchangeTemplateHandoff } from '../src/onboarding/lib/handoff';
import { signUpWithEmail } from '../src/onboarding/lib/auth';

const input = { fullName: 'Fresh Owner', email: 'fresh@example.com', phone: '', password: 'secret6', confirm: 'secret6' };
test('valid referral is normalized and signup submits the current password and attribution token', async () => {
  const code = captureReferralIntentFromLocation('?ref=%20nexora-orchid47%20');
  assert.equal(code, 'NEXORA-ORCHID47');
  let payload: any;
  const client: any = { auth: { signUp: async (value: any) => { payload = value; return { data: { user: { id: 'owner-a', email: input.email, identities: [{ id: 'new' }] }, session: { access_token: 'unused' } }, error: null }; } } };
  const result = await signUpWithEmail(client, { ...input, attributionToken: 'a'.repeat(64) });
  assert.equal(payload.password, 'secret6');
  assert.equal(payload.options.data.growth_referral_token, 'a'.repeat(64));
  assert.equal(result.confirmationRequired, false);
  assert.equal(validateSignup(input).ok, true);
});
test('invalid referral is not persisted as a valid code', () => {
  assert.equal(captureReferralIntentFromLocation('?ref=bad%20code'), '');
});
test('autofilled password DOM value validates, stale React value does not replace it', () => {
  assert.equal(validateSignup({ ...input, password: 'autofilled7', confirm: 'autofilled7' }).ok, true);
  assert.equal(validateSignup({ ...input, password: '', confirm: 'autofilled7' }).ok, false);
});
test('handoff carries the relationship returned by the server, not an invented partner role', async () => {
  assert.match(buildTemplateHandoffUrl('https://example.com', 'opaque', 'state'), /token=opaque&state=state/);
  const result = await exchangeTemplateHandoff({ rpc: async () => ({ data: { user_id: 'owner-a', referral_code: 'NEXORA-ORCHID47', onboarding_status: 'template_started' }, error: null }) } as any, 'opaque');
  assert.equal(result.referralCode, 'NEXORA-ORCHID47');
  assert.equal(result.userId, 'owner-a');
});
test('referred normal user denied, only own approved active partner admitted', () => {
  const base = { userId: 'owner-a', loading: false, isMockMode: false, loadError: null };
  assert.equal(resolveGrowthPartnerGate({ ...base, partnerRow: null }), 'unauthorized');
  const partner = { user_id: 'owner-a', status: 'approved', is_active: true, referral_code: 'NEXORA-PARTNER', created_at: '', updated_at: '' };
  assert.equal(resolveGrowthPartnerGate({ ...base, partnerRow: partner }), 'ready');
  assert.equal(resolveGrowthPartnerGate({ ...base, partnerRow: { ...partner, user_id: 'owner-b' } }), 'unauthorized');
  assert.equal(resolveGrowthPartnerGate({ ...base, partnerRow: { ...partner, status: 'active' } }), 'unauthorized');
  assert.equal(resolveGrowthPartnerGate({ ...base, partnerRow: { ...partner, is_active: false } }), 'inactive');
});
