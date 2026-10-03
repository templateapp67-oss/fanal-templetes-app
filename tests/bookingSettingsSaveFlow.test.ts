// ============================================================================
// The four save surfaces that used to die on
// `23514 … salon_booking_settings_deposit_25_check`, exercised end to end with
// the payload each one actually sends:
//
//   • saveOwnerEditorState  — the editor's direct RPC (profile setup, template
//                             selection and the services save all land here);
//   • saveViaWebsiteApi     — the service-role fallback POST /api/website/save;
//   • syncSalonToSupabase   — the per-table client sync, where the services
//                             write has to survive a profile write failing.
//
// Every one of them starts from a profile whose advance is WRONG (20), which is
// the state a pre-fix database hydrates into the editor, and must still send 25.
// ============================================================================

import assert from 'node:assert/strict';
import test from 'node:test';

import { saveOwnerEditorState } from '../src/lib/ownerEditorState';
import { saveViaWebsiteApi } from '../src/lib/autoSave';
import { syncSalonToSupabase } from '../src/lib/salonSync';
import { DEFAULT_LOYALTY_CONFIG } from '../src/loyaltyData';
import type { LoyaltyConfig, SalonProfile, SalonService, Stylist } from '../src/types';

const OWNER = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

const PROFILE = {
  ownerId: OWNER,
  businessType: 'hair_salon',
  businessName: 'Arts By Uma',
  ownerName: 'Uma',
  ownerRole: 'Founder',
  phone: '+91 98450 77654',
  whatsapp: '+91 98450 77654',
  email: 'hello@artsbyuma.com',
  tagline: 'Precision Cuts',
  about: 'Our story',
  ownerPhotoUrl: 'https://example.com/u.jpg',
  coverImageUrl: 'https://example.com/c.jpg',
  themePreset: 'slate_silver',
  currency: '₹',
  subdomain: 'arts-by-uma',
  address: '100 Feet Road',
  city: 'Bengaluru',
  postalCode: '560038',
  instagramHandle: 'arts_by_uma',
  requireDeposit: true,
  // Hydrated from a pre-fix row: the value that produced the 23514.
  depositPercentage: 20,
  themeAccentKey: 'slate',
} as unknown as SalonProfile;

const SERVICES: SalonService[] = [
  {
    id: 'hs-1', name: 'Precision Cut', category: 'Hair', durationMinutes: 45, price: 750,
    description: 'Signature cut.', icon: 'scissors', popular: true, showDuration: true,
  },
];

const STYLISTS: Stylist[] = [];

const PAYLOAD = {
  ownerId: OWNER,
  profile: PROFILE,
  services: SERVICES,
  stylists: STYLISTS,
  loyaltyConfig: DEFAULT_LOYALTY_CONFIG as LoyaltyConfig,
  selectedTemplateId: 'hair_salon',
};

test('the editor RPC sends 25% even though the profile state holds 20', async () => {
  let write: any;
  const db: any = {
    from() { throw new Error('the editor save must use the canonical transaction, not per-table writes'); },
    async rpc(name: string, args: any) { write = { name, args }; return { error: null }; },
  };

  const result = await saveOwnerEditorState(db, PAYLOAD as any);
  assert.equal(result.ok, true);
  assert.equal(write.name, 'save_owner_editor_state');

  assert.deepEqual(write.args.p_state.bookingSettings, {
    require_deposit: true,
    deposit_percent: 25,
    deposit_percentage: 25,
    deposit_25: 25,
    accept_online_bookings: true,
  });
  assert.equal(write.args.p_state.profile.depositPercentage, 25, 'the profile copy is healed too');
  assert.equal(write.args.p_state.profile.deposit_25, 25);
  assert.equal(
    write.args.p_state.profile.businessName,
    'Arts By Uma',
    'healing the advance must not disturb the rest of the profile'
  );
});

test('an owner who paused online bookings keeps accept_online_bookings false', async () => {
  let write: any;
  const db: any = { async rpc(_name: string, args: any) { write = args; return { error: null }; } };
  await saveOwnerEditorState(db, {
    ...PAYLOAD,
    profile: { ...PROFILE, acceptsOnlineBookings: false },
  } as any);
  assert.equal(write.p_state.bookingSettings.accept_online_bookings, false);
  assert.equal(write.p_state.bookingSettings.deposit_percentage, 25);
});

test('the API fallback posts 25%, never the NaN the old inline builder produced', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ success: true, timestamp: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as any;

  const result = await saveViaWebsiteApi(PAYLOAD as any, { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);

  const body = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(body.salonData.bookingSettings, {
    require_deposit: true,
    deposit_percent: 25,
    deposit_percentage: 25,
    deposit_25: 25,
    accept_online_bookings: true,
  });
  assert.equal(body.salonData.profile.depositPercentage, 25);
  for (const value of Object.values(body.salonData.bookingSettings)) {
    assert.ok(!Number.isNaN(value as number), 'no NaN may reach the database');
  }
});

test('services are written independently: a rejected profile does not stop them', async () => {
  const written: Record<string, any> = {};
  const db: any = {
    from(table: string) {
      const self: any = {
        upsert(rows: any) {
          const finish = () => {
            if (table === 'profiles') {
              // Exactly the failure this fix removes — the profile write is
              // rejected by the booking-settings check.
              const err: any = new Error(
                'new row for relation "public.salon_booking_settings" violates check constraint ' +
                  '"salon_booking_settings_deposit_25_check"'
              );
              err.code = '23514';
              return Promise.resolve({ data: null, error: err });
            }
            written[table] = rows;
            return Promise.resolve({ data: rows, error: null });
          };
          const thenable: any = {
            then: (resolve: any) => finish().then(resolve),
            catch: () => thenable,
          };
          return thenable;
        },
        delete() { return self; },
        eq() { return self; },
        not() { return self; },
      };
      return self;
    },
  };

  const result = await syncSalonToSupabase(db, PAYLOAD as any);

  // The failure is reported, never swallowed…
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /salon_booking_settings_deposit_25_check/);
  // …and the catalogue still reached the database on its own.
  assert.ok(written.services, 'the services table is its own operation');
  assert.equal(written.services.length, 1);
  assert.equal(written.services[0].name, 'Precision Cut');
  assert.ok(written.loyalty_config, 'loyalty settings are their own operation too');
  assert.equal(written.profiles, undefined, 'the rejected profile was not recorded');
});

test('the profiles row the client sync writes carries 25 whatever the state held', async () => {
  const written: Record<string, any> = {};
  const db: any = {
    from(table: string) {
      const self: any = {
        upsert(rows: any) {
          written[table] = rows;
          const thenable: any = {
            then: (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve),
            catch: () => thenable,
          };
          return thenable;
        },
        delete() { return self; },
        eq() { return self; },
        not() { return self; },
      };
      return self;
    },
  };

  const result = await syncSalonToSupabase(db, PAYLOAD as any);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(written.profiles.deposit_percentage, 25);
  assert.equal(written.profiles.require_deposit, true);
});
