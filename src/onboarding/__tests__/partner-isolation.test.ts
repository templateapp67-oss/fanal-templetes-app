import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createLocalDatabase } from '../../../server/localSupabase.ts';
import { registerPartnerPortalRoutes } from '../../../server/partnerPortalRoutes.ts';
import { resolveGrowthPartnerGate } from '../../lib/growthPartner.ts';

test('Normal user requests to partner-specific API routes return PARTNER_ACCESS_REQUIRED error', async () => {
  const local = await createLocalDatabase();
  const db = local.db;

  try {
    const normalUserId = randomUUID();
    const partnerUserId = randomUUID();

    // Provision normal user (no partner role)
    await db.query(
      "insert into auth.users(id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'password123', $3::jsonb)",
      [normalUserId, 'normaluser@example.com', JSON.stringify({ full_name: 'Normal Salon Owner' })]
    );

    // Provision partner user
    await db.query(
      "insert into auth.users(id, email, encrypted_password, raw_user_meta_data) values ($1, $2, 'password123', $3::jsonb)",
      [partnerUserId, 'partneruser@example.com', JSON.stringify({ full_name: 'Approved Partner' })]
    );
    await db.query("select public.provision_growth_partner($1, 'NEXORA-PORTAL25')", [partnerUserId]);

    // Setup Express server with partnerPortalRoutes
    const app = express();
    app.use(express.json());

    // Mock db client with auth.getUser that looks up token/id
    const mockDb = {
      auth: {
        getUser: async (token: string) => {
          return { data: { user: { id: token } }, error: null };
        },
      },
    };

    registerPartnerPortalRoutes(app, {
      db: mockDb,
      isMock: false,
      callRpc: async (token, fn, args) => {
        return local.asRequest({ sub: token, isAdmin: false }, async (conn) => {
          try {
            let sql = `select public.${fn}() as data`;
            if (fn === 'get_my_partner_earnings' || fn === 'get_my_partner_payout_requests' || fn === 'get_my_partner_onboarding_rewards') {
              const limit = (args as any)?.p_limit ?? (args as any)?.limit ?? 25;
              const offset = (args as any)?.p_offset ?? (args as any)?.offset ?? 0;
              sql = `select public.${fn}(${Number(limit)}, ${Number(offset)}) as data`;
            } else if (fn === 'get_my_partner_notifications') {
              const type = (args as any)?.p_type ? `'${(args as any).p_type}'` : 'null';
              const limit = (args as any)?.p_limit ?? 50;
              sql = `select public.${fn}(${type}, ${Number(limit)}) as data`;
            } else if (fn === 'get_my_partner_levels') {
              sql = `select public.${fn}() as data`;
            }
            const res = await conn.query(sql);
            return { data: res.rows[0]?.data, error: null };
          } catch (err: any) {
            return { data: null, error: { code: err.code || '42501', message: err.message } };
          }
        });
      },
    });

    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // Test partner routes as authenticated normal user
      const partnerRoutes = [
        '/api/partner/earnings',
        '/api/partner/payout-requests',
        '/api/partner/levels',
        '/api/partner/notifications',
      ];

      for (const routePath of partnerRoutes) {
        const response = await fetch(`${baseUrl}${routePath}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${normalUserId}`,
            'Content-Type': 'application/json',
          },
        });

        const payload = (await response.json()) as any;
        // Must strictly deny with HTTP 403 or 401
        assert.equal(
          response.status === 403 || response.status === 401 || response.status === 501,
          true,
          `Route ${routePath} returned status ${response.status} instead of 403/401. Body: ${JSON.stringify(payload)}`
        );
        const errorStr = String(
          payload.message || payload.error?.message || payload.error || JSON.stringify(payload)
        ).toLowerCase();

        assert.ok(
          errorStr.includes('partner') ||
            errorStr.includes('access') ||
            errorStr.includes('required') ||
            errorStr.includes('available') ||
            errorStr.includes('not applied') ||
            payload.code === 'partner_only' ||
            payload.code === 'PARTNER_ACCESS_REQUIRED',
          `Response for ${routePath} must indicate partner access required`
        );
      }

      // Test frontend UI gate for normal user
      const gate = resolveGrowthPartnerGate({
        userId: normalUserId,
        loading: false,
        isMockMode: false,
        partnerRow: null,
        loadError: null,
        applicationStatus: null,
      });

      assert.equal(gate, 'unauthorized', 'UI gate for normal user must evaluate to unauthorized');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    await local.close();
  }
});
