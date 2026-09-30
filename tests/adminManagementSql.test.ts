// ============================================================================
// Admin & Manager management — the SQL that decides what a staff account may
// see and do, run as Postgres (PGlite) against the real migration chain.
//
// `tests/adminRoutesApi.test.ts` pins the HTTP surface and the role gating in
// `server/adminRoutes.ts`. Neither can prove the DATABASE enforces the rules the
// panel claims: that a manager cannot read another territory, that nobody but a
// super admin can export or delete, that the Aadhaar number is only readable by
// a super admin, that a ban needs a reason, that a payout needs a UTR, or that
// every one of those actions is written to partner_audit_logs. Those promises
// live in 20261101000000_admin_management_core.sql and
// 20261101000100_admin_partner_operations.sql, so they are tested here.
//
// Callers are simulated the way the local gateway does it: `asRequest()` sets
// `request.jwt.claim.sub` and `app.is_admin`, and `set role` picks the database
// role (service_role for the mock admin flag). A super admin is therefore a real
// super admin as far as the SQL is concerned.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalDatabase, LOCAL_GROWTH_CHAIN } from '../server/localSupabase';

interface AdminDb {
  local: any;
  db: any;
  rpc: (actor: string | null, name: string, args?: unknown[], options?: { admin?: boolean; role?: string }) => Promise<any>;
  query: (sql: string, params?: unknown[]) => Promise<any>;
  close: () => Promise<void>;
}

