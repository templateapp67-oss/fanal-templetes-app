// ============================================================================
// The SQL behind the promoted portal sections, run as Postgres.
//
// `tests/partnerPortalOperations.test.ts` pins what the client asks for and how
// answers are translated; `tests/partnerPortalRoutesApi.test.ts` pins the HTTP
// surface. Neither can prove the DATABASE enforces the rules the seven pages
// claim — the ₹500 floor, one open payout at a time, "you may cancel only your
// own open request", tickets bounded the way the table checks them, a partner
// never seeing another partner's wallet. Those promises are made inside
// `20260918035349_partner_portal_operations.sql` and
// `20260919120000_partner_portal_section_reads.sql`, so they are tested there.
//
// Why a dedicated file instead of adding the migrations to `LOCAL_GROWTH_CHAIN`:
// the Part 3 guards enumerate which tables can hold partner/referral state to
// prove no parallel store exists, and eight new `partner_*` tables arriving
// would silently widen an invariant that phase owns. So this file boots the same
// chain and then applies the two portal migrations on top, the way the SQL
// Editor would (GROWTH_PARTNER_SETUP.md §3).
//
// Two `growth_partners` generations are exercised deliberately: the one this
// repository ships (`is_active` only) and the deployed one (also `status`). A
// `language sql` body reads columns at CREATE time, so an unguarded `gp.status`
// made the whole file uninstallable on a fresh project — the bug this suite
// exists to keep fixed.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalDatabase, LOCAL_GROWTH_CHAIN } from '../server/localSupabase';

const PORTAL_MIGRATIONS = [
  '20260918035349_partner_portal_operations.sql',
  '20260919120000_partner_portal_section_reads.sql',
];

const MIGRATION = (file: string) =>
  readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');

interface PortalDb {
  local: Awaited<ReturnType<typeof createLocalDatabase>>;
  db: any;
  /** Call a function as a signed-in user (or as service_role/admin). */
  rpc: (actor: string | null, name: string, args?: any[], admin?: boolean) => Promise<any>;
  query: (sql: string, params?: any[]) => Promise<any>;
  close: () => Promise<void>;
}

async function portalDatabase(options: { deployedGeneration?: boolean } = {}): Promise<PortalDb> {
  const local = await createLocalDatabase();
  const db = local.db;
  if (options.deployedGeneration) {
    // A project created by the older production path carries an approval
    // status; the local chain's growth_partners does not.
    await db.exec(
      `alter table public.growth_partners add column status text not null default 'approved'`
    );
  }
  for (const file of PORTAL_MIGRATIONS) await db.exec(MIGRATION(file));
  const rpc: PortalDb['rpc'] = (actor, name, args = [], admin = false) =>
    local.asRequest({ sub: actor, isAdmin: admin }, async (conn) => {
      const placeholders = args.map((_, index) => `$${index + 1}`).join(',');
      const result = await conn.query(`select public.${name}(${placeholders}) as r`, args);
      return result.rows[0]?.r;
    });
  return {
    local,
    db,
    rpc,
    query: (sql, params) => db.query(sql, params),
    close: () => local.close(),
  };
}

/**
 * One active referral for a partner. A DISTINCT referred user per row: the
 * chain's ban/self-referral guard (`20261005`) refuses a partner who refers
 * themselves, and this fixture must look like six customers, not one trick.
 */
async function addReferral(portal: PortalDb, partnerId: string, code: string, email: string): Promise<string> {
  const { db } = portal;
  const referred = await db.query(
    `insert into auth.users(id,email,encrypted_password,email_confirmed_at)
     values (gen_random_uuid(), $1, 'test-only', now()) returning id`,
    [`${email}@portal.example`]
  );
  const created = await db.query(
    `insert into public.partner_referrals(partner_id,referral_code,status,referred_user_id,registered_at,first_clicked_at)
     values ($1,$2,'active',$3,now(),now()) returning id`,
    [partnerId, code, referred.rows[0].id]
  );
  return created.rows[0].id;
}

