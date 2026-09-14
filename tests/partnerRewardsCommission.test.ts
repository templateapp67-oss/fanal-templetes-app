import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/20261009_one_time_extra_onboarding_reward.sql', import.meta.url),
  'utf8'
);
const component = readFileSync(
  new URL('../src/components/PartnerRewardsCommission.tsx', import.meta.url),
  'utf8'
);

test('extra onboarding reward is one-time per newly qualifying shop', () => {
  assert.match(migration, /unique \(shop_attribution_id\)/);
  assert.match(migration, /programme_type','one_time_extra_onboarding_reward_per_qualifying_shop'/);
  assert.match(migration, /'is_main_commission',false/);
  assert.match(migration, /'is_recurring',false/);
  assert.match(migration, /on conflict \(shop_attribution_id\) do nothing/);
});

test('first valid 15-day cycle is locked and has no upper reward cap', () => {
  assert.match(migration, /having count\(\*\)>=15/);
  assert.match(migration, /between w\.start_date and w\.start_date\+14/);
  assert.match(migration, /check \(onboarding_reward_paise = floor\(company_commission_paise \* 0\.10\)::bigint\)/);
  assert.match(migration, /floor\(150000::numeric\*0\.10\)<>15000/);
  assert.match(migration, /floor\(500000::numeric\*0\.10\)<>50000/);
  assert.doesNotMatch(migration, /maximum_onboarding_reward|reward_cap/);
});

test('dashboard explains minimum and higher-collection examples clearly', () => {
  assert.match(component, /main या recurring commission नहीं है/);
  assert.match(component, /हर नई shop/);
  assert.match(component, /₹15,000 QR → ₹1,500 company → ₹150 reward/);
  assert.match(component, /₹50,000 QR → ₹5,000 company → ₹500 reward/);
  assert.match(component, /No maximum limit/);
  assert.match(component, /get_my_partner_onboarding_rewards/);
});

test('reward RPC is caller-scoped and calculation refresh is trusted-only', () => {
  assert.match(migration, /where user_id=auth\.uid\(\) and is_active and status='approved'/);
  assert.match(migration, /where r\.growth_partner_id=v_gp_id/);
  assert.match(migration, /if not private\.is_trusted_server_or_admin\(\)/);
  assert.match(migration, /revoke all on function public\.refresh_partner_shop_reward_qualification\(uuid\) from public,anon,authenticated/);
});
