import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('profile settings save through the schema-compatible owner RPC', async () => {
  const source = await readFile(new URL('../src/components/UserProfileSettingsModal.tsx', import.meta.url), 'utf8');
  assert.match(source, /rpc\('save_my_profile_settings'/);
  assert.doesNotMatch(source, /owner_photo_url: formData\.ownerPhotoUrl/);
});

test('profile photo migration is additive and keeps profile writes owner-scoped', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261019000000_profile_photo_schema_compatibility.sql', import.meta.url), 'utf8');
  assert.match(sql, /add column if not exists owner_photo_url text/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /v_owner uuid := auth\.uid\(\)/);
  assert.match(sql, /grant execute on function public\.save_my_profile_settings\(jsonb\) to authenticated/);
  assert.match(sql, /create or replace function public\.get_my_profile_settings\(\)/);
  assert.match(sql, /security invoker/);
});

test('partner contact modal restores every canonical persisted profile field', async () => {
  const source = await readFile(new URL('../src/components/PartnerProfileModal.tsx', import.meta.url), 'utf8');
  for (const field of ['ownerName', 'whatsapp', 'postalCode', 'city', 'phone', 'email', 'address', 'state', 'landmark', 'dob']) {
    assert.match(source, new RegExp(`data\\?\\.${field}`));
  }
  assert.match(source, /data\?\.area/);
  assert.match(source, /rpc\('save_my_profile_settings'/);
  assert.doesNotMatch(source, /RPC save_partner_profile_details notice/);
});
