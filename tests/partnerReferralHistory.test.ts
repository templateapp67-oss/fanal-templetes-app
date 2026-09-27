import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Partner Dashboard has Referral History tab tracking salons by partner_code', () => {
  const router = read('src/lib/router.ts');
  const shell = read('src/components/PartnerPortalShell.tsx');
  const page = read('src/components/GrowthPartnerPage.tsx');
  const historyComponent = read('src/components/PartnerReferralHistoryPage.tsx');
  const growthPartnerLib = read('src/lib/growthPartner.ts');
  const migration = read('supabase/migrations/20261015000000_get_my_partner_referred_salons.sql');

  // Router registration
  assert.match(router, /'referral-history'/);
  assert.match(router, /'referral-history':\s*`\${PARTNER_PORTAL_ROOT}\/referral-history`/);

  // Shell navigation
  assert.match(shell, /section:\s*'referral-history',\s*label:\s*'Referral History'/);
  assert.match(shell, /'referral-history':\s*'Referral History'/);

  // GrowthPartnerPage view routing
  assert.match(page, /case\s*'referral-history':/);
  assert.match(page, /<PartnerReferralHistoryPage/);

  // History Component & RPC query
  assert.match(historyComponent, /PartnerReferralHistoryPage/);
  assert.match(historyComponent, /fetchMyPartnerReferredSalons/);
  assert.match(historyComponent, /partner_code/);
  assert.match(growthPartnerLib, /get_my_partner_referred_salons/);
  assert.match(migration, /get_my_partner_referred_salons/);
});
