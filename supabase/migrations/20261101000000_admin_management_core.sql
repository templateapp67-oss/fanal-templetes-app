-- Admin & Manager management core.
--
-- Adds the RBAC layer this repository never had: who is an admin, what a
-- territory-scoped manager may read and write, how a candidate is onboarded
-- through a public link with documents, and the audit trail every moderation or
-- money action is written to.
--
-- Deliberately built ON TOP of the objects that already exist instead of beside
-- them: `growth_partners` / `profiles` are the partner identity,
-- `partner_account_settings` already stores bank + UPI payout details, and
-- `partner_payout_requests` is the payout queue. A second `partners` /
-- `partner_bank_details` schema would have to be dual-written by the portal that
-- is already live, so the names from the specification map onto the existing
-- tables (documented in ADMIN_MANAGEMENT_SETUP.md).
--
-- Three rules this file enforces everywhere:
--   • super_admin   → everything, including delete/export.
--   • admin/area_manager/sub_admin → read + operational writes, scoped to
--     `work_area`, and never able to DELETE.
--   • every moderation / money action lands in partner_audit_logs, including
--     when it is taken by a path that forgot to log (there is a trigger too).

begin;

-- -----------------------------------------------------------------------------
-- 0. Prerequisites the admin layer keys on
--    `growth_partners.id` is the surrogate identity every directory row, every
--    moderation action and every reward row uses. Projects created before
--    `20260928_partner_referrals_table.sql` only have `user_id` there, and the
--    foreign key on `partner_rewards` then fails with
--      42703: column "id" referenced in foreign key constraint does not exist
--    So the column is created and backfilled here with the exact shape that
--    migration uses (a no-op once it exists), and the portal tables this file
--    reads are reported BY NAME if they are missing, instead of surfacing as a
--    confusing "relation does not exist" a hundred lines later.
-- -----------------------------------------------------------------------------
do $prereq$
declare
  v_missing text;
  v_id_attnum smallint;
  v_has_unique boolean;
begin
  select string_agg(t, ', ' order by t) into v_missing
    from unnest(array[
      'growth_partners', 'growth_onboarding', 'growth_partner_applications',
      'profiles', 'partner_account_settings', 'partner_earnings',
      'partner_notifications', 'partner_payout_requests', 'partner_referrals'
    ]) as t
   where to_regclass('public.' || t) is null;

  if v_missing is not null then
    raise exception
      'The Growth Partner / partner-portal tables must exist first. Missing: %. Apply the 20260928_partner_referrals_table.sql and 20260930* portal migrations, then run this file again.', v_missing
      using errcode = '42P01';
  end if;

  execute 'alter table public.growth_partners add column if not exists id uuid default gen_random_uuid()';
  execute 'alter table public.growth_partners alter column id set default gen_random_uuid()';
  execute 'update public.growth_partners set id = gen_random_uuid() where id is null';
  execute 'alter table public.growth_partners alter column id set not null';

  select a.attnum into v_id_attnum
    from pg_attribute a
   where a.attrelid = 'public.growth_partners'::regclass
     and a.attname = 'id' and not a.attisdropped;

  select exists (
    select 1 from pg_index i
     where i.indrelid = 'public.growth_partners'::regclass
       and i.indisunique and i.indisvalid and i.indpred is null
       and i.indnatts = 1 and i.indkey[0] = v_id_attnum
  ) into v_has_unique;

  if not v_has_unique then
    execute 'create unique index growth_partners_id_key on public.growth_partners(id)';
  end if;
end $prereq$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Roles
-- ─────────────────────────────────────────────────────────────────────────────
do $$ begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'admin_role'
  ) then
    create type public.admin_role as enum ('super_admin', 'admin', 'area_manager', 'sub_admin');
  end if;
end $$;

