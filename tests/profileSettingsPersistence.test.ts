import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { buildProfileSettingsUpsert, mapProfileSettingsRow, resolveOwnerProfileName } from '../src/lib/readPartnerProfile';

const MIGRATION = readFileSync(
  new URL('../supabase/migrations/20261023000000_profile_settings_persistence.sql', import.meta.url),
  'utf8',
);
const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';

test('profile setting mapper reads canonical and legacy column spellings', () => {
  assert.equal(resolveOwnerProfileName('User', 'VIJAY KUMAR'), 'VIJAY KUMAR');
  assert.equal(resolveOwnerProfileName('Vijay Kumar', 'Other Name'), 'Vijay Kumar');
  const mapped = mapProfileSettingsRow({
    id: OWNER_A,
    full_name: 'Vijay Kumar',
    phone_number: '+919876543210',
    whatsapp_number: '+919876543210',
    pin_code: '400050',
    city: 'Mumbai',
    area: 'Bandra West',
    contact_email: 'contact@example.com',
    address: '12 Main Road',
    dob: '1990-05-02',
    avatar_url: 'https://example.com/avatar.webp',
    whatsapp_notifications_enabled: false,
  });

  assert.equal(mapped?.ownerName, 'Vijay Kumar');
  assert.equal(mapped?.whatsapp, '+919876543210');
  assert.equal(mapped?.postalCode, '400050');
  assert.equal(mapped?.areaLocality, 'Bandra West');
  assert.equal(mapped?.email, 'contact@example.com');
  assert.equal(mapped?.address, '12 Main Road');
  assert.equal(mapped?.dob, '1990-05-02');
  assert.equal(mapped?.avatar, 'https://example.com/avatar.webp');
  assert.equal(mapped?.notifications, false);

  const legacy = mapProfileSettingsRow({
    full_name: 'Legacy Owner', phone: '+919000000000', whatsapp: '+919000000000',
    postal_code: '560038', preferred_city: 'Bengaluru', preferred_area: 'Indiranagar',
    email: 'legacy@example.com', full_address: 'Old address', date_of_birth: '1985-10-01',
    owner_photo_url: 'https://example.com/legacy.webp',
  });
  assert.equal(legacy?.postalCode, '560038');
  assert.equal(legacy?.city, 'Bengaluru');
  assert.equal(legacy?.areaLocality, 'Indiranagar');
  assert.equal(legacy?.dob, '1985-10-01');
});

test('profile upsert payload includes the required database fields and compatibility aliases', () => {
  const payload = buildProfileSettingsUpsert(OWNER_A, {
    ownerName: 'Vijay Kumar',
    phone: '+919876543210',
    whatsapp: '+919876543210',
    dob: '1990-05-02',
    postalCode: '400050',
    city: 'Mumbai',
    areaLocality: 'Bandra West',
    email: 'contact@example.com',
    address: '12 Main Road',
    state: 'Maharashtra',
    landmark: 'Near station',
    avatar: 'https://example.com/avatar.webp',
    notifications: false,
  });
  for (const column of [
    'id', 'full_name', 'whatsapp_number', 'dob', 'pin_code', 'city', 'area',
    'phone_number', 'contact_email', 'address', 'state', 'landmark', 'avatar_url', 'updated_at',
  ]) assert.ok(column in payload, `missing ${column}`);
  assert.equal(payload.whatsapp_notifications_enabled, false);
  assert.equal(payload.postal_code, '400050');
});

