import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
