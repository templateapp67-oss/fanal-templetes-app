import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Growth Partner referral UI has one database-backed source and no UUID-derived fallback', () => {
  const hook = read('src/lib/hooks/useReferralCode.ts');
  const page = read('src/components/GrowthPartnerPage.tsx');
  const sections = read('src/components/GrowthPartnerSections.tsx');
  const portal = read('src/components/PartnerPortalSections.tsx');
  const server = read('server.ts');
  const migration = read('supabase/migrations/20261011000000_growth_partner_referral_source.sql');

  assert.match(hook, /rpc\('get_my_referral_code'\)/);
  assert.match(hook, /code:\s*string\s*\|\s*null/);
  assert.doesNotMatch(hook, /user\.id\.(?:substring|slice|substr)|REF-\$\{.*user|NEXORA-\$\{.*user/i);

  assert.match(page, /useReferralCode\(\)/);
  assert.match(page, /code=\{referralCode\}/);
  assert.match(page, /referralCode=\{referralCode\}/);
  assert.doesNotMatch(page, /user\.id\.(?:substring|slice|substr)/);

  assert.match(sections, /ReferralCodeCard code=\{canonicalReferralCode\}/);
  assert.match(portal, /partnerReferralShareLink\(value, origin\)/);
  assert.match(portal, /Join using my referral code \$\{value\}/);

  assert.doesNotMatch(
    server,
    /referral_code:\s*['"]MOCK['"]\s*\+\s*userId\.(?:substring|slice|substr)/i
  );

  assert.match(migration, /create or replace function public\.get_my_referral_code\(\)/i);
  assert.match(migration, /from public\.growth_partners gp/i);
  assert.match(migration, /gp\.user_id = \(select auth\.uid\(\)\)/i);
  assert.doesNotMatch(
    migration,
    /generated_referral\s*:=\s*['"]REF-['"].*caller::text|v_code\s*:=.*p_user_id::text/is
  );
});
