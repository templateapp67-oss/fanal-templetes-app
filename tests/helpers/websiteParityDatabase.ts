import { readFile } from 'node:fs/promises';
import { websiteDatabase, actor, salon } from './websiteDatabase';

// ============================================================================
// Real `save_owner_editor_state` SQL, at two migration levels, in PGlite.
//
//   m28 — 20261028…complete_website_editor_persistence.sql (no later migration applied)
//   m31 — 20261031…fix_website_save_and_public_site.sql   (latest in the repo)
//
// The shared fixture (websiteDatabase) builds the pre-normalized schema. The
// migration 20261031 also reconciles the production tables, so the few tables
// it assumes exist outside this repository are stubbed here exactly as far as
// the save function needs them: roles, organizations + membership, salon_hours.
// ============================================================================

const read = (name: string) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const M28 = await read('20261028000000_complete_website_editor_persistence.sql');
const M31 = await read('20261031000000_fix_website_save_and_public_site.sql');

const STUBS = `
do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$;
create table if not exists auth.users(id uuid primary key);
create table if not exists public.salon_hours(salon_id uuid, day_of_week int, opens_at time, closes_at time, is_closed boolean default false, primary key(salon_id, day_of_week));
create table if not exists public.organizations(id uuid primary key default gen_random_uuid(), name text, slug text, created_by uuid);
create table if not exists public.organization_members(id uuid primary key default gen_random_uuid(), organization_id uuid, user_id uuid, role text, status text default 'active', created_at timestamptz default now());
`;
const ORG = '30000000-0000-4000-8000-0000000000aa';

export type MigrationLevel = 'm28' | 'm31';
export const MIGRATION_LEVELS: MigrationLevel[] = ['m28', 'm31'];
export interface SaveOutcome { ok: boolean; code?: string; message?: string }

export { actor, salon };

export async function openParityDatabase(level: MigrationLevel) {
  const db = await websiteDatabase();
  await db.exec(STUBS);
  await db.exec(`insert into auth.users values('${actor}') on conflict do nothing; grant usage on schema auth to authenticated; grant select on profiles to authenticated;`);
  await db.exec(M28);
  if (level === 'm31') {
    await db.exec(M31);
    await db.exec(`insert into organizations(id,name) values('${ORG}','Org'); update salons set organization_id='${ORG}', is_active=true where id='${salon}'; insert into organization_members(organization_id,user_id,role,status) values('${ORG}','${actor}','owner','active');`);
  }
  await db.exec('set role authenticated');
  const save = async (state: unknown): Promise<SaveOutcome> => {
    try {
      await db.query('select save_owner_editor_state($1::jsonb)', [JSON.stringify(state)]);
      return { ok: true };
    } catch (error: any) {
      return { ok: false, code: error.code, message: String(error.message) };
    }
  };
  return { db, save };
}
