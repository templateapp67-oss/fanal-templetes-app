-- First Super Admin claim — makes /admin self-bootstrapping.
--
-- Problem: 20261101000000 creates admin_members but nothing ever puts the first
-- row in it, so on a fresh project every account is "not staff" and the panel
-- can never be opened (the old fix was a hand-written INSERT in the SQL Editor).
--
-- This migration adds the two RPCs the /admin screen uses instead:
--
--   public.admin_setup_state()        -> {has_admin, claimable}
--       Read-only. `claimable` is true while NO ACTIVE admin_members row exists.
--
--   public.claim_first_super_admin()  -> {role, claimed}
--       One-time claim for the signed-in account. Refused as soon as any active
--       admin exists, so it cannot be used to take over a configured project.
--       Concurrent claims are serialized with a transaction-level advisory lock:
--       the loser re-reads admin_members after the winner commits and is refused.
--       It is idempotent for someone who is already staff ({claimed:false}).
--
-- Depends on 20261101000000 (admin_members, current_admin_role,
-- private.log_partner_audit). Idempotent: safe to re-run.

begin;

create or replace function public.admin_setup_state() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_has_admin boolean;
begin
  select exists (select 1 from public.admin_members am where am.is_active)
    into v_has_admin;
  return jsonb_build_object('has_admin', v_has_admin, 'claimable', not v_has_admin);
end $$;

revoke all on function public.admin_setup_state() from public, anon;
grant execute on function public.admin_setup_state() to authenticated, service_role;

create or replace function public.claim_first_super_admin() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.admin_role;
  v_email text;
  v_name text;
  v_member uuid;
begin
  if v_uid is null then
    raise exception 'Sign in with a Nexora account first, then claim admin access.'
      using errcode = '28000';
  end if;

  -- Serialize concurrent claims: only one transaction at a time gets past here,
  -- and the checks below run AFTER the lock so the second caller sees the first
  -- caller's committed row.
  perform pg_advisory_xact_lock(hashtext('nexora_first_super_admin_claim'));

  -- Already staff (any role): nothing to claim, nothing to change.
  v_role := public.current_admin_role();
  if v_role is not null then
    return jsonb_build_object('role', v_role::text, 'claimed', false);
  end if;

  if exists (select 1 from public.admin_members am where am.is_active) then
    raise exception 'A Super Admin already exists on this project. Ask them to share an onboarding link instead.'
      using errcode = '55006';
  end if;

  select u.email::text,
         nullif(btrim(coalesce(
           u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), '')
    into v_email, v_name
    from auth.users u
   where u.id = v_uid;

  if v_email is null then
    raise exception 'This account has no email address, so it cannot be made a Super Admin.'
      using errcode = '22023';
  end if;
  v_name := coalesce(v_name, 'Super Admin');

  -- Reuse a deactivated row for this same account/email instead of tripping the
  -- unique indexes; otherwise insert a fresh one.
  update public.admin_members am
     set user_id = v_uid, email = v_email, full_name = v_name,
         role = 'super_admin'::public.admin_role, work_area = null,
         is_active = true, updated_at = now()
   where am.user_id = v_uid
      or (am.user_id is null and lower(am.email) = lower(v_email))
  returning am.id into v_member;

  if v_member is null then
    insert into public.admin_members (user_id, email, full_name, role, is_active, created_by)
    values (v_uid, v_email, v_name, 'super_admin'::public.admin_role, true, v_uid)
    returning id into v_member;
  end if;

  -- The audit trail must never be the reason the very first admin cannot be
  -- created, so a failure here is swallowed.
  begin
    perform private.log_partner_audit(
      'first_super_admin_claimed', 'admin_member', v_uid, null,
      'First Super Admin claimed from the /admin setup screen',
      jsonb_build_object('email', v_email, 'admin_member_id', v_member)
    );
  exception when others then
    null;
  end;

  return jsonb_build_object('role', 'super_admin', 'claimed', true);
end $$;

revoke all on function public.claim_first_super_admin() from public, anon;
grant execute on function public.claim_first_super_admin() to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
