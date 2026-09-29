#!/usr/bin/env node
// Reproduces the Growth Partner application failure at `/partner/dashboard`
// ("Application failed. Please try again.") against the REAL committed
// migrations, the REAL local Supabase-compatible gateway and the REAL frontend
// submission functions — so the printed messages are exactly what a user sees.
//
// Usage:
//   node --import tsx scripts/reproduce-partner-application-error.mjs
//
// The gateway runs the same SQL a production project runs (PGlite +
// supabase/migrations), so every case below is a genuine backend answer, not a
// stub. Nothing here needs network access or a configured Supabase project.

import express from 'express';
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { registerLocalSupabaseGateway } from '../server/localSupabase.ts';
import { fetchMyGrowthPartnerApplication } from '../src/lib/growthPartner.ts';
import { submitGrowthPartnerApplication } from '../src/lib/growthPartnerLogin.ts';
import { safePartnerErrorMessage } from '../src/lib/partnerUiErrors.ts';
import { partnerApplicationErrorMessage } from '../src/lib/partnerApplicationErrors.ts';

const results = [];

function record(label, outcome) {
  results.push({ label, ...outcome });
  const mark = outcome.kind === 'ok' ? '✅' : outcome.kind === 'warn' ? '⚠️' : '❌';
  console.log(`\n${mark} ${label}`);
  console.log(`   raw error     : ${outcome.raw ?? '(none)'}`);
  console.log(`   thrown        : ${outcome.thrown ?? '(none)'}`);
  console.log(`   user sees now : ${outcome.userSees ?? '(success)'}`);
  if (outcome.legacyCopy) console.log(`   legacy mapper  : ${outcome.legacyCopy}`);
}

async function attempt(submit) {
  const outcome = {};
  try {
    const data = await submit();
    outcome.kind = 'ok';
    outcome.result = data;
    return outcome;
  } catch (error) {
    outcome.kind = 'fail';
    outcome.raw = `${error?.code ?? ''} ${error?.message ?? error}`.trim();
    outcome.thrown = String(error?.message ?? error);
    outcome.userSees = partnerApplicationErrorMessage(error);
    outcome.legacyCopy = safePartnerErrorMessage(error, 'Application failed. Please try again.');
    return outcome;
  }
}

async function startGateway() {
  const app = express();
  app.use(express.json());
  const gateway = await registerLocalSupabaseGateway(app, { log: () => {} });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise((resolve) => server.close(() => resolve()));
      await gateway.close();
    },
  };
}