/** A partner with one active referral, optionally a cleared payment. */
async function seedPartner(
  portal: PortalDb,
  options: { code: string; status?: string; paidPaise?: number; referrals?: number; invoice?: string } = {
    code: 'PORTAL01',
  }
): Promise<{ user: string; partner: string; referral: string }> {
  const { db } = portal;
  const email = `${options.code.toLowerCase()}@portal.example`;
  const inserted = await db.query(
    `insert into auth.users(id,email,encrypted_password,email_confirmed_at)
     values (gen_random_uuid(), $1, 'test-only', now()) returning id`,
    [email]
  );
  const user = inserted.rows[0].id;
  const hasStatus =
    (
      await db.query(
        `select 1 from information_schema.columns
          where table_schema='public' and table_name='growth_partners' and column_name='status'`
      )
    ).rows.length > 0;
  if (hasStatus && options.status && options.status !== 'approved') {
    await db.query(
      `insert into public.growth_partners(user_id,referral_code,is_active,status)
       values ($1,$2,true,$3)`,
      [user, options.code, options.status]
    );
  } else {
    await db.query(`insert into public.growth_partners(user_id,referral_code,is_active) values ($1,$2,true)`, [
      user,
      options.code,
    ]);
  }
  const partner = (
    await db.query(`select id from public.growth_partners where user_id=$1`, [user])
  ).rows[0].id;

  let referral = '';
  for (let index = 0; index < (options.referrals ?? 1); index++) {
    referral = await addReferral(portal, partner, options.code, `${options.code.toLowerCase()}-referred-${index}`);
  }
  if (options.paidPaise) {
    await db.query(`select public.record_partner_subscription_commission($1,$2,$3,now())`, [
      referral,
      options.invoice ?? `inv-${options.code}`,
      options.paidPaise,
    ]);
  }
  return { user, partner, referral };
}

/**
 * Run the release pass the payment worker runs. `release_partner_earnings()`
 * only promotes rows whose 7-day clearance has elapsed, so the local test asks
 * it as of a week in the future rather than sleeping for one.
 */
async function releaseDueEarnings(portal: PortalDb): Promise<number> {
  const result: any = await portal.local.asRequest({ sub: null, isAdmin: true }, (conn) =>
    conn.query(`select public.release_partner_earnings(now() + interval '8 days') as n`)
  );
  return result.rows[0].n;
}

