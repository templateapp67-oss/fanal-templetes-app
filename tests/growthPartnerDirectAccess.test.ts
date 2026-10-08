import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/20260922091000_direct_growth_partner_dashboard_access.sql', import.meta.url),
  'utf8'
);

test('direct dashboard enrollment provisions auth.uid only', () => {
  assert.match(migration, /actor uuid := auth\.uid\(\)/);
  assert.match(migration, /provision_growth_partner\(actor\)/);
  assert.doesNotMatch(migration, /p_user_id/);
  assert.match(migration, /grant execute[\s\S]*to authenticated/);
});

test('direct enrollment never reactivates an existing suspended partner', () => {
  assert.match(migration, /if existing\.user_id is not null then/);
  assert.match(migration, /'is_active', existing\.is_active/);
});

for (const source of [
  '../src/components/GrowthPartnerLogin.tsx',
  '../src/components/PartnerPortalLogin.tsx',
  '../src/components/GrowthPartnerPage.tsx',
]) {
  test(`${source} retains a guarded enrollment or application path`, () => {
    const code = readFileSync(new URL(source, import.meta.url), 'utf8');
    if (source.endsWith('GrowthPartnerPage.tsx')) {
      assert.match(code, /<PartnerRouteGuard/);
      assert.match(code, /onApply=\{\(\) => navigate\?\.\(loginRoute\)\}/);
    } else {
      assert.match(code, /await \(client\?\.ensurePartnerRow \?\? ensureMyGrowthPartner\)\(\)/);
    }
  });
}
