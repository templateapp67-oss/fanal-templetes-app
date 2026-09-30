// ============================================================================
// Migration ORDER — the bug behind "The asset library could not load".
//
// The partner-portal migrations were named `20260918035349_…` /
// `20260918070000_…` / `20260919120000_…` / `20260919130000_…`, which sorts them
// BEFORE the two migrations that create the objects their foreign keys point at:
//
//   • `20260928_partner_referrals_table.sql` adds `growth_partners.id`
//   • `20260928`/`20260929` create `partner_referrals` / `partner_referral_events`
//
// Any runner that applies migrations in FILE-NAME order — `supabase db push`,
// `supabase migration up`, an alphabetical script — therefore hit
//
//     column "id" referenced in foreign key constraint does not exist
//
// (and, chained, `relation "public.partner_payout_requests" does not exist`).
// Those files are transactional, so they rolled back completely: the project
// ended up with NO `partner_marketing_assets`, NO `partner_payout_requests`,
// NO `get_partner_marketing_assets()` — and every portal section answered
// PGRST202, which the UI reports as
//
//     The partner operations schema is not applied to this project yet.
//
// The fix is the rename (`20260930000000…`–`20260930000400…`, i.e. after every
// dependency and before `20260930_partner_dashboard_metrics.sql`). This file is
// the guard, in three parts:
//
//   1. every file in the local chain installs on a fresh Postgres when applied
//      in FILE-NAME order, with zero failures;
//   2. the portal schema really exists afterwards, and the asset library read
//      returns the published row through the RPC the page calls;
//   3. the ordering invariant itself — no portal migration sorts in front of a
//      migration that creates its FK targets.
// ============================================================================

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { LOCAL_GROWTH_CHAIN } from '../server/localSupabase';

const PORTAL_MIGRATIONS = [
  '20260930000000_partner_portal_operations.sql',
  '20260930000100_partner_account_settings.sql',
  '20260930000200_partner_portal_section_reads.sql',
  '20260930000300_partner_account_security_settings.sql',
];

/** The migrations that create what the portal migrations have FKs to. */
const PORTAL_DEPENDENCIES = [
  '20260928_partner_referrals_table.sql', // growth_partners.id, partner_referrals
  '20260929_partner_referral_events_rls.sql', // partner_referral_events
];

function migrationSql(file: string): string {
  return readFileSync(path.join(process.cwd(), 'supabase', 'migrations', file), 'utf8');
}

/**
 * A fresh database with the chain applied in FILE-NAME order — the order a real
 * migration runner uses, and the order that used to break.
 */
async function installInFileNameOrder(): Promise<{
  db: any;
  failures: Array<{ file: string; message: string }>;
}> {
  const bootstrap = readFileSync(path.join(process.cwd(), 'server', 'localSupabase.ts'), 'utf8')
    .match(/LOCAL_DATABASE_BOOTSTRAP = `([\s\S]*?)`;/)![1];
  const db: any = new PGlite();
  await db.exec(bootstrap);

  const failures: Array<{ file: string; message: string }> = [];
  for (const file of [...LOCAL_GROWTH_CHAIN].sort()) {
    try {
      await db.exec(migrationSql(file));
    } catch (error: any) {
      failures.push({ file, message: String(error?.message || error).split('\n')[0] });
      // A file that opens a transaction leaves the session aborted; clear it so
      // the next file is judged on its own.
      try {
        await db.exec('rollback');
      } catch {}
    }
  }
  return { db, failures };
}

test('every migration in the chain installs when applied in file-name order', async () => {
  const { db, failures } = await installInFileNameOrder();
  try {
    assert.deepEqual(
      failures,
      [],
      `a runner that applies migrations by name must be able to install all of them:\n${failures
        .map((failure) => `  ${failure.file}: ${failure.message}`)
        .join('\n')}`
    );
  } finally {
    await db.close();
  }
});

test('the portal schema is installed by a file-name-order run', async () => {
  const { db, failures } = await installInFileNameOrder();
  try {
    assert.deepEqual(failures, [], 'the install must not have failed anywhere');

    const tables = await db.query(
      `select tablename from pg_tables
        where schemaname = 'public'
          and tablename in ('partner_marketing_assets', 'partner_payout_requests',
                            'partner_account_settings', 'partner_notifications')
        order by tablename`
    );
    assert.deepEqual(
      tables.rows.map((row: any) => row.tablename),
      ['partner_account_settings', 'partner_marketing_assets', 'partner_notifications', 'partner_payout_requests'],
      'the tables every portal section reads must exist'
    );

    const functions = await db.query(
      `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and proname in ('get_partner_marketing_assets', 'get_partner_marketing_asset_categories',
                          'get_my_partner_earnings', 'get_my_partner_payout_requests')
        order by proname`
    );
    assert.deepEqual(
      functions.rows.map((row: any) => row.proname),
      [
        'get_my_partner_earnings',
        'get_my_partner_payout_requests',
        'get_partner_marketing_asset_categories',
        'get_partner_marketing_assets',
      ],
      'the RPCs the portal pages call must exist, not answer PGRST202'
    );
  } finally {
    await db.close();
  }
});

test('the asset library read answers with the published asset', async () => {
  const { db, failures } = await installInFileNameOrder();
  try {
    assert.deepEqual(failures, [], 'the install must not have failed anywhere');

    await db.exec(`
      insert into public.partner_marketing_assets
        (category, title, description, storage_path, mime_type, file_size_bytes, is_published, published_at)
      values
        ('banner', 'Diwali banner', 'Ready to post', 'banners/diwali.png', 'image/png', 204800, true, now()),
        ('banner', 'Draft banner', 'Not published yet', 'banners/draft.png', 'image/png', 1024, false, null);
    `);

    // The page calls get_partner_marketing_assets(p_category) with a null (or
    // concrete) category — an unpublished asset must never be returned.
    const all = await db.query('select public.get_partner_marketing_assets(null) as result');
    const rows = all.rows[0].result as any[];
    assert.equal(rows.length, 1, 'only the published asset is in the library');
    assert.equal(rows[0].title, 'Diwali banner');
    assert.equal(rows[0].category, 'banner');

    const filtered = await db.query(`select public.get_partner_marketing_assets('social_graphic') as result`);
    assert.deepEqual(filtered.rows[0].result, [], 'a category with no assets answers an empty library, not an error');

    const categories = await db.query('select public.get_partner_marketing_asset_categories() as result');
    assert.deepEqual(categories.rows[0].result, [{ category: 'banner', asset_count: 1 }]);
  } finally {
    await db.close();
  }
});

test('no portal migration sorts in front of the migration that creates its FK targets', () => {
  for (const migration of PORTAL_MIGRATIONS) {
    for (const dependency of PORTAL_DEPENDENCIES) {
      assert.ok(
        migration > dependency,
        `${migration} must sort after ${dependency} — a file-name-order runner applies it first otherwise`
      );
    }
  }
  // …and after the two migrations that came before them historically, so the
  // relative order of the portal files themselves is preserved.
  assert.deepEqual([...PORTAL_MIGRATIONS].sort(), PORTAL_MIGRATIONS);
  assert.ok(PORTAL_MIGRATIONS[0] > '20260929_partner_referral_events_rls.sql');
});