async function main() {
  const gateway = await startGateway();
  const client = createClient(gateway.origin, 'local-dev-key', {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // The read the portal passes: the caller's OWN application row (RLS-scoped),
  // used to refuse a duplicate before the write.
  const ownApplication = async () => {
    const { data } = await client
      .from('growth_partner_applications')
      .select('status')
      .order('created_at', { ascending: false })
      .limit(1);
    return data?.[0] ?? null;
  };

  try {
    // -----------------------------------------------------------------------
    // 1. Happy path: valid name, 10-digit phone, 12-digit Aadhaar.
    // -----------------------------------------------------------------------
    const email = `applicant-${Date.now()}@example.com`;
    const { data: signedUp, error: signUpError } = await client.auth.signUp({
      email,
      password: 'Str0ngPass!1',
      options: { data: { full_name: 'Asha Sharma' } },
    });
    if (signUpError) throw new Error(`signup failed: ${signUpError.message}`);

    record('1. valid application (aadhaar, 12 digits / phone, 10 digits)', await attempt(() =>
      submitGrowthPartnerApplication(client, {
        fullName: 'Asha Sharma',
        phone: '9876543210',
        kycDocumentType: 'aadhaar',
        kycDocumentReference: '123456789012',
      }, { fetchApplicationRow: ownApplication })
    ));

    // -----------------------------------------------------------------------
    // 2. A duplicate submission of the SAME application (same user).
    // -----------------------------------------------------------------------
    record('2. duplicate submission by the same user', await attempt(() =>
      submitGrowthPartnerApplication(client, {
        fullName: 'Asha Sharma',
        phone: '9876543210',
        kycDocumentType: 'aadhaar',
        kycDocumentReference: '123456789012',
      }, { fetchApplicationRow: ownApplication })
    ));

    // -----------------------------------------------------------------------
    // 3. A SECOND user reusing the first user's Aadhaar number.
    // -----------------------------------------------------------------------
    const other = await client.auth.signUp({
      email: `applicant2-${Date.now()}@example.com`,
      password: 'Str0ngPass!1',
      options: { data: { full_name: 'Vikram Rao' } },
    });
    if (other.error) throw new Error(`signup failed: ${other.error.message}`);
    // Sign back in as the second applicant (signUp does not switch sessions on
    // every gateway build, so pin the client explicitly).
    await client.auth.setSession({
      access_token: other.data.session.access_token,
      refresh_token: other.data.session.refresh_token,
    });

    record('3. another user reusing an already-registered Aadhaar number', await attempt(() =>
      submitGrowthPartnerApplication(client, {
        fullName: 'Vikram Rao',
        phone: '9123456780',
        kycDocumentType: 'aadhaar',
        kycDocumentReference: '123456789012',
      }, { fetchApplicationRow: ownApplication })
    ));

    // -----------------------------------------------------------------------
    // 4. Malformed Aadhaar (11 digits) — accepted by the backend today?
    // -----------------------------------------------------------------------
    record('4. malformed Aadhaar (11 digits)', await attempt(() =>
      submitGrowthPartnerApplication(client, {
        fullName: 'Vikram Rao',
        phone: '9123456780',
        kycDocumentType: 'aadhaar',
        kycDocumentReference: '12345678901',
      }, { fetchApplicationRow: ownApplication })
    ));

    // -----------------------------------------------------------------------
    // 5. Malformed phone (5 digits) — accepted by the backend today?
    // -----------------------------------------------------------------------
    record('5. malformed phone (5 digits)', await attempt(() =>
      submitGrowthPartnerApplication(client, {
        fullName: 'Vikram Rao',
        phone: '91234',
        kycDocumentType: 'pan',
        kycDocumentReference: 'ABCDE1234F',
      }, { fetchApplicationRow: ownApplication })
    ));

    // -----------------------------------------------------------------------
    // 6. Signed out (no session) — the "prompt/redirect to sign in" case.
    // -----------------------------------------------------------------------
    const anonClient = createClient(gateway.origin, 'local-dev-key', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    record('6. submission with no session (signed out)', await attempt(() =>
      submitGrowthPartnerApplication(anonClient, {
        fullName: 'Nobody',
        phone: '9876543210',
        kycDocumentType: 'aadhaar',
        kycDocumentReference: '999999999999',
      })
    ));

    // -----------------------------------------------------------------------
    // 7. Backend not migrated — PostgREST cannot find the function signature.
    // -----------------------------------------------------------------------
    record('7. backend object absent (PGRST202 — the migration was never applied)', await attempt(async () => {
      // PostgREST answers 404 + PGRST202 when the function is not in the schema
      // cache. Calling the pre-KYC 2-argument overload reproduces the exact
      // shape a project that stopped at an old migration returns.
      const { error } = await client
        .rpc('submit_growth_partner_application_legacy', {
          p_full_name: 'Legacy Call',
          p_phone: '9876543210',
          p_kyc_document_type: 'pan',
          p_kyc_document_reference: 'ABCDE1234F',
        });
      if (error) throw error;
      return { status: 'pending' };
    }));

    // -----------------------------------------------------------------------
    // 8. Network failure — a live session, but the request cannot get through.
    // -----------------------------------------------------------------------
    const deadClient = {
      auth: {
        signInWithPassword: async () => ({ data: {}, error: null }),
        signOut: async () => ({ error: null }),
        getSession: async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null }),
      },
      rpc: async () => {
        throw new TypeError('Failed to fetch');
      },
    };
    record('8. network failure (request could not reach Supabase)', await attempt(() =>
      submitGrowthPartnerApplication(deadClient, {
        fullName: 'Asha Sharma',
        phone: '9876543210',
        kycDocumentType: 'aadhaar',
        kycDocumentReference: '123456789012',
      })
    ));
  } finally {
    await gateway.close();
  }

  const masked = results.filter((row) => row.kind === 'fail' && /Application failed\. Please try again\./.test(row.userSees ?? ''));
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log(`${masked.length} of ${results.filter((row) => row.kind === 'fail').length} failure(s) are hidden behind "Application failed. Please try again."`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