create table if not exists public.admin_members (
  id uuid primary key default gen_random_uuid(),
  -- Null while a candidate is approved but their Auth user has not been linked
  -- yet (the server creates it during approval; see admin_review_manager_application).
  user_id uuid unique references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role public.admin_role not null default 'area_manager',
  -- Territory, e.g. 'Jhotwara', 'Vaishali Nagar', 'Malviya Nagar'. NULL or blank
  -- for a super admin, who is not scoped to one area.
  work_area text,
  phone text,
  whatsapp text,
  photo_path text,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists admin_members_email_key on public.admin_members (lower(email));
create index if not exists admin_members_area_idx on public.admin_members (work_area) where work_area is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Which admin is calling?
--
-- Two signals are accepted, in this order:
--   1. a JWT that carries `app_metadata.is_admin = true` (production) or the
--      local gateway's per-request GUC (a mock/local super admin);
--   2. a live `admin_members` row — the real source of truth.
-- Everything else is not an admin, and the helpers below are the ONLY place
-- that decision is made.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.current_admin_role() returns public.admin_role
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.admin_role;
  v_uid uuid := (select auth.uid());
  v_legacy text;
begin
  -- Local gateway: `app.is_admin` is set per request from the caller's JWT.
  v_legacy := coalesce(nullif(current_setting('app.is_admin', true), ''), 'false');
  if v_legacy = 'true' then
    return 'super_admin'::public.admin_role;
  end if;
  -- Production PostgREST populates request.jwt.claims from the verified JWT.
  begin
    if coalesce(
         nullif(current_setting('request.jwt.claims', true), '')::jsonb
           -> 'app_metadata' ->> 'is_admin', 'false'
       ) = 'true' then
      return 'super_admin'::public.admin_role;
    end if;
  exception when others then
    null;  -- no claims / not JSON: fall through to the table
  end;
  if v_uid is null then
    return null;
  end if;
  select am.role into v_role
    from public.admin_members am
   where am.user_id = v_uid and am.is_active
   limit 1;
  return v_role;
end $$;

create or replace function public.current_admin_area() returns text
language sql stable security definer set search_path = '' as $$
  select nullif(btrim(am.work_area), '')
    from public.admin_members am
   where am.user_id = (select auth.uid()) and am.is_active
   limit 1
$$;

create schema if not exists private;

create or replace function private.admin_role_of(p_user uuid) returns public.admin_role
language sql stable security definer set search_path = '' as $$
  select am.role from public.admin_members am
   where am.user_id = p_user and am.is_active
   limit 1
$$;

create or replace function private.is_admin_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.current_admin_role() is not null
$$;

create or replace function private.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.current_admin_role() = 'super_admin'::public.admin_role
$$;

-- Editing payout details and moving money is deliberately narrower than
-- "an admin": a territory manager reads the directory and runs moderation, but
-- a bank-detail change or a "mark paid" is admin/super_admin only. Widen here
-- (one place) if the business decides otherwise.
create or replace function private.can_manage_partner_money() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.current_admin_role() in ('super_admin'::public.admin_role, 'admin'::public.admin_role)
$$;

revoke all on function public.current_admin_role() from public, anon;
revoke all on function public.current_admin_area() from public, anon;
grant execute on function public.current_admin_role() to authenticated, service_role;
grant execute on function public.current_admin_area() to authenticated, service_role;
grant execute on function private.admin_role_of(uuid), private.is_admin_member(),
  private.is_super_admin(), private.can_manage_partner_money() to authenticated, service_role;

alter table public.admin_members enable row level security;
revoke all on public.admin_members from public, anon, authenticated;
grant select on public.admin_members to authenticated;
grant insert, update, delete on public.admin_members to service_role;

drop policy if exists admin_members_read_self_or_super on public.admin_members;
create policy admin_members_read_self_or_super on public.admin_members for select to authenticated
  using (user_id = (select auth.uid()) or private.is_super_admin());
drop policy if exists admin_members_super_write on public.admin_members;
create policy admin_members_super_write on public.admin_members for all to authenticated
  using (private.is_super_admin()) with check (private.is_super_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Territory + moderation on the existing partner table
--
-- `deleted_at` is a SOFT delete: the row, its referrals and its ledger stay
-- intact (they are financial records), the partner simply disappears from the
-- directory and the portal. `banned_at`/`ban_reason` record why access stopped.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.growth_partners add column if not exists work_area text;
alter table public.growth_partners add column if not exists deleted_at timestamptz;
alter table public.growth_partners add column if not exists banned_at timestamptz;
alter table public.growth_partners add column if not exists ban_reason text;
alter table public.growth_partners add column if not exists deleted_by uuid;
create index if not exists growth_partners_area_idx on public.growth_partners (work_area) where work_area is not null;
create index if not exists growth_partners_live_idx on public.growth_partners (is_active) where deleted_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Audit trail
--
-- Append-only by construction: no client gets INSERT, UPDATE or DELETE on it.
-- Only the security-definer helper below (called by the RPCs and the trigger)
-- writes rows, and nobody — super admin included — can rewrite history.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.partner_audit_logs (
  id bigserial primary key,
  actor_id uuid,
  actor_email text,
  actor_role text,
  action text not null,
  target_type text not null,
  target_id uuid,
  work_area text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists partner_audit_logs_target_idx on public.partner_audit_logs (target_type, target_id, created_at desc);
create index if not exists partner_audit_logs_area_idx on public.partner_audit_logs (work_area, created_at desc);
create index if not exists partner_audit_logs_created_idx on public.partner_audit_logs (created_at desc);

alter table public.partner_audit_logs enable row level security;
revoke all on public.partner_audit_logs from public, anon, authenticated;
grant select on public.partner_audit_logs to authenticated;
grant insert on public.partner_audit_logs to service_role;
grant usage, select on sequence public.partner_audit_logs_id_seq to service_role;

drop policy if exists partner_audit_logs_read on public.partner_audit_logs;
create policy partner_audit_logs_read on public.partner_audit_logs for select to authenticated
  using (
    private.is_super_admin()
    or (
      private.is_admin_member()
      and work_area is not null
      and work_area = public.current_admin_area()
    )
  );
-- No INSERT/UPDATE/DELETE policy exists on purpose: history is not writable
-- from a client session, not even by a super admin.

create or replace function private.log_partner_audit(
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_work_area text default null,
  p_reason text default null,
  p_details jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  begin
    v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    v_email := null;
  end;
  insert into public.partner_audit_logs(
    actor_id, actor_email, actor_role, action, target_type, target_id, work_area, reason, details
  ) values (
    (select auth.uid()), v_email, coalesce(public.current_admin_role()::text, 'system'),
    p_action, p_target_type, p_target_id, nullif(btrim(coalesce(p_work_area, '')), ''),
    nullif(btrim(coalesce(p_reason, '')), ''), coalesce(p_details, '{}'::jsonb)
  );
end $$;

create or replace function private.audit_growth_partner_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_area text := nullif(btrim(coalesce(v_new ->> 'work_area', '')), '');
begin
  -- A moderation RPC writes its own audit row (with the reason and the intent)
  -- and sets this transaction-local flag, so one action never produces two rows.
  if coalesce(current_setting('app.audit_suppressed', true), 'false') = 'true' then
    return new;
  end if;
  -- `to_jsonb(row)` is used instead of `new.status` so this trigger installs on
  -- every growth_partners generation, including one without the status column.
  if (v_old ->> 'status') is distinct from (v_new ->> 'status')
     or (v_old ->> 'is_active') is distinct from (v_new ->> 'is_active') then
    perform private.log_partner_audit(
      'partner_status_changed', 'growth_partner', new.id, v_area, null,
      jsonb_build_object(
        'from_status', v_old ->> 'status', 'to_status', v_new ->> 'status',
        'from_active', v_old ->> 'is_active', 'to_active', v_new ->> 'is_active'
      )
    );
  end if;
  if (v_old ->> 'deleted_at') is distinct from (v_new ->> 'deleted_at') then
    perform private.log_partner_audit(
      case when (v_new ->> 'deleted_at') is null then 'partner_restored' else 'partner_soft_deleted' end,
      'growth_partner', new.id, v_area, v_new ->> 'ban_reason', '{}'::jsonb
    );
  elsif (v_old ->> 'banned_at') is distinct from (v_new ->> 'banned_at') then
    perform private.log_partner_audit(
      case when (v_new ->> 'banned_at') is null then 'partner_unbanned' else 'partner_banned' end,
      'growth_partner', new.id, v_area, v_new ->> 'ban_reason', '{}'::jsonb
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_audit_growth_partner_change on public.growth_partners;
create trigger trg_audit_growth_partner_change
  after update on public.growth_partners
  for each row execute function private.audit_growth_partner_change();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Manager onboarding links (super admin generated, single source of truth
--    for "is this onboarding link real, still open, and for which territory")
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.manager_onboarding_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  work_area text not null,
  role public.admin_role not null default 'area_manager',
  note text,
  max_uses integer not null default 1 check (max_uses between 1 and 500),
  uses integer not null default 0 check (uses >= 0),
  expires_at timestamptz,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists manager_onboarding_links_active_idx on public.manager_onboarding_links (is_active, expires_at);

alter table public.manager_onboarding_links enable row level security;
revoke all on public.manager_onboarding_links from public, anon, authenticated;
grant select on public.manager_onboarding_links to authenticated;
grant all on public.manager_onboarding_links to service_role;

drop policy if exists manager_onboarding_links_read on public.manager_onboarding_links;
create policy manager_onboarding_links_read on public.manager_onboarding_links for select to authenticated
  using (
    private.is_super_admin()
    or (private.is_admin_member() and work_area = public.current_admin_area())
  );
-- Writes go through admin_create_manager_onboarding_link() / _revoke() only.

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Applications
--
-- Aadhaar/PAN: the full Aadhaar number is stored (a KYC reviewer needs it) but
-- it is readable by a super admin ONLY — the read RPC masks it for everybody
-- else, and the directory RPC never returns it. PAN is normalised to upper case
-- and every format rule is a CHECK, so a malformed row cannot exist even if a
-- future client forgets to validate.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.manager_onboarding_applications (
  id uuid primary key default gen_random_uuid(),
  link_id uuid references public.manager_onboarding_links(id) on delete set null,
  token text,
  full_name text not null check (length(btrim(full_name)) between 2 and 120),
  email text not null check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone text not null check (phone ~ '^[0-9]{10,15}$'),
  whatsapp text check (whatsapp is null or whatsapp ~ '^[0-9]{10,15}$'),
  photo_path text,
  aadhaar_number text check (aadhaar_number is null or aadhaar_number ~ '^[0-9]{12}$'),
  aadhaar_front_path text,
  aadhaar_back_path text,
  pan_number text check (pan_number is null or pan_number ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  pan_card_path text,
  bank_account_name text,
  bank_account_number text check (bank_account_number is null or bank_account_number ~ '^[0-9]{6,20}$'),
  bank_ifsc text check (bank_ifsc is null or bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  upi_id text,
  work_area text not null,
  role public.admin_role not null default 'area_manager',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists manager_onboarding_applications_pending_email
  on public.manager_onboarding_applications (lower(email)) where status = 'pending';
create index if not exists manager_onboarding_applications_status_idx
  on public.manager_onboarding_applications (status, created_at desc);

alter table public.manager_onboarding_applications enable row level security;
revoke all on public.manager_onboarding_applications from public, anon, authenticated;
grant select on public.manager_onboarding_applications to authenticated;
grant all on public.manager_onboarding_applications to service_role;

drop policy if exists manager_onboarding_applications_review on public.manager_onboarding_applications;
create policy manager_onboarding_applications_review on public.manager_onboarding_applications for select to authenticated
  using (private.is_super_admin());
-- A candidate has no session yet, so nothing here is client-writable: the public
-- form goes through submit_manager_onboarding_application() below.

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Rewards / milestones (definitions + per-partner unlocked rows)
--    The forecasting UI reads partner_reward_tiers; the row is created on
--    unlock by admin_sync_partner_rewards().
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.partner_reward_tiers (
  code text primary key,
  title text not null,
  threshold_paid_referrals integer not null check (threshold_paid_referrals > 0),
  bonus_paise bigint not null check (bonus_paise > 0),
  sort_order smallint not null,
  is_active boolean not null default true
);
insert into public.partner_reward_tiers(code, title, threshold_paid_referrals, bonus_paise, sort_order) values
  ('starter', 'First 3 salons', 3, 200000, 1),
  ('growth', '6 salons onboarded', 6, 500000, 2),
  ('scale', '12 salons onboarded', 12, 1200000, 3)
on conflict (code) do update set
  title = excluded.title,
  threshold_paid_referrals = excluded.threshold_paid_referrals,
  bonus_paise = excluded.bonus_paise,
  sort_order = excluded.sort_order;

create table if not exists public.partner_rewards (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.growth_partners(id) on delete cascade,
  tier_code text not null references public.partner_reward_tiers(code),
  status text not null default 'unlocked' check (status in ('unlocked', 'paid', 'cancelled')),
  unlocked_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (partner_id, tier_code)
);

alter table public.partner_reward_tiers enable row level security;
alter table public.partner_rewards enable row level security;
revoke all on public.partner_reward_tiers, public.partner_rewards from public, anon, authenticated;
grant select on public.partner_reward_tiers to authenticated;
grant select on public.partner_rewards to authenticated;
grant all on public.partner_reward_tiers, public.partner_rewards to service_role;

drop policy if exists partner_reward_tiers_read on public.partner_reward_tiers;
create policy partner_reward_tiers_read on public.partner_reward_tiers for select to authenticated using (is_active);

drop policy if exists partner_rewards_read on public.partner_rewards;
do $$ begin
  -- `my_active_partner_id()` is created by the partner operations migration; on a
  -- project without it the policy simply covers admins, instead of failing to
  -- create at all (the failure mode this whole branch is fixing).
  if to_regprocedure('public.my_active_partner_id()') is null then
    create policy partner_rewards_read on public.partner_rewards for select to authenticated
      using (
        private.is_super_admin()
        or (private.is_admin_member() and exists (
          select 1 from public.growth_partners gp
           where gp.id = partner_rewards.partner_id
             and gp.work_area = public.current_admin_area()
        ))
      );
  else
    create policy partner_rewards_read on public.partner_rewards for select to authenticated
      using (
        private.is_super_admin()
        or (private.is_admin_member() and exists (
          select 1 from public.growth_partners gp
           where gp.id = partner_rewards.partner_id
             and gp.work_area = public.current_admin_area()
        ))
        or partner_id = public.my_active_partner_id()
      );
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Storage
--    `manager-documents` is private and super-admin-only (§3 of the spec);
--    `partner-marketing-assets` already exists for the Growth Partner asset
--    library — admins get the upload side here (partners keep reading through
--    the signed-URL route, which never makes the bucket public).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  has_storage boolean := to_regclass('storage.buckets') is not null;
begin
  if has_storage then
    execute $b$
      insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
      values ('manager-documents', 'manager-documents', false, 10485760,
              array['image/png','image/jpeg','image/webp','application/pdf'])
      on conflict (id) do update set public = false
    $b$;
    execute $b$
      insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
      values ('partner-marketing-assets', 'partner-marketing-assets', false, 26214400,
              array['image/png','image/jpeg','image/webp','image/svg+xml','application/pdf','video/mp4'])
      on conflict (id) do nothing
    $b$;

    -- Private documents: only a super admin (the reviewer) may touch them.
    execute $b$drop policy if exists manager_documents_super_only on storage.objects$b$;
    execute $b$
      create policy manager_documents_super_only on storage.objects for all to authenticated
        using (bucket_id = 'manager-documents' and private.is_super_admin())
        with check (bucket_id = 'manager-documents' and private.is_super_admin())
    $b$;

    -- Marketing assets: any admin may upload/manage; partners never write.
    execute $b$drop policy if exists marketing_assets_admin_write on storage.objects$b$;
    execute $b$
      create policy marketing_assets_admin_write on storage.objects for all to authenticated
        using (bucket_id = 'partner-marketing-assets' and private.is_admin_member())
        with check (bucket_id = 'partner-marketing-assets' and private.is_admin_member())
    $b$;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. RPCs — access, links, the public submission, and super-admin review
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_my_admin_access()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role public.admin_role := public.current_admin_role();
begin
  if v_role is null then
    return jsonb_build_object('is_admin', false, 'role', null, 'work_area', null, 'can_manage_money', false);
  end if;
  return jsonb_build_object(
    'is_admin', true,
    'role', v_role::text,
    'work_area', case when v_role = 'super_admin'::public.admin_role then null else public.current_admin_area() end,
    'can_manage_money', private.can_manage_partner_money()
  );
end $$;
revoke all on function public.get_my_admin_access() from public;
-- `anon` included on purpose: the answer for a signed-out visitor is simply
-- `is_admin: false`, and the /admin gate renders the sign-in prompt from it.
grant execute on function public.get_my_admin_access() to anon, authenticated, service_role;

create or replace function public.admin_create_manager_onboarding_link(
  p_work_area text,
  p_role public.admin_role default 'area_manager',
  p_expires_days integer default 7,
  p_max_uses integer default 1,
  p_note text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_token text; v_row public.manager_onboarding_links;
begin
  if not private.is_super_admin() then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_work_area, '')), '') is null then
    raise exception 'Work area is required' using errcode = '22023';
  end if;
  if p_role in ('admin'::public.admin_role, 'super_admin'::public.admin_role) then
    raise exception 'A public link can only onboard an area manager or sub admin' using errcode = '22023';
  end if;
  if p_max_uses < 1 or p_max_uses > 500 then
    raise exception 'max_uses must be between 1 and 500' using errcode = '22023';
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.manager_onboarding_links(token, work_area, role, note, max_uses, expires_at, created_by)
  values (
    v_token, btrim(p_work_area), p_role, nullif(btrim(coalesce(p_note, '')), ''), p_max_uses,
    case when p_expires_days is null or p_expires_days <= 0 then null else now() + (p_expires_days || ' days')::interval end,
    (select auth.uid())
  ) returning * into v_row;
  perform private.log_partner_audit('manager_onboarding_link_created', 'manager_onboarding_link', v_row.id,
    v_row.work_area, null, jsonb_build_object('role', v_row.role::text, 'max_uses', v_row.max_uses));
  return jsonb_build_object(
    'id', v_row.id, 'token', v_row.token, 'work_area', v_row.work_area, 'role', v_row.role::text,
    'max_uses', v_row.max_uses, 'uses', v_row.uses, 'expires_at', v_row.expires_at, 'created_at', v_row.created_at
  );
end $$;
revoke all on function public.admin_create_manager_onboarding_link(text, public.admin_role, integer, integer, text) from public, anon;
grant execute on function public.admin_create_manager_onboarding_link(text, public.admin_role, integer, integer, text) to authenticated, service_role;

create or replace function public.admin_list_manager_onboarding_links(p_include_closed boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_items jsonb;
begin
  if not private.is_admin_member() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'token', l.token, 'work_area', l.work_area, 'role', l.role::text,
           'note', l.note, 'max_uses', l.max_uses, 'uses', l.uses,
           'expires_at', l.expires_at, 'is_active', l.is_active,
           'exhausted', (l.uses >= l.max_uses) or (l.expires_at is not null and l.expires_at < now()),
           'created_at', l.created_at
         ) order by l.created_at desc), '[]'::jsonb)
    into v_items
    from public.manager_onboarding_links l
   where (private.is_super_admin() or l.work_area = public.current_admin_area())
     and (p_include_closed or (l.is_active and l.uses < l.max_uses and (l.expires_at is null or l.expires_at >= now())));
  return jsonb_build_object('items', v_items);
end $$;
revoke all on function public.admin_list_manager_onboarding_links(boolean) from public, anon;
grant execute on function public.admin_list_manager_onboarding_links(boolean) to authenticated, service_role;

create or replace function public.admin_revoke_manager_onboarding_link(p_link_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.manager_onboarding_links;
begin
  if not private.is_super_admin() then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
  update public.manager_onboarding_links set is_active = false where id = p_link_id returning * into v_row;
  if v_row.id is null then
    raise exception 'Onboarding link not found' using errcode = 'P0002';
  end if;
  perform private.log_partner_audit('manager_onboarding_link_revoked', 'manager_onboarding_link', v_row.id, v_row.work_area);
  return jsonb_build_object('id', v_row.id, 'is_active', v_row.is_active);
end $$;
revoke all on function public.admin_revoke_manager_onboarding_link(uuid) from public, anon;
grant execute on function public.admin_revoke_manager_onboarding_link(uuid) to authenticated, service_role;

-- Public: what the form needs to render (area + role), never who created it.
create or replace function public.get_manager_onboarding_link(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_row public.manager_onboarding_links; v_reason text;
begin
  select * into v_row from public.manager_onboarding_links where token = btrim(coalesce(p_token, ''));
  if v_row.id is null then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;
  v_reason := case
    when not v_row.is_active then 'revoked'
    when v_row.expires_at is not null and v_row.expires_at < now() then 'expired'
    when v_row.uses >= v_row.max_uses then 'already_used'
    else null
  end;
  return jsonb_build_object(
    'valid', v_reason is null,
    'reason', v_reason,
    'work_area', v_row.work_area,
    'role', v_row.role::text,
    'expires_at', v_row.expires_at
  );
end $$;
revoke all on function public.get_manager_onboarding_link(text) from public;
grant execute on function public.get_manager_onboarding_link(text) to anon, authenticated, service_role;

-- Public submission. Every rule is validated here as well as in the form, and
-- the refusal names the field, so the browser can put the message under it.
create or replace function public.submit_manager_onboarding_application(p_token text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_link public.manager_onboarding_links;
  v_id uuid;
  v_email text := lower(btrim(coalesce(p_payload ->> 'email', '')));
  v_phone text := regexp_replace(coalesce(p_payload ->> 'phone', ''), '[^0-9]', '', 'g');
  v_whatsapp text := regexp_replace(coalesce(p_payload ->> 'whatsapp', ''), '[^0-9]', '', 'g');
  v_aadhaar text := regexp_replace(coalesce(p_payload ->> 'aadhaar_number', ''), '[^0-9]', '', 'g');
  v_pan text := upper(btrim(coalesce(p_payload ->> 'pan_number', '')));
  v_area text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Full name is required' using errcode = '22023';
  end if;

  select * into v_link from public.manager_onboarding_links
   where token = btrim(coalesce(p_token, '')) for update;
  if v_link.id is null or not v_link.is_active then
    raise exception 'This onboarding link is no longer valid' using errcode = '22023';
  end if;
  if v_link.expires_at is not null and v_link.expires_at < now() then
    raise exception 'This onboarding link has expired' using errcode = '22023';
  end if;
  if v_link.uses >= v_link.max_uses then
    raise exception 'This onboarding link has already been used' using errcode = '22023';
  end if;

  if length(btrim(coalesce(p_payload ->> 'full_name', ''))) < 2 then
    raise exception 'Full name is required' using errcode = '22023';
  end if;
  if v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;
  if length(v_phone) < 10 or length(v_phone) > 15 then
    raise exception 'Enter a valid 10-digit phone number' using errcode = '22023';
  end if;
  if v_whatsapp <> '' and (length(v_whatsapp) < 10 or length(v_whatsapp) > 15) then
    raise exception 'Enter a valid WhatsApp number' using errcode = '22023';
  end if;
  if v_aadhaar <> '' and length(v_aadhaar) <> 12 then
    raise exception 'Aadhaar number must be exactly 12 digits' using errcode = '22023';
  end if;
  if v_pan <> '' and v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then
    raise exception 'PAN must look like ABCDE1234F' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_payload ->> 'bank_ifsc', '')), '') is not null
     and upper(btrim(p_payload ->> 'bank_ifsc')) !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then
    raise exception 'IFSC must look like HDFC0001234' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.manager_onboarding_applications a
     where lower(a.email) = v_email and a.status = 'pending'
  ) then
    raise exception 'An application for this email is already under review' using errcode = '23505';
  end if;

  v_area := nullif(btrim(coalesce(p_payload ->> 'work_area', '')), '');
  if v_area is null then
    v_area := v_link.work_area;
  end if;

  insert into public.manager_onboarding_applications(
    link_id, token, full_name, email, phone, whatsapp, photo_path,
    aadhaar_number, aadhaar_front_path, aadhaar_back_path,
    pan_number, pan_card_path,
    bank_account_name, bank_account_number, bank_ifsc, upi_id,
    work_area, role
  ) values (
    v_link.id, v_link.token, btrim(p_payload ->> 'full_name'), v_email, v_phone,
    nullif(v_whatsapp, ''), nullif(btrim(coalesce(p_payload ->> 'photo_path', '')), ''),
    nullif(v_aadhaar, ''), nullif(btrim(coalesce(p_payload ->> 'aadhaar_front_path', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'aadhaar_back_path', '')), ''),
    nullif(v_pan, ''), nullif(btrim(coalesce(p_payload ->> 'pan_card_path', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'bank_account_name', '')), ''),
    nullif(regexp_replace(coalesce(p_payload ->> 'bank_account_number', ''), '[^0-9]', '', 'g'), ''),
    nullif(upper(btrim(coalesce(p_payload ->> 'bank_ifsc', ''))), ''),
    nullif(btrim(coalesce(p_payload ->> 'upi_id', '')), ''),
    v_area, v_link.role
  ) returning id into v_id;

  update public.manager_onboarding_links set uses = uses + 1 where id = v_link.id;
  perform private.log_partner_audit('manager_application_submitted', 'manager_onboarding_application', v_id,
    v_area, null, jsonb_build_object('role', v_link.role::text));
  return jsonb_build_object('id', v_id, 'status', 'pending', 'work_area', v_area);
end $$;
revoke all on function public.submit_manager_onboarding_application(text, jsonb) from public;
grant execute on function public.submit_manager_onboarding_application(text, jsonb) to anon, authenticated, service_role;

-- Super-admin review. Approving links the Auth user the server created
-- (`p_user_id`) to a live admin_members row with the territory from the link.
create or replace function public.admin_list_manager_applications(p_status text default 'pending', p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_items jsonb;
begin
  if not private.is_super_admin() then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'full_name', a.full_name, 'email', a.email, 'phone', a.phone, 'whatsapp', a.whatsapp,
           'work_area', a.work_area, 'role', a.role::text, 'status', a.status,
           'photo_path', a.photo_path,
           'aadhaar_last4', right(coalesce(a.aadhaar_number, ''), 4),
           'aadhaar_number', a.aadhaar_number,
           'aadhaar_front_path', a.aadhaar_front_path, 'aadhaar_back_path', a.aadhaar_back_path,
           'pan_number', a.pan_number, 'pan_card_path', a.pan_card_path,
           'bank_account_name', a.bank_account_name,
           'bank_account_last4', right(coalesce(a.bank_account_number, ''), 4),
           'bank_ifsc', a.bank_ifsc, 'upi_id', a.upi_id,
           'review_note', a.review_note, 'created_at', a.created_at
         ) order by a.created_at desc), '[]'::jsonb)
    into v_items
    from (
      select * from public.manager_onboarding_applications
       where p_status is null or p_status = '' or p_status = 'all' or status = p_status
       order by created_at desc
       limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) a;
  return jsonb_build_object('items', v_items);
end $$;
revoke all on function public.admin_list_manager_applications(text, integer) from public, anon;
grant execute on function public.admin_list_manager_applications(text, integer) to authenticated, service_role;

create or replace function public.admin_review_manager_application(
  p_application_id uuid,
  p_approve boolean,
  p_note text default null,
  p_user_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_app public.manager_onboarding_applications; v_member public.admin_members;
begin
  if not private.is_super_admin() then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
  select * into v_app from public.manager_onboarding_applications where id = p_application_id for update;
  if v_app.id is null then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if v_app.status <> 'pending' then
    raise exception 'This application was already %', v_app.status using errcode = '22023';
  end if;

  if not p_approve then
    update public.manager_onboarding_applications
       set status = 'rejected', review_note = nullif(btrim(coalesce(p_note, '')), ''),
           reviewed_by = (select auth.uid()), reviewed_at = now(), updated_at = now()
     where id = v_app.id;
    perform private.log_partner_audit('manager_application_rejected', 'manager_onboarding_application', v_app.id,
      v_app.work_area, p_note);
    return jsonb_build_object('id', v_app.id, 'status', 'rejected');
  end if;

  if p_user_id is null then
    raise exception 'Approving needs the Auth user id created for this manager' using errcode = '22023';
  end if;
  if exists (select 1 from public.admin_members am where am.user_id = p_user_id) then
    raise exception 'This account is already an admin member' using errcode = '23505';
  end if;
  if exists (select 1 from public.admin_members am where lower(am.email) = lower(v_app.email)) then
    raise exception 'An admin with this email already exists' using errcode = '23505';
  end if;

  insert into public.admin_members(user_id, email, full_name, role, work_area, phone, whatsapp, photo_path, created_by)
  values (p_user_id, lower(v_app.email), v_app.full_name, v_app.role, v_app.work_area,
          v_app.phone, v_app.whatsapp, v_app.photo_path, (select auth.uid()))
  returning * into v_member;

  update public.manager_onboarding_applications
     set status = 'approved', review_note = nullif(btrim(coalesce(p_note, '')), ''),
         reviewed_by = (select auth.uid()), reviewed_at = now(), created_user_id = p_user_id, updated_at = now()
   where id = v_app.id;

  perform private.log_partner_audit('manager_application_approved', 'manager_onboarding_application', v_app.id,
    v_app.work_area, p_note, jsonb_build_object('admin_member_id', v_member.id, 'role', v_app.role::text));

  return jsonb_build_object(
    'id', v_app.id, 'status', 'approved',
    'admin_member_id', v_member.id, 'role', v_member.role::text, 'work_area', v_member.work_area
  );
end $$;
revoke all on function public.admin_review_manager_application(uuid, boolean, text, uuid) from public, anon;
grant execute on function public.admin_review_manager_application(uuid, boolean, text, uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Reward sync (called by the directory/report path; forecasting is a read)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_sync_partner_rewards(p_partner_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role public.admin_role := public.current_admin_role(); v_area text := public.current_admin_area(); v_rows jsonb;
begin
  if v_role is null then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if v_area is not null and not private.is_super_admin() and exists (
    select 1 from public.growth_partners gp
     where gp.id = p_partner_id and coalesce(gp.work_area, '') <> v_area
  ) then
    raise exception 'This partner is outside your work area' using errcode = '42501';
  end if;

  with target as (
    select gp.id,
           coalesce((select count(*) from public.growth_onboarding go
                      where go.growth_partner_id = gp.user_id and go.status = 'template_completed'), 0)::integer salons
      from public.growth_partners gp
     where gp.deleted_at is null
       and (p_partner_id is null or gp.id = p_partner_id)
       and (v_area is null or private.is_super_admin() or gp.work_area = v_area)
  ), unlocked as (
    insert into public.partner_rewards(partner_id, tier_code)
    select t.id, rt.code
      from target t
      join public.partner_reward_tiers rt on rt.is_active and t.salons >= rt.threshold_paid_referrals
    on conflict (partner_id, tier_code) do nothing
    returning partner_id, tier_code, unlocked_at
  )
  select coalesce(jsonb_agg(to_jsonb(unlocked)), '[]'::jsonb) into v_rows from unlocked;
  return jsonb_build_object('unlocked', v_rows);
end $$;
revoke all on function public.admin_sync_partner_rewards(uuid) from public, anon;
grant execute on function public.admin_sync_partner_rewards(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
