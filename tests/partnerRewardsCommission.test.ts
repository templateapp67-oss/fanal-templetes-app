import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/20261008_correct_growth_partner_commission_share.sql', import.meta.url),
  'utf8'
);
const component = readFileSync(
  new URL('../src/components/PartnerRewardsCommission.tsx', import.meta.url),
  'utf8'
);

test('partner commission is 10% of company commission, not 10% of QR business', () => {
  assert.match(migration, /floor\(floor\(sum\(q\.eligible_amount_paise\)\*0\.10\)\*0\.10\)/);
  assert.match(migration, /daily_qr_transaction_paise',100000/);
  assert.match(migration, /daily_company_commission_paise',10000/);
  assert.match(migration, /daily_growth_partner_commission_paise',1000/);
  assert.match(migration, /cycle_growth_partner_commission_paise',15000/);
});

test('commission dashboard explains both commission levels without ambiguity', () => {
  assert.match(component, /₹1,000 genuine daily QR business/);
  assert.match(component, /₹100 company commission/);
  assert.match(component, /₹10 Growth Partner commission/);
  assert.match(component, /₹10 partner commission × 15 consecutive qualifying days = ₹150 per shop/);
  assert.match(component, /growth_partner_commission_paise/);
  assert.doesNotMatch(component, /यह company commission ledger है, partner cash-income promise नहीं/);
});

test('partner commission RPC remains caller-scoped and refresh remains trusted-only', () => {
  assert.match(migration, /where user_id=auth\.uid\(\) and is_active and status='approved'/);
  assert.match(migration, /where d\.growth_partner_id=v_gp_id/);
  assert.match(migration, /if not private\.is_trusted_server_or_admin\(\)/);
  assert.match(migration, /revoke all on function public\.refresh_partner_shop_reward_qualification\(uuid\) from public,anon,authenticated/);
});
