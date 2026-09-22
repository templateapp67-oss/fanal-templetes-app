import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { PartnerPortalUnauthorized } from '../src/components/PartnerPortalLogin.js';
import { submitGrowthPartnerApplication, type GrowthPartnerAuthClient } from '../src/lib/growthPartnerLogin.js';

test('prospective partners see an application CTA instead of a hard lock', () => {
  const html = renderToStaticMarkup(React.createElement(PartnerPortalUnauthorized, {
    onApply: () => {},
    onSwitchAccount: () => {},
  }));
  assert.match(html, /Become a Growth Partner/);
  assert.match(html, /Sign in with a different account/);
});

test('an authenticated existing user can submit the secure partner application RPC', async () => {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const client: GrowthPartnerAuthClient = {
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
      getSession: async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null }),
    },
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: { status: 'pending' }, error: null };
    },
  };

  await submitGrowthPartnerApplication(client, {
    fullName: 'Asha Sharma',
    phone: '9876543210',
    kycDocumentType: 'pan',
    kycDocumentReference: 'ABCDE1234F',
  });

  assert.deepEqual(calls, [{
    name: 'submit_growth_partner_application',
    args: {
      p_full_name: 'Asha Sharma',
      p_phone: '9876543210',
      p_kyc_document_type: 'pan',
      p_kyc_document_reference: 'ABCDE1234F',
    },
  }]);
});

test('open-enrollment migration provisions only the authenticated caller and removes manual approval', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20260922085236_enable_growth_partner_open_enrollment.sql', import.meta.url), 'utf8');
  assert.match(migration, /actor uuid := auth\.uid\(\)/);
  assert.match(migration, /provision_growth_partner\(actor\)/);
  assert.doesNotMatch(migration, /p_user_id/);
  assert.match(migration, /status = 'approved'/);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon/);
  assert.match(migration, /grant execute on function[\s\S]*to authenticated/);
});

test('both portal and owner-dashboard partner entry render open enrollment for unauthorized users', () => {
  const page = readFileSync(new URL('../src/components/GrowthPartnerPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /if \(gate === 'unauthorized'\)/);
  assert.doesNotMatch(page, /isPartnerNamespace && gate === 'unauthorized'/);
});

test('Vercel routing middleware has the required default export', () => {
  const middleware = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
  assert.match(middleware, /export default function middleware/);
});