test('profile settings migration adds schema aliases, synchronizes writes, and scopes RLS by auth.uid()', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('app.uid', true), '')::uuid
      $$;
      create table public.profiles (
        id uuid primary key references auth.users(id) on delete cascade,
        full_name text,
        email text,
        phone_number text,
        phone text,
        mobile text,
        whatsapp text,
        postal_code text,
        pincode text,
        city text,
        preferred_city text,
        area text,
        preferred_area text,
        owner_photo_url text,
        avatar_url text,
        photo_url text,
        date_of_birth date,
        dob date,
        full_address text,
        state text,
        landmark text,
        updated_at timestamptz not null default now()
      );
      insert into auth.users(id) values ('${OWNER_A}'), ('${OWNER_B}');
      insert into public.profiles(id, full_name, email)
        values ('${OWNER_A}', 'Before update', 'account@example.com'), ('${OWNER_B}', 'Other owner', 'other@example.com');
      grant usage on schema auth to authenticated;
    `);

    await db.exec(MIGRATION);

    const columns = await db.query<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_schema='public' and table_name='profiles'
    `);
    const columnNames = new Set(columns.rows.map((row) => row.column_name));
    for (const column of [
      'full_name', 'whatsapp_number', 'dob', 'pin_code', 'city', 'area',
      'phone_number', 'contact_email', 'address', 'state', 'landmark', 'avatar_url',
    ]) assert.ok(columnNames.has(column), `profiles.${column} was not created`);

    await db.exec(`set role authenticated; set app.uid='${OWNER_A}';`);
    await db.query(`
      insert into public.profiles (
        id, full_name, whatsapp_number, dob, pin_code, city, area, phone_number,
        contact_email, address, state, landmark, avatar_url, whatsapp_notifications_enabled, updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, false, now())
      on conflict (id) do update set
        full_name=excluded.full_name, whatsapp_number=excluded.whatsapp_number,
        dob=excluded.dob, pin_code=excluded.pin_code, city=excluded.city,
        area=excluded.area, phone_number=excluded.phone_number,
        contact_email=excluded.contact_email, address=excluded.address,
        state=excluded.state, landmark=excluded.landmark, avatar_url=excluded.avatar_url,
        whatsapp_notifications_enabled=excluded.whatsapp_notifications_enabled,
        updated_at=excluded.updated_at
    `, [OWNER_A, 'Vijay Kumar', '+919876543210', '1990-05-02', '400050', 'Mumbai', 'Bandra West', '+919876543210', 'contact@example.com', '12 Main Road', 'Maharashtra', 'Near station', 'https://example.com/avatar.webp']);

    const own = await db.query<any>(`
      select full_name, whatsapp_number, whatsapp, dob, date_of_birth, pin_code, postal_code,
             city, area, phone_number, phone, contact_email, email, address, full_address,
             avatar_url, owner_photo_url, whatsapp_notifications_enabled
      from public.profiles where id=$1
    `, [OWNER_A]);
    assert.equal(own.rows.length, 1);
    assert.equal(own.rows[0].full_name, 'Vijay Kumar');
    assert.equal(own.rows[0].whatsapp, '+919876543210');
    const asDate = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
    assert.equal(asDate(own.rows[0].dob), '1990-05-02');
    assert.equal(asDate(own.rows[0].date_of_birth), '1990-05-02');
    assert.equal(own.rows[0].pin_code, '400050');
    assert.equal(own.rows[0].postal_code, '400050');
    assert.equal(own.rows[0].contact_email, 'contact@example.com');
    assert.equal(own.rows[0].email, 'contact@example.com');
    assert.equal(own.rows[0].address, '12 Main Road');
    assert.equal(own.rows[0].full_address, '12 Main Road');
    assert.equal(own.rows[0].avatar_url, 'https://example.com/avatar.webp');
    assert.equal(own.rows[0].owner_photo_url, 'https://example.com/avatar.webp');
    assert.equal(own.rows[0].whatsapp_notifications_enabled, false);

    const visible = await db.query<any>('select id from public.profiles order by id');
    assert.deepEqual(visible.rows.map((row) => row.id), [OWNER_A]);
    const crossUpdate = await db.query<any>('update public.profiles set full_name=$1 where id=$2 returning id', ['Nope', OWNER_B]);
    assert.deepEqual(crossUpdate.rows, []);
    await assert.rejects(
      db.query('insert into public.profiles(id, full_name) values ($1, $2)', [OWNER_B, 'Not allowed']),
      /row-level security/i,
    );

    // Existing save paths that write legacy columns continue to update the
    // canonical fields used by the new profile settings form.
    await db.query('update public.profiles set phone=$1, whatsapp=$2, postal_code=$3, full_address=$4 where id=$5', [
      '+919111111111', '+919111111111', '560038', 'Updated old address', OWNER_A,
    ]);
    const legacyWrite = await db.query<any>(
      'select phone_number, whatsapp_number, pin_code, address from public.profiles where id=$1', [OWNER_A],
    );
    assert.equal(legacyWrite.rows[0].phone_number, '+919111111111');
    assert.equal(legacyWrite.rows[0].whatsapp_number, '+919111111111');
    assert.equal(legacyWrite.rows[0].pin_code, '560038');
    assert.equal(legacyWrite.rows[0].address, 'Updated old address');
  } finally {
    await db.close();
  }
});
