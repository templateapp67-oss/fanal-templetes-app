import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { summarizeSaveError, isSchemaLikeFailure } from '../src/lib/autoSave';

test('schema toast identifies missing resources instead of recommending every migration', () => {
  for (const [message, expected] of [
    ['relation "public.owner_editor_state" does not exist | code: 42P01', 'public.owner_editor_state'],
    ['column "mobile" of relation "salons" does not exist | code: 42703', 'mobile'],
    ["Could not find the 'address' column of 'profiles' in the schema cache | code: PGRST204", 'address'],
    ['Could not find the function public.save_owner_editor_state(p_state) in the schema cache | code: PGRST202', 'public.save_owner_editor_state'],
  ]) {
    assert.equal(isSchemaLikeFailure(message), true);
    assert.ok(summarizeSaveError(message).includes(expected));
    assert.match(summarizeSaveError(message), /read-only check/);
  }
  assert.equal(isSchemaLikeFailure('permission denied for table profiles'), false);
});

test('schema diagnostic safely reports absent tables, functions and columns in one grid', async () => {
  const db = new PGlite();
  try {
    await db.exec('create table public.salons(id uuid primary key);');
    const sql = await readFile(new URL('../supabase/repairs/diagnose_website_save_schema.sql', import.meta.url), 'utf8');
    const rows = (await db.query<{ resource: string; status: string }>(sql)).rows;
    assert.equal(rows.find(r => r.resource === 'public.salons.id')?.status, 'OK');
    assert.equal(rows.find(r => r.resource === 'public.salons.mobile')?.status, 'MISSING');
    assert.equal(rows.find(r => r.resource === 'public.owner_editor_state')?.status, 'MISSING');
    assert.equal(rows.find(r => r.resource === 'public.save_owner_editor_state(jsonb)')?.status, 'MISSING');
  } finally { await db.close(); }
});