async function adminDatabase(): Promise<AdminDb> {
  const local = await createLocalDatabase();
  const db = local.db;
  const rpc: AdminDb['rpc'] = (actor, name, args = [], options = {}) =>
    local.asRequest({ sub: actor, isAdmin: options.admin ?? false }, async (conn: any) => {
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

/** A staff account: auth user + profiles row + admin_members row. */
async function seedAdmin(
  portal: AdminDb,
  options: { email: string; role: 'super_admin' | 'admin' | 'area_manager' | 'sub_admin'; area?: string | null; active?: boolean }
): Promise<string> {
  const { db } = portal;
  const inserted = await db.query(
    `insert into auth.users(id,email,encrypted_password,email_confirmed_at,raw_app_meta_data)
     values (gen_random_uuid(), $1, 'test-only', now(), '{}'::jsonb) returning id`,
    [options.email]
  );
  const userId = inserted.rows[0].id;
  await db.query(`insert into public.profiles(id, full_name, email) values ($1,$2,$3) on conflict (id) do nothing`, [
    userId,
    options.email.split('@')[0],
    options.email,
  ]);
  await db.query(
    `insert into public.admin_members(user_id, email, full_name, role, work_area, is_active)
     values ($1,$2,$3,$4::public.admin_role,$5,$6)`,
    [userId, options.email, options.email.split('@')[0], options.role, options.area ?? null, options.active ?? true]
  );
  return userId;
}

/** A partner with a territory, optionally with earnings/referrals. */
async function seedPartner(
  portal: AdminDb,
  options: { code: string; area?: string | null; active?: boolean; salons?: number; paidPaise?: number } = { code: 'ADMIN01' }
): Promise<{ userId: string; partnerId: string }> {
  const { db } = portal;
  const user = await db.query(
    `insert into auth.users(id,email,encrypted_password,email_confirmed_at)
     values (gen_random_uuid(), $1, 'test-only', now()) returning id`,
    [`${options.code.toLowerCase()}@partner.example`]
  );
  const userId = user.rows[0].id;
  // The chain's handle_new_user() trigger already created the profile row for
  // this auth user, so this is an update of the contact details, not an insert.
  await db.query(
    `insert into public.profiles(id, full_name, email, phone_number) values ($1,$2,$3,$4)
     on conflict (id) do update set full_name = excluded.full_name, email = excluded.email, phone_number = excluded.phone_number`,
    [userId, `Partner ${options.code}`, `${options.code.toLowerCase()}@partner.example`, '9876543210']
  );
  const partner = await db.query(
    `insert into public.growth_partners(user_id, referral_code, is_active, status, work_area)
     values ($1,$2,$3,'active',$4) returning id`,
    [userId, options.code, options.active ?? true, options.area ?? null]
  );
  const partnerId = partner.rows[0].id;
  for (let index = 0; index < (options.salons ?? 0); index++) {
    const referred = await db.query(
      `insert into auth.users(id,email,encrypted_password,email_confirmed_at)
       values (gen_random_uuid(), $1, 'test-only', now()) returning id`,
      [`${options.code.toLowerCase()}-salon-${index}@example.com`]
    );
    await db.query(
      // A completed onboarding row has BOTH timestamps (the chain's own CHECK).
      `insert into public.growth_onboarding(user_id, growth_partner_id, referral_code, status, linked_at, template_started_at, template_completed_at)
       values ($1,$2,$3,'template_completed', now() - interval '4 days', now() - interval '3 days', now())`,
      [referred.rows[0].id, userId, options.code]
    );
  }
  if (options.paidPaise) {
    await db.query(
      // Cleared eight days ago: the table's own CHECK holds an
      // 'available_for_withdrawal' row until the 7-day clearance has elapsed.
      `insert into public.partner_earnings(partner_id, source_key, earning_type, status, amount_paise, earned_at, payment_cleared_at, available_at)
       values ($1,$2,'recurring_subscription_commission','available_for_withdrawal',$3,
               now() - interval '8 days', now() - interval '8 days', now() - interval '1 day')`,
      [partnerId, `${options.code}-invoice`, options.paidPaise]
    );
  }
  return { userId, partnerId };
}

// ---------------------------------------------------------------------------
// 1. Access
// ---------------------------------------------------------------------------
test('get_my_admin_access reports the role from admin_members, not the request', async () => {
  const portal = await adminDatabase();
  try {
    await seedAdmin(portal, { email: 'boss@nexora.example', role: 'super_admin' });
    const managerUser = await seedAdmin(portal, { email: 'jhotwara@nexora.example', role: 'area_manager', area: 'Jhotwara' });

    const anonymous = await portal.rpc(null, 'get_my_admin_access', []);
    assert.equal(anonymous.is_admin, false, 'a signed-out caller is not an admin');

    const manager = await portal.rpc(managerUser, 'get_my_admin_access', []);
    assert.deepEqual(manager, {
      is_admin: true,
      role: 'area_manager',
      work_area: 'Jhotwara',
      can_manage_money: false,
    });
    assert.equal(manager.can_manage_money, false, 'a manager cannot move money');

    // An inactive member row is not an admin (suspension takes effect at once).
    await portal.query(`update public.admin_members set is_active = false where user_id = $1`, [managerUser]);
    assert.equal((await portal.rpc(managerUser, 'get_my_admin_access', [])).is_admin, false);
    await portal.query(`update public.admin_members set is_active = true where user_id = $1`, [managerUser]);

    // The legacy `app.is_admin` flag (a local/mock super admin) still works.
    const legacy = await portal.rpc(null, 'get_my_admin_access', [], { admin: true });
    assert.equal(legacy.role, 'super_admin');
    assert.equal(legacy.can_manage_money, true);
  } finally {
    await portal.close();
  }
});

// ---------------------------------------------------------------------------
// 2. Onboarding links + the public submission
// ---------------------------------------------------------------------------
test('an onboarding link is single-use, revocable and validates the candidate payload', async () => {
  const portal = await adminDatabase();
  try {
    const boss = await seedAdmin(portal, { email: 'boss@nexora.example', role: 'super_admin' });
    const managerUser = await seedAdmin(portal, { email: 'manager@nexora.example', role: 'area_manager', area: 'Jhotwara' });

    await assert.rejects(
      portal.rpc(managerUser, 'admin_create_manager_onboarding_link', ['Malviya Nagar', 'area_manager', 7, 1, null]),
      /Super Admin access required/,
      'a manager cannot mint onboarding links'
    );

    const link = await portal.rpc(boss, 'admin_create_manager_onboarding_link', ['Malviya Nagar', 'area_manager', 7, 1, 'for Anil']);
    assert.ok(link.token && link.token.length > 20, 'a long random token');
    assert.equal(link.work_area, 'Malviya Nagar');

    // What the public form sees.
    const info = await portal.rpc(null, 'get_manager_onboarding_link', [link.token]);
    assert.deepEqual(
      { valid: info.valid, work_area: info.work_area, role: info.role },
      { valid: true, work_area: 'Malviya Nagar', role: 'area_manager' },
      'an anonymous caller only learns the area and role'
    );

    // Validation: every rule names the offending field in its message.
    await assert.rejects(
      portal.rpc(null, 'submit_manager_onboarding_application', [link.token, {}]),
      /Full name is required/
    );
    await assert.rejects(
      portal.rpc(null, 'submit_manager_onboarding_application', [
        link.token,
        { full_name: 'Anil Kumar', email: 'not-an-email', phone: '9876543210' },
      ]),
      /valid email/
    );
    await assert.rejects(
      portal.rpc(null, 'submit_manager_onboarding_application', [
        link.token,
        { full_name: 'Anil Kumar', email: 'anil@example.com', phone: '98765' },
      ]),
      /valid 10-digit phone/
    );
    await assert.rejects(
      portal.rpc(null, 'submit_manager_onboarding_application', [
        link.token,
        { full_name: 'Anil Kumar', email: 'anil@example.com', phone: '9876543210', aadhaar_number: '1234' },
      ]),
      /Aadhaar number must be exactly 12 digits/
    );
    await assert.rejects(
      portal.rpc(null, 'submit_manager_onboarding_application', [
        link.token,
        { full_name: 'Anil Kumar', email: 'anil@example.com', phone: '9876543210', pan_number: 'ABCDE123' },
      ]),
      /PAN must look like ABCDE1234F/
    );

    const submitted = await portal.rpc(null, 'submit_manager_onboarding_application', [
      link.token,
      {
        full_name: 'Anil Kumar',
        email: 'Anil@Example.com',
        phone: '+91 98765 43210',
        whatsapp: '9876543211',
        aadhaar_number: '1234 5678 9012',
        pan_number: 'abcde1234f',
        bank_account_number: '0011 2233 4455',
        bank_ifsc: 'hdfc0001234',
      },
    ]);
    assert.equal(submitted.status, 'pending');
    assert.equal(submitted.work_area, 'Malviya Nagar', 'the area comes from the link');

    const stored = await portal.query(
      `select email, phone, aadhaar_number, pan_number, bank_ifsc, bank_account_number, status, role::text as role
     from public.manager_onboarding_applications where id = $1`,
      [submitted.id]
    );
    assert.equal(stored.rows[0].email, 'anil@example.com', 'email is normalised');
    assert.equal(stored.rows[0].phone, '919876543210', 'a +91 number is stored as digits');
    assert.equal(stored.rows[0].aadhaar_number, '123456789012', 'spaces are stripped before the 12-digit check');
    assert.equal(stored.rows[0].pan_number, 'ABCDE1234F', 'PAN is upper-cased');
    assert.equal(stored.rows[0].bank_ifsc, 'HDFC0001234');
    assert.equal(stored.rows[0].status, 'pending');

    // A second submission for the same email is refused while one is pending.
    // (A fresh link, because the first one was single-use.)
    const secondLink = await portal.rpc(boss, 'admin_create_manager_onboarding_link', ['Malviya Nagar', 'area_manager', 7, 5, null]);
    await assert.rejects(
      portal.rpc(null, 'submit_manager_onboarding_application', [
        secondLink.token,
        { full_name: 'Anil Kumar', email: 'anil@example.com', phone: '9876543210' },
      ]),
      /already under review/
    );

    // The link was single-use: the next attempt is refused, and the public read
    // reports why.
    await assert.rejects(
      portal.rpc(null, 'submit_manager_onboarding_application', [
        link.token,
        { full_name: 'Someone Else', email: 'someone@example.com', phone: '9876500000' },
      ]),
      /already been used/
    );
    const afterUse = await portal.rpc(null, 'get_manager_onboarding_link', [link.token]);
    assert.equal(afterUse.valid, false);
    assert.equal(afterUse.reason, 'already_used');

    // Revoking is super-admin only.
    const second = await portal.rpc(boss, 'admin_create_manager_onboarding_link', ['Jhotwara', 'sub_admin', 7, 5, null]);
    await assert.rejects(portal.rpc(managerUser, 'admin_revoke_manager_onboarding_link', [second.id]), /Super Admin access required/);
    const revoked = await portal.rpc(boss, 'admin_revoke_manager_onboarding_link', [second.id]);
    assert.equal(revoked.is_active, false);
    assert.equal((await portal.rpc(null, 'get_manager_onboarding_link', [second.token])).reason, 'revoked');

    // A manager may not list or read applications; a super admin may.
    await assert.rejects(portal.rpc(managerUser, 'admin_list_manager_applications', ['pending', 50]), /Super Admin access required/);
    const listed = await portal.rpc(boss, 'admin_list_manager_applications', ['pending', 50]);
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0].aadhaar_last4, '9012', 'the list exposes only the last four digits by default');
    assert.equal(listed.items[0].aadhaar_number, '123456789012', 'a super admin reviewing documents sees the full number');
  } finally {
    await portal.close();
  }
});

test('approving an application creates the admin member with the link’s territory and role', async () => {
  const portal = await adminDatabase();
  try {
    const boss = await seedAdmin(portal, { email: 'boss@nexora.example', role: 'super_admin' });
    const link = await portal.rpc(boss, 'admin_create_manager_onboarding_link', ['Vaishali Nagar', 'sub_admin', 7, 1, null]);
    const submitted = await portal.rpc(null, 'submit_manager_onboarding_application', [
      link.token,
      { full_name: 'Neha Sharma', email: 'neha@nexora.example', phone: '9876500000' },
    ]);

    // The Auth user is created by the SERVER (service role) before this call;
    // here the id is supplied the same way the route supplies it.
    const authUser = await portal.query(
      `insert into auth.users(id,email,encrypted_password,email_confirmed_at) values (gen_random_uuid(),'neha@nexora.example','x',now()) returning id`
    );
    const newUserId = authUser.rows[0].id;

    const approved = await portal.rpc(boss, 'admin_review_manager_application', [submitted.id, true, 'documents verified', newUserId]);
    assert.equal(approved.status, 'approved');
    assert.equal(approved.role, 'sub_admin');
    assert.equal(approved.work_area, 'Vaishali Nagar');

    const member = await portal.query(`select role::text as role, work_area, is_active from public.admin_members where user_id = $1`, [newUserId]);
    assert.deepEqual(member.rows[0], { role: 'sub_admin', work_area: 'Vaishali Nagar', is_active: true });

    // The new account really is scoped: it can read its own access...
    const access = await portal.rpc(newUserId, 'get_my_admin_access', []);
    assert.deepEqual(
      { role: access.role, work_area: access.work_area, can_manage_money: access.can_manage_money },
      { role: 'sub_admin', work_area: 'Vaishali Nagar', can_manage_money: false }
    );
    // ...and cannot approve anything else (only a super admin reviews).
    await assert.rejects(portal.rpc(newUserId, 'admin_review_manager_application', [submitted.id, true, null, newUserId]), /Super Admin access required/);

    // Re-reviewing the same application is refused, not silently re-applied.
    await assert.rejects(portal.rpc(boss, 'admin_review_manager_application', [submitted.id, true, null, newUserId]), /already approved/);

    // Audit trail: submission + approval, with the actor recorded.
    const audit = await portal.query(
      `select action, actor_role, work_area from public.partner_audit_logs where target_id = $1 order by id`,
      [submitted.id]
    );
    assert.deepEqual(
      audit.rows.map((row: any) => row.action),
      ['manager_application_submitted', 'manager_application_approved']
    );
    assert.equal(audit.rows[1].actor_role, 'super_admin');
    assert.equal(audit.rows[1].work_area, 'Vaishali Nagar');
  } finally {
    await portal.close();
  }
});

// ---------------------------------------------------------------------------
// 3. Territory scoping — the core of RBAC
// ---------------------------------------------------------------------------
test('a manager sees only their own territory; a super admin sees every area', async () => {
  const portal = await adminDatabase();
  try {
    await seedAdmin(portal, { email: 'boss@nexora.example', role: 'super_admin' });
    const jhotwara = await seedAdmin(portal, { email: 'jhotwara@nexora.example', role: 'area_manager', area: 'Jhotwara' });
    const noArea = await seedAdmin(portal, { email: 'floating@nexora.example', role: 'area_manager', area: null });

    await seedPartner(portal, { code: 'JHO001', area: 'Jhotwara', salons: 1 });
    await seedPartner(portal, { code: 'MAN001', area: 'Malviya Nagar', salons: 2 });
    await seedPartner(portal, { code: 'NOW001', area: null });

    const scoped = await portal.rpc(jhotwara, 'admin_partner_directory', [null, null, null, 50, 0, false]);
    assert.equal(scoped.work_area, 'Jhotwara');
    assert.deepEqual(scoped.items.map((row: any) => row.referral_code), ['JHO001'], 'only the manager’s territory');
    assert.equal(scoped.is_super_admin, false);

    // Asking for another area does not widen a manager's scope: it is ignored.
    const override = await portal.rpc(jhotwara, 'admin_partner_directory', ['Malviya Nagar', null, null, 50, 0, false]);
    assert.deepEqual(override.items.map((row: any) => row.referral_code), ['JHO001']);

    // A manager without an assignment is refused with actionable copy.
    await assert.rejects(portal.rpc(noArea, 'admin_partner_directory', [null, null, null, 50, 0, false]), /No work area is assigned/);

    const boss = await portal.rpc(null, 'admin_partner_directory', [null, null, null, 50, 0, false], { admin: true });
    const codes = boss.items.map((row: any) => row.referral_code).sort();
    assert.deepEqual(codes, ['JHO001', 'MAN001', 'NOW001'], 'the super admin sees every partner');
    assert.equal(boss.is_super_admin, true);
    assert.equal(boss.can_manage_money, true);

    // Metrics and milestone forecasting ride along with each row.
    const malviya = boss.items.find((row: any) => row.referral_code === 'MAN001');
    assert.equal(malviya.onboarded_salons, 2);
    assert.deepEqual(
      malviya.milestones.map((milestone: any) => [milestone.code, milestone.remaining]),
      [['starter', 1], ['growth', 4], ['scale', 10]],
      'the first bonus needs one more salon'
    );
  } finally {
    await portal.close();
  }
});

// ---------------------------------------------------------------------------
// 4. Moderation
// ---------------------------------------------------------------------------
test('moderation: a ban needs a reason, a manager cannot delete, and every action is audited', async () => {
  const portal = await adminDatabase();
  try {
    const boss = await seedAdmin(portal, { email: 'boss@nexora.example', role: 'super_admin' });
    const jhotwara = await seedAdmin(portal, { email: 'jhotwara@nexora.example', role: 'area_manager', area: 'Jhotwara' });
    const { partnerId } = await seedPartner(portal, { code: 'JHO002', area: 'Jhotwara' });
    const { partnerId: otherId } = await seedPartner(portal, { code: 'MAN002', area: 'Malviya Nagar' });

    await assert.rejects(portal.rpc(jhotwara, 'admin_set_partner_state', [partnerId, 'ban', null, null]), /reason is required/);

    const banned = await portal.rpc(jhotwara, 'admin_set_partner_state', [partnerId, 'ban', 'Fraudulent referrals', null]);
    assert.equal(banned.is_active, false);
    assert.equal(banned.ban_reason, 'Fraudulent referrals');
    assert.ok(banned.banned_at, 'the ban timestamp is set');

    // Cannot moderate outside the territory, and cannot delete even inside it.
    await assert.rejects(portal.rpc(jhotwara, 'admin_set_partner_state', [otherId, 'ban', 'x', null]), /outside your work area/);
    await assert.rejects(portal.rpc(jhotwara, 'admin_set_partner_state', [partnerId, 'soft_delete', 'cleanup', null]), /Only a Super Admin/);

    const restored = await portal.rpc(jhotwara, 'admin_set_partner_state', [partnerId, 'unban', null, null]);
    assert.equal(restored.is_active, true);
    assert.equal(restored.banned_at, null);

    const deleted = await portal.rpc(boss, 'admin_set_partner_state', [partnerId, 'soft_delete', 'duplicate profile', null], { admin: true });
    assert.ok(deleted.deleted_at, 'soft deleted');
    assert.equal(deleted.is_active, false, 'a deleted partner loses portal access');

    // Soft delete is invisible by default, and visible only to a super admin.
    const afterDelete = await portal.rpc(boss, 'admin_partner_directory', [null, null, null, 50, 0, false], { admin: true });
    assert.equal(afterDelete.items.some((row: any) => row.referral_code === 'JHO002'), false, 'gone from the default view');
    const withDeleted = await portal.rpc(boss, 'admin_partner_directory', [null, null, null, 50, 0, true], { admin: true });
    assert.equal(withDeleted.items.some((row: any) => row.referral_code === 'JHO002'), true);

    const restoredRow = await portal.rpc(boss, 'admin_set_partner_state', [partnerId, 'restore', null, null], { admin: true });
    assert.equal(restoredRow.deleted_at, null);
    assert.equal(restoredRow.status, 'approved', 'restoring re-approves the partner');

    // Territory assignment is super-admin only, and audited.
    await assert.rejects(portal.rpc(jhotwara, 'admin_assign_partner_area', [otherId, 'Jhotwara']), /Super Admin access required/);
    await portal.rpc(boss, 'admin_assign_partner_area', [otherId, 'Jhotwara'], { admin: true });

    const actions = await portal.query(
      `select action, actor_role, reason from public.partner_audit_logs where target_id = $1 order by id`,
      [partnerId]
    );
    assert.deepEqual(
      actions.rows.map((row: any) => row.action),
      ['partner_ban', 'partner_unban', 'partner_soft_delete', 'partner_restore'],
      'one row per action — the trigger is suppressed while the RPC writes its own'
    );
    assert.equal(actions.rows[0].reason, 'Fraudulent referrals');
    assert.equal(actions.rows[0].actor_role, 'area_manager');
  } finally {
    await portal.close();
  }
});

// ---------------------------------------------------------------------------
// 5. Money: bank details + payouts
// ---------------------------------------------------------------------------
test('bank details and payouts are admin-only, need a UTR, and never store secrets in the audit trail', async () => {
  const portal = await adminDatabase();
  try {
    const _boss = await seedAdmin(portal, { email: 'boss@nexora.example', role: 'super_admin' });
    const adminUser = await seedAdmin(portal, { email: 'ops@nexora.example', role: 'admin', area: 'Jhotwara' });
    const managerUser = await seedAdmin(portal, { email: 'jhotwara@nexora.example', role: 'area_manager', area: 'Jhotwara' });
    const { partnerId, userId } = await seedPartner(portal, { code: 'JHO003', area: 'Jhotwara', paidPaise: 400_000 });

    // A manager sees a masked account, never the number.
    const managerView = await portal.rpc(managerUser, 'admin_partner_directory', [null, null, null, 50, 0, false]);
    assert.equal(managerView.can_manage_money, false);
    assert.equal(managerView.items[0].bank_details, null, 'no bank block at all for a manager without money rights');

    await assert.rejects(
      portal.rpc(managerUser, 'admin_update_partner_bank_details', [partnerId, { payout_upi_id: 'jho@okbank' }]),
      /Admin access required to edit payout details/
    );

    const saved = await portal.rpc(adminUser, 'admin_update_partner_bank_details', [
      partnerId,
      { payout_method: 'upi', payout_account_number: '123456789012', payout_ifsc: 'HDFC0001234', payout_upi_id: 'jho@okbank' },
    ]);
    assert.equal(saved.payout_ifsc, 'HDFC0001234');
    assert.equal(saved.payout_account_number, '123456789012');

    const audit = await portal.query(
      `select details from public.partner_audit_logs where action = 'partner_bank_details_updated' order by id desc limit 1`
    );
    assert.equal(audit.rows[0].details.account_last4, '9012');
    assert.doesNotMatch(
      JSON.stringify(audit.rows[0].details),
      /123456789012/,
      'the full account number is never written to the audit trail'
    );

    // A payout request, then the desk processing it.
    await portal.query(
      `insert into public.partner_payout_requests(partner_id, amount_paise, payout_method, destination_label)
       values ($1, 100000, 'upi', 'jho@okbank')`,
      [partnerId]
    );
    const queue = await portal.rpc(adminUser, 'admin_list_partner_payouts', ['open', null, 50]);
    assert.equal(queue.items.length, 1);
    const requestId = queue.items[0].id;
    assert.equal(queue.items[0].partner_code, 'JHO003');

    await assert.rejects(portal.rpc(managerUser, 'admin_process_partner_payout', [requestId, 'mark_paid', 'UTR123456', null]), /Admin access required to process payouts/);
    await assert.rejects(portal.rpc(adminUser, 'admin_process_partner_payout', [requestId, 'mark_paid', 'UTR1', null]), /at least 6 characters/);
    await assert.rejects(portal.rpc(adminUser, 'admin_process_partner_payout', [requestId, 'reject', null, null]), /reason is required/);

    const paid = await portal.rpc(adminUser, 'admin_process_partner_payout', [requestId, 'mark_paid', 'UTR123456', null]);
    assert.equal(paid.status, 'paid');
    assert.equal(paid.provider_reference, 'UTR123456');
    assert.ok(paid.paid_at);
    await assert.rejects(
      portal.rpc(adminUser, 'admin_process_partner_payout', [requestId, 'mark_paid', 'UTR999999', null]),
      /already paid/,
      'a paid request cannot be paid twice'
    );

    const notification = await portal.query(
      `select notification_type, title from public.partner_notifications where partner_id = $1 order by created_at desc limit 1`,
      [partnerId]
    );
    assert.equal(notification.rows[0].notification_type, 'payout', 'the partner is told');
    assert.match(notification.rows[0].title, /paid/i);

    const payoutAudit = await portal.query(
      `select action, actor_role, details from public.partner_audit_logs where action = 'partner_payout_paid' order by id desc limit 1`
    );
    assert.equal(payoutAudit.rows[0].details.utr, 'UTR123456');
    assert.equal(payoutAudit.rows[0].actor_role, 'admin');

    // The partner's own portal still reads the same payout row (one store).
    const mine = await portal.rpc(userId, 'get_my_partner_payout_requests', [25, 0]);
    assert.equal(mine.items[0].status, 'paid');
  } finally {
    await portal.close();
  }
});

// ---------------------------------------------------------------------------
// 6. Export + audit trail read
// ---------------------------------------------------------------------------
test('only a Super Admin can export, and the export is recorded', async () => {
  const portal = await adminDatabase();
  try {
    const _boss = await seedAdmin(portal, { email: 'boss@nexora.example', role: 'super_admin' });
    const adminUser = await seedAdmin(portal, { email: 'ops@nexora.example', role: 'admin', area: 'Jhotwara' });
    await seedPartner(portal, { code: 'EXP001', area: 'Jhotwara' });

    await assert.rejects(portal.rpc(adminUser, 'admin_export_partner_directory', [null, null]), /Only a Super Admin can export partner data/);

    const exported = await portal.rpc(null, 'admin_export_partner_directory', [null, null], { admin: true });
    assert.equal(exported.items.length, 1);
    const log = await portal.query(`select action, actor_role from public.partner_audit_logs where action = 'partner_directory_exported'`);
    assert.equal(log.rows.length, 1);
    assert.equal(log.rows[0].actor_role, 'super_admin');

    // A manager reads only their own territory's trail.
    const jhotwara = await seedAdmin(portal, { email: 'jhotwara@nexora.example', role: 'area_manager', area: 'Jhotwara' });
    const { partnerId } = await seedPartner(portal, { code: 'JHO004', area: 'Jhotwara' });
    await portal.rpc(jhotwara, 'admin_set_partner_state', [partnerId, 'unapprove', null, null]);
    const own = await portal.rpc(jhotwara, 'admin_list_audit_logs', [null, null, 100]);
    assert.equal(own.items.every((row: any) => row.work_area === 'Jhotwara'), true, 'only their territory');

    // A single-territory manager cannot read the super admin's export row, but
    // the super admin can read everything.
    assert.equal(own.items.some((row: any) => row.action === 'partner_directory_exported'), false);
    const all = await portal.rpc(null, 'admin_list_audit_logs', [null, null, 200], { admin: true });
    assert.equal(all.items.some((row: any) => row.action === 'partner_directory_exported'), true);
  } finally {
    await portal.close();
  }
});

// ---------------------------------------------------------------------------
// 7. Install safety
// ---------------------------------------------------------------------------
test('the admin migrations install on the schema this repository ships, and are idempotent', async () => {
  const portal = await adminDatabase();
  try {
    const tables = await portal.query(
      `select tablename from pg_tables where schemaname='public' and tablename in
        ('admin_members','manager_onboarding_links','manager_onboarding_applications','partner_audit_logs','partner_reward_tiers','partner_rewards')
       order by tablename`
    );
    assert.deepEqual(tables.rows.map((row: any) => row.tablename), [
      'admin_members',
      'manager_onboarding_applications',
      'manager_onboarding_links',
      'partner_audit_logs',
      'partner_reward_tiers',
      'partner_rewards',
    ]);

    const tiers = await portal.query(`select code, threshold_paid_referrals, bonus_paise from public.partner_reward_tiers order by sort_order`);
    assert.deepEqual(tiers.rows, [
      { code: 'starter', threshold_paid_referrals: 3, bonus_paise: 200000 },
      { code: 'growth', threshold_paid_referrals: 6, bonus_paise: 500000 },
      { code: 'scale', threshold_paid_referrals: 12, bonus_paise: 1200000 },
    ]);

    // The audit trail is append-only: no client can insert, update or delete.
    const grants = await portal.query(
      `select has_table_privilege('authenticated','public.partner_audit_logs','SELECT') as can_read,
              has_table_privilege('authenticated','public.partner_audit_logs','INSERT') as can_insert,
              has_table_privilege('authenticated','public.partner_audit_logs','UPDATE') as can_update,
              has_table_privilege('authenticated','public.partner_audit_logs','DELETE') as can_delete`
    );
    assert.deepEqual(grants.rows[0], { can_read: true, can_insert: false, can_update: false, can_delete: false });

    // Re-applying both files is a no-op (they must be safe to re-run on the
    // user's project, which is how they will be applied).
    const core = LOCAL_GROWTH_CHAIN.filter((file) => file.startsWith('20261101'));
    assert.equal(core.length, 2);
    for (const file of core) {
      const sql = (await import('node:fs')).readFileSync(`supabase/migrations/${file}`, 'utf8');
      await portal.db.exec(sql);
    }
    const stillThere = await portal.query(`select count(*)::int as n from public.manager_onboarding_applications`);
    assert.equal(stillThere.rows[0].n, 0);
  } finally {
    await portal.close();
  }
});