test('the portal migrations install on the schema this repository ships', async () => {
  const portal = await portalDatabase();
  try {
    // The premise, not an assumption: this generation has no approval column,
    // which is exactly what made the original file uninstallable.
    const columns = await portal.query(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='growth_partners'`
    );
    assert.ok(!columns.rows.some((row: any) => row.column_name === 'status'));

    const tables = await portal.query(
      `select tablename from pg_tables where schemaname='public'
         and tablename in ('partner_earnings','partner_payout_requests','partner_level_definitions',
                           'partner_notifications','partner_notification_preferences',
                           'partner_marketing_assets','partner_support_tickets','partner_support_attachments')`
    );
    assert.equal(tables.rows.length, 8, 'every operational table exists');

    // PGlite has no `storage` schema, and the migrations skip that half instead
    // of failing — which is what makes this whole file possible.
    const storage = await portal.query(`select to_regclass('storage.buckets') as bucket`);
    assert.equal(storage.rows[0].bucket, null);

    // The two generation-sensitive functions are plpgsql precisely so their
    // column resolution happens per execution, not at CREATE time.
    const langs = await portal.query(
      `select p.proname as name, l.lanname as language from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         join pg_language l on l.oid = p.prolang
        where n.nspname='public' and p.proname in ('my_active_partner_id','get_partner_leaderboard')`
    );
    assert.deepEqual(
      langs.rows.map((row: any) => `${row.name}:${row.language}`).sort(),
      ['get_partner_leaderboard:plpgsql', 'my_active_partner_id:plpgsql']
    );

    // The seeded tiers the Partner Levels page renders.
    const tiers = await portal.query(`select code, commission_bps from public.partner_level_definitions order by sort_order`);
    assert.deepEqual(tiers.rows, [
      { code: 'bronze', commission_bps: 1000 },
      { code: 'silver', commission_bps: 1500 },
      { code: 'gold', commission_bps: 2000 },
      { code: 'platinum', commission_bps: 2500 },
    ]);

    // The reads answer, rather than erroring on a schema they cannot parse.
    const { user } = await seedPartner(portal, { code: 'INSTALL01' });
    const earnings = await portal.rpc(user, 'get_my_partner_earnings', [50, 0]);
    assert.deepEqual(earnings.totals, {
      lifetime_paise: 0,
      pending_paise: 0,
      cleared_paise: 0,
      available_paise: 0,
    });
    assert.deepEqual(earnings.transactions, []);
  } finally {
    await portal.close();
  }
});

test('the ledger: 15% of a cleared payment, pending until the 7-day clearance', async () => {
  const portal = await portalDatabase();
  try {
    const { user } = await seedPartner(portal, { code: 'LEDGER01', paidPaise: 1_000_000, invoice: 'inv-LEDGER01' });
    const pending = await portal.rpc(user, 'get_my_partner_earnings', [50, 0]);
    assert.equal(pending.totals.lifetime_paise, 150_000, 'the frozen 15% share of ₹10,000');
    assert.equal(pending.totals.pending_paise, 150_000);
    assert.equal(pending.totals.available_paise, 0, 'clearance has not elapsed');
    assert.equal(pending.transactions[0].commission_bps, 1500, 'the rate is stamped on the row');
    assert.equal(pending.transactions[0].status, 'pending');

    // The same payment reference again (a replayed webhook) must not earn twice.
    const referralId = (
      await portal.query(`select referral_id from public.partner_earnings limit 1`)
    ).rows[0].referral_id;
    await portal.query(`select public.record_partner_subscription_commission($1,'inv-LEDGER01',$2,now())`, [
      referralId,
      1_000_000,
    ]);
    const replayed = await portal.rpc(user, 'get_my_partner_earnings', [50, 0]);
    assert.equal(replayed.transactions.length, 1, 'source_key dedupes the replay');
    assert.equal(replayed.totals.lifetime_paise, 150_000, 'and the totals do not double');

    assert.equal(await releaseDueEarnings(portal), 1, 'the release pass moved exactly the due row');
    const cleared = await portal.rpc(user, 'get_my_partner_earnings', [50, 0]);
    assert.equal(cleared.totals.available_paise, 150_000);
    assert.equal(cleared.totals.pending_paise, 0);
  } finally {
    await portal.close();
  }
});

test('a payout request is bounded by the floor, the balance and one open request', async () => {
  const portal = await portalDatabase();
  try {
    const { user } = await seedPartner(portal, { code: 'PAYOUT1', paidPaise: 1_000_000 });
    await releaseDueEarnings(portal);

    await assert.rejects(
      portal.rpc(user, 'request_my_partner_payout', [49_999, 'upi', 'partner@okbank']),
      /Minimum withdrawal is ₹500/,
      'the ledger floor is the database’s, not the form’s'
    );
    await assert.rejects(
      portal.rpc(user, 'request_my_partner_payout', [150_001, 'upi', 'partner@okbank']),
      /Withdrawal exceeds available balance/
    );
    await assert.rejects(
      portal.rpc(user, 'request_my_partner_payout', [100_000, 'wire', 'partner@okbank']),
      /Invalid payout destination/,
      'an unsupported method is refused, not stored'
    );

    const created = await portal.rpc(user, 'request_my_partner_payout', [60_000, 'upi', '  partner@okbank  ']);
    assert.equal(created.status, 'pending');
    assert.equal(created.amount_paise, 60_000);
    const stored = await portal.query(
      `select destination_label from public.partner_payout_requests where id=$1`,
      [created.id]
    );
    assert.equal(stored.rows[0].destination_label, 'partner@okbank', 'trimmed on the way in');

    // ₹600 would still fit the ₹900 that is left, so both of the function's own
    // checks pass and the request is stopped by the partial UNIQUE index on
    // (partner_id) WHERE status IN ('pending','in_review'): one open request per
    // partner. Postgres names the index; the client maps that to the fix (see
    // tests/partnerPortalOperations.test.ts), which is why the copy here is raw.
    await assert.rejects(
      portal.rpc(user, 'request_my_partner_payout', [60_000, 'upi', 'partner@okbank']),
      /partner_payout_requests_one_open_per_partner/,
      'the database, not the form, owns “one at a time”'
    );

    const list = await portal.rpc(user, 'get_my_partner_payout_requests', [25, 0]);
    assert.equal(list.total, 1);
    assert.equal(list.open_amount_paise, 60_000, 'reserved money is visible to the partner');
    const other = await portalDatabase();
    try {
      const { user: stranger } = await seedPartner(other, { code: 'PAYOUT2' });
      const blind = await other.rpc(stranger, 'get_my_partner_payout_requests', [25, 0]);
      assert.deepEqual(blind, { total: 0, open_amount_paise: 0, items: [] }, 'nobody else’s wallet');
    } finally {
      await other.close();
    }
  } finally {
    await portal.close();
  }
});

test('cancel is limited to the caller’s own open request, and frees the slot', async () => {
  const portal = await portalDatabase();
  try {
    const { user } = await seedPartner(portal, { code: 'CANCEL1', paidPaise: 1_000_000 });
    await releaseDueEarnings(portal);
    const created = await portal.rpc(user, 'request_my_partner_payout', [100_000, 'upi', 'partner@okbank']);

    const { user: other } = await seedPartner(portal, { code: 'CANCEL2' });
    await assert.rejects(
      portal.rpc(other, 'cancel_my_partner_payout_request', [created.id]),
      /Open payout request not found/,
      'a guessed uuid from another partner matches nothing'
    );

    const cancelled = await portal.rpc(user, 'cancel_my_partner_payout_request', [created.id]);
    assert.deepEqual(cancelled, { id: created.id, status: 'cancelled', amount_paise: 100_000 });
    await assert.rejects(
      portal.rpc(user, 'cancel_my_partner_payout_request', [created.id]),
      /Open payout request not found/,
      'a cancelled request is not rewritable'
    );

    const after = await portal.rpc(user, 'get_my_partner_payout_requests', [25, 0]);
    assert.equal(after.open_amount_paise, 0, 'the reservation is gone');
    assert.equal(after.items[0].status, 'cancelled');
    const again = await portal.rpc(user, 'request_my_partner_payout', [100_000, 'upi', 'partner@okbank']);
    assert.equal(again.status, 'pending', 'the one-open slot is free again');
  } finally {
    await portal.close();
  }
});

test('tickets: the table checks run, the number is the partner’s receipt, the list is their own', async () => {
  const portal = await portalDatabase();
  try {
    const { user, partner } = await seedPartner(portal, { code: 'TICKET1' });
    await assert.rejects(
      portal.rpc(user, 'submit_my_partner_support_ticket', ['Hi', 'too short', 'normal']),
      /Invalid ticket/,
      'a one-word subject never becomes a ticket'
    );
    await assert.rejects(
      portal.rpc(user, 'submit_my_partner_support_ticket', [
        'Payout looks wrong',
        'x'.repeat(5_001),
        'normal',
      ]),
      /Invalid ticket|partner_support_tickets_message_check|check constraint/i
    );
    await assert.rejects(
      portal.rpc(user, 'submit_my_partner_support_ticket', ['Payout looks wrong', 'The ₹150 row is missing.', 'urgent']),
      /Invalid ticket|priority|check/i,
      'an invented priority is not accepted'
    );

    const first = await portal.rpc(user, 'submit_my_partner_support_ticket', [
      'Payout looks wrong',
      'The ₹150 row is missing from my ledger.',
      'high',
    ]);
    assert.equal(first.status, 'open');
    assert.ok(Number(first.ticket_number) > 0, 'the receipt number the page prints');
    const mine = await portal.rpc(user, 'get_my_partner_support_tickets', [25, null]);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].subject, 'Payout looks wrong');
    assert.equal(mine[0].priority, 'high');

    const filtered = await portal.rpc(user, 'get_my_partner_support_tickets', [25, 'resolved']);
    assert.deepEqual(filtered, [], 'the status filter is applied in SQL');

    // The status trigger is the only writer of the update notification, and an
    // admin change is what trips it — never a client PATCH.
    await portal.query(`update public.partner_support_tickets set status='resolved' where id=$1`, [first.id]);
    const feed = await portal.rpc(user, 'get_my_partner_notifications', [null, 25]);
    assert.equal(feed.items.length, 1, 'the partner is told, once');
    assert.match(feed.items[0].title, /Support ticket updated/);
    assert.equal(feed.unread_count, 1);
    assert.equal(await portal.rpc(user, 'mark_my_partner_notifications_read', [null]), 1);
    assert.equal((await portal.rpc(user, 'get_my_partner_notifications', [null, 25])).unread_count, 0);

    // Attachments are scoped on the way OUT: the read policy keys them to the
    // caller's own partner row, so a partner listing the table sees only theirs.
    await portal.query(
      `insert into public.partner_support_attachments(ticket_id,partner_id,storage_path,original_filename,mime_type,size_bytes)
       values ($1,$2,'support/attachment-1/shot.png','shot.png','image/png',20480)`,
      [first.id, partner]
    );
    const seen: any = await portal.local.asRequest({ sub: user, isAdmin: false }, (conn) =>
      conn.query(`select count(*)::int as n from public.partner_support_attachments`)
    );
    assert.equal(seen.rows[0].n, 1, 'the caller sees their own upload');
  } finally {
    await portal.close();
  }
});

test('notification preferences default on, persist a change, and stay private', async () => {
  const portal = await portalDatabase();
  try {
    const { user, partner } = await seedPartner(portal, { code: 'PREFS01' });
    assert.deepEqual(await portal.rpc(user, 'get_my_partner_notification_preferences', []), {
      email_enabled: true,
      in_app_enabled: true,
      updated_at: null,
    }, 'a partner who never visited the page has the table defaults');

    const saved = await portal.rpc(user, 'update_my_partner_notification_preferences', [false, true]);
    assert.equal(saved.email_enabled, false);
    assert.notEqual(saved.updated_at, null);
    assert.deepEqual((await portal.rpc(user, 'get_my_partner_notification_preferences', [])), saved);

    const rows = await portal.query(`select count(*)::int n from public.partner_notification_preferences`);
    assert.equal(rows.rows[0].n, 1, 'one row per partner, upserted');

    assert.equal(
      (await portal.query(`select partner_id from public.partner_notification_preferences`)).rows[0].partner_id,
      partner,
      'keyed to the caller’s own partner row, which the function derived'
    );
  } finally {
    await portal.close();
  }
});

test('a paid payout notifies the partner, and the type filter is real', async () => {
  const portal = await portalDatabase();
  try {
    const { user } = await seedPartner(portal, { code: 'PAID01', paidPaise: 1_000_000 });
    await releaseDueEarnings(portal);
    const created = await portal.rpc(user, 'request_my_partner_payout', [150_000, 'upi', 'partner@okbank']);
    const paid = await portal.rpc(null, 'admin_mark_partner_payout_paid', [created.id, 'TXN-9931'], true);
    assert.equal(paid.status, 'paid');

    const feed = await portal.rpc(user, 'get_my_partner_notifications', [null, 25]);
    assert.equal(feed.unread_count, 1);
    assert.match(feed.items[0].title, /Payout completed/);
    assert.match(feed.items[0].body, /₹1500/, 'the amount is the ledger’s own');

    assert.equal((await portal.rpc(user, 'get_my_partner_notifications', ['payout', 25])).items.length, 1);
    assert.equal((await portal.rpc(user, 'get_my_partner_notifications', ['reward', 25])).items.length, 0);

    // Only the caller can mark their own rows; ids from elsewhere change none.
    assert.equal(await portal.rpc(user, 'mark_my_partner_notifications_read', [[created.id]]), 0);
    assert.equal((await portal.rpc(user, 'get_my_partner_notifications', [null, 25])).unread_count, 1);
    const ledger = await portal.query(`select status, paid_at, provider_reference from public.partner_payout_requests where id=$1`, [
      created.id,
    ]);
    assert.equal(ledger.rows[0].status, 'paid');
    assert.equal(ledger.rows[0].provider_reference, 'TXN-9931');

    // The hole this closes: the earning row is still `available_for_withdrawal`,
    // so a wallet that only sums rows would offer the same ₹1500 again — and the
    // ceiling check would allow it. It must do neither.
    const wallet = await portal.rpc(user, 'get_my_partner_earnings', [50, 0]);
    assert.equal(wallet.totals.cleared_paise, 150_000, 'the gross cleared figure is still visible');
    assert.equal(wallet.totals.available_paise, 0, 'and none of it is unspent');
    await assert.rejects(
      portal.rpc(user, 'request_my_partner_payout', [150_000, 'upi', 'partner@okbank']),
      /Withdrawal exceeds available balance/,
      'paid commission cannot be withdrawn a second time'
    );
  } finally {
    await portal.close();
  }
});

test('the asset library, the tier ladder and the leaderboard answer from their own tables', async () => {
  const portal = await portalDatabase();
  try {
    await portal.query(
      `insert into public.partner_marketing_assets(category,title,storage_path,mime_type,file_size_bytes,is_published,published_at)
       values ('social_graphic','Launch week story','social/launch.png','image/png',2400000,true,now()),
              ('banner','Website banner','web/banner.png','image/png',812000,true,now()),
              ('banner','Unpublished draft','web/draft.png','image/png',100,false,null)`
    );
    const { user, partner } = await seedPartner(portal, { code: 'ASSETS1', paidPaise: 1_000_000 });
    const assets = await portal.rpc(user, 'get_partner_marketing_assets', [null]);
    assert.equal(assets.length, 2, 'an unpublished row is not offered to a partner');
    assert.deepEqual(
      assets.map((row: any) => row.title).sort(),
      ['Launch week story', 'Website banner'],
      'both published titles are present, the draft is not'
    );
    const social = await portal.rpc(user, 'get_partner_marketing_assets', ['social_graphic']);
    assert.equal(social.length, 1);
    const categories = await portal.rpc(user, 'get_partner_marketing_asset_categories', []);
    assert.deepEqual(
      categories.sort((a: any, b: any) => a.category.localeCompare(b.category)),
      [
        { category: 'banner', asset_count: 1 },
        { category: 'social_graphic', asset_count: 1 },
      ],
      'the chips count published rows only'
    );

    // Levels: one active referral unlocks bronze, six unlock silver.
    const bronze = await portal.rpc(user, 'get_my_partner_levels', []);
    assert.equal(bronze.active_referrals, 1);
    assert.deepEqual(
      bronze.levels.map((row: any) => row.unlocked),
      [true, false, false, false]
    );
    // Silver unlocks at six active referrals — so five more customers, same partner.
    for (let index = 0; index < 5; index++) {
      await addReferral(portal, partner, 'ASSETS1', `assets1-extra-${index}`);
    }
    const more = await portal.rpc(user, 'get_my_partner_levels', []);
    assert.equal(more.active_referrals, 6, 'the count follows the referral table');
    assert.deepEqual(
      more.levels.map((row: any) => row.unlocked),
      [true, true, false, false],
      'bronze and silver unlock; gold (21) and platinum do not'
    );
    assert.equal(
      more.levels.filter((row: any) => row.unlocked).at(-1).commission_bps,
      1500,
      'the rate the pages quote is the tier table’s'
    );

    // Leaderboard: earnings decide rank, ties share it, my_rank is the caller’s.
    const { user: rich, partner: richPartner } = await seedPartner(portal, {
      code: 'BOARD01',
      paidPaise: 5_000_000,
    });
    // Two empty wallets, so the tie is a fact about the ranking and not a
    // single row nobody else shares.
    const { user: zeroUser } = await seedPartner(portal, { code: 'BOARD02' });
    await seedPartner(portal, { code: 'BOARD03' });
    const board = await portal.rpc(user, 'get_partner_leaderboard', [10]);
    assert.ok(Array.isArray(board.items) && board.items.length >= 2, 'every active partner is listed');
    const earnings = board.items.map((row: any) => row.earnings_paise);
    assert.deepEqual([...earnings].sort((a, b) => b - a), earnings, 'ordered by lifetime commission');
    assert.equal(
      board.items.some((row: any) => row.partner_id === richPartner && row.rank === 1),
      true,
      'the top earner is rank 1 (the board ranks partner records, not auth ids)'
    );
    const zeroRows = board.items.filter((row: any) => row.earnings_paise === 0);
    assert.ok(zeroRows.length >= 2, 'several partners have earned nothing');
    assert.equal(new Set(zeroRows.map((row: any) => row.rank)).size, 1, 'and they tie at one rank');
    const richBoard = await portal.rpc(rich, 'get_partner_leaderboard', [10]);
    assert.equal(richBoard.my_rank, 1, 'the top partner sees rank 1');
    const zeroBoard = await portal.rpc(zeroUser, 'get_partner_leaderboard', [10]);
    assert.ok(zeroBoard.my_rank > 1, `an empty wallet is ranked, not hidden (${zeroBoard.my_rank})`);
  } finally {
    await portal.close();
  }
});

test('a deployed generation with an approval status is honoured, not ignored', async () => {
  const portal = await portalDatabase({ deployedGeneration: true });
  try {
    const approved = await seedPartner(portal, { code: 'GEN001', paidPaise: 1_000_000 });
    const paused = await seedPartner(portal, { code: 'GEN002', status: 'rejected' });

    assert.equal(
      (await portal.rpc(approved.user, 'get_my_partner_earnings', [50, 0])).totals.lifetime_paise,
      150_000,
      'an approved partner still reads their wallet'
    );
    await assert.rejects(
      portal.rpc(paused.user, 'get_my_partner_earnings', [50, 0]),
      /Active Growth Partner required/,
      'a partner whose approval was revoked reads nothing, even with is_active still true'
    );

    // And the leaderboard, which filters the same way, must not rank them.
    const board = await portal.rpc(approved.user, 'get_partner_leaderboard', [50]);
    const rankedIds = board.items.map((row: any) => row.partner_id);
    assert.ok(rankedIds.includes(approved.partner), 'the approved partner is ranked');
    assert.ok(!rankedIds.includes(paused.partner), 'the revoked partner is not listed at all');
  } finally {
    await portal.close();
  }
});

test('private.is_trusted_server_or_admin() is created when missing and never replaced', async () => {
  // Where it is missing (a project built from this repository), the portal
  // migration supplies the minimum so the payout lifecycle can be operated at
  // all — and service_role is enough, as the ledger functions expect.
  const fresh = await portalDatabase();
  try {
    const exists = await fresh.query(
      `select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='private' and p.proname='is_trusted_server_or_admin'`
    );
    assert.equal(exists.rows.length, 1, 'installed by the follow-up migration');
    const { user } = await seedPartner(fresh, { code: 'GUARD01', paidPaise: 1_000_000 });
    assert.equal(await releaseDueEarnings(fresh), 1);
    await assert.rejects(
      fresh.rpc(user, 'release_partner_earnings', []),
      /Not authorized|permission denied/,
      'an authenticated caller may not release their own earnings — the grant and the predicate both refuse'
    );
  } finally {
    await fresh.close();
  }

  // Where it already exists, whatever it says is law: a project that decides
  // service_role is not enough must not have that overridden by this file.
  const strict = await portalDatabase();
  try {
    await strict.db.exec(
      `create or replace function private.is_trusted_server_or_admin() returns boolean
         language sql stable as $$ select false $$`
    );
    await strict.db.exec(MIGRATION('20260919120000_partner_portal_section_reads.sql'));
    const body = await strict.query(
      `select pg_get_functiondef(p.oid) as def from pg_proc p
         join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='private' and p.proname='is_trusted_server_or_admin'`
    );
    assert.match(body.rows[0].def, /select false/, 'the operator’s predicate survived the re-run');
    await assert.rejects(
      strict.rpc(null, 'release_partner_earnings', [], true),
      /Not authorized/,
      'and is the one actually enforced'
    );
  } finally {
    await strict.close();
  }
});

test('own-row RLS holds on the new tables, not just inside the RPCs', async () => {
  const portal = await portalDatabase();
  try {
    const a = await seedPartner(portal, { code: 'RLS001', paidPaise: 1_000_000 });
    const b = await seedPartner(portal, { code: 'RLS002', paidPaise: 2_000_000 });
    await portal.rpc(a.user, 'submit_my_partner_support_ticket', ['A subject', 'A message for the desk.', 'normal']);

    const visible = async (user: string, table: string): Promise<number> => {
      const result: any = await portal.local.asRequest({ sub: user, isAdmin: false }, (conn) =>
        conn.query(`select count(*)::int as n from public.${table}`)
      );
      return result.rows[0].n;
    };

    assert.equal(await visible(a.user, 'partner_earnings'), 1, 'own ledger row');
    assert.equal(await visible(a.user, 'partner_support_tickets'), 1, 'own ticket');
    assert.equal(await visible(b.user, 'partner_earnings'), 1, 'and only their own');
    assert.equal(await visible(b.user, 'partner_notifications'), 0);

    // The definitions are SELECT-only for `authenticated`: writes need an RPC.
    for (const table of ['partner_earnings', 'partner_payout_requests', 'partner_support_tickets']) {
      const grants = await portal.query(
        `select privilege_type from information_schema.role_table_grants
          where table_name=$1 and grantee='authenticated'`,
        [table]
      );
      assert.deepEqual(
        [...new Set(grants.rows.map((row: any) => row.privilege_type))],
        ['SELECT'],
        `${table} is readable and nothing else`
      );
    }

    // An anon caller has no partner row, so every function refuses before it
    // could read anything (never "empty result", which would look like zero).
    for (const [fn, args] of [
      ['get_my_partner_earnings', [50, 0]],
      ['get_my_partner_payout_requests', [25, 0]],
      ['get_my_partner_support_tickets', [25, null]],
    ] as const) {
      await assert.rejects(
        portal.rpc(null, fn, [...args]),
        /permission denied|Active Growth Partner required|does not exist/i,
        `${fn} must not answer an anonymous caller with data`
      );
    }
  } finally {
    await portal.close();
  }
});
