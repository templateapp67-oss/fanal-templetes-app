-- ============================================================================
-- Nexora Salon OS — Growth Partner usability guard
-- Migration: 20261005_partner_ban_guard.sql
-- ----------------------------------------------------------------------------
-- PHASE 5. Referral validation checked that a partner EXISTS and is
-- `is_active`, but nothing consulted GoTrue's ban. `auth.users.banned_until`
-- was already honoured by 20260913_template_handoff.sql when redeeming a
-- handoff — so a banned partner was locked out of the Template App while still
-- free to keep collecting newly attributed referrals through
-- link_my_growth_referral.
--
-- WHAT THIS DOES
--   • Adds one private helper, public.growth_partner_is_usable(uuid), that
--     answers "may this partner receive a NEW referral right now?" — the row
--     exists, it is active, and the account is not currently GoTrue-banned.
--   • Routes the two write paths that establish attribution through it:
--       link_my_growth_referral  (the owner-facing link)
--       guard_growth_referral_identity  (defense in depth on every write,
--                                        including an admin correction)
--
-- WHAT IT DELIBERATELY DOES NOT CHANGE
--   • Existing attributions are untouched. A partner deactivated or banned
--     AFTER a referral was linked keeps that referral — the same rule the
--     guard trigger already applies to milestone updates, so banning a partner
--     never silently rewrites history or pays out differently.
--   • The failure message stays 'Invalid or inactive referral code'. A banned
--     partner must be indistinguishable from an unknown code, or the error text
--     becomes a way to enumerate which codes are real.
--   • The ban probe is guarded by an information_schema check because
--     auth.users.banned_until is absent in some schema generations; the helper
--     must not fail the caller on those.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- The helper. Private: no EXECUTE grants, so it is reachable only from the
-- SECURITY DEFINER functions below.
-- ---------------------------------------------------------------------------
create or replace function public.growth_partner_is_usable(p_partner uuid)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_partner is null then
    return false;
  end if;
  if not exists (
    select 1 from public.growth_partners gp
    where gp.user_id = p_partner and gp.is_active
  ) then
    return false;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = 'banned_until'
  ) then
    return not exists (
      select 1 from auth.users u
      where u.id = p_partner
        and u.banned_until is not null
        and u.banned_until > now()
    );
  end if;
  return true;
end;
$$;
revoke all on function public.growth_partner_is_usable(uuid) from public, anon, authenticated;

comment on function public.growth_partner_is_usable(uuid) is
  'May this Growth Partner receive a NEW referral right now? Row exists, is_active, and not currently GoTrue-banned. Existing attributions are never revisited.';

-- ---------------------------------------------------------------------------
-- link_my_growth_referral — unchanged except that the partner lookup now also
-- requires the partner to be usable. Body copied verbatim from
-- 20260921_public_partner_referral_codes.sql.
-- ---------------------------------------------------------------------------
create or replace function public.link_my_growth_referral(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  v_code text := public.growth_normalize_code(p_code);
  v_partner uuid;
  v_status text;
  v_linked_at timestamptz;
  v_current_partner uuid;
  v_updated integer := 0;
begin
  if actor is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  -- Fail closed when the JWT subject has no live account row. Same message
  -- and code as the missing-session branch: callers cannot distinguish the
  -- two, so this check is not an account-existence oracle.
  if not exists (select 1 from auth.users where id = actor) then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if v_code !~ '^([A-Z0-9]{6,12}|NEXORA-[A-Z0-9]{4,24})$' then
    raise exception 'Invalid referral code' using errcode = '22023';
  end if;
  select gp.user_id into v_partner
  from public.growth_partners gp
  where gp.referral_code = v_code and gp.is_active;
  -- Unknown code, deactivated partner and banned partner all answer the same
  -- way, so the message cannot be used to discover which codes are real.
  if v_partner is null or not public.growth_partner_is_usable(v_partner) then
    raise exception 'Invalid or inactive referral code' using errcode = '22023';
  end if;
  if v_partner = actor then
    raise exception 'You cannot use your own referral code' using errcode = '22023';
  end if;

  insert into public.growth_onboarding as o (user_id) values (actor)
  on conflict (user_id) do nothing;

  -- Serialize racers on the caller's own row; refuse fast when already linked.
  select o.growth_partner_id into v_current_partner
  from public.growth_onboarding as o where o.user_id = actor for update;
  if v_current_partner is not null then
    raise exception 'This account is already linked to a Growth Partner' using errcode = '22023';
  end if;

  -- Atomic claim: the predicate is the backstop that lets exactly one
  -- concurrent request win (the lock above serializes; this decides).
  update public.growth_onboarding as o
  set growth_partner_id = v_partner,
      referral_code = v_code,
      linked_at = now(),
      status = case when o.status = 'not_started' then 'linked' else o.status end,
      updated_at = now()
  where o.user_id = actor
    and o.growth_partner_id is null
  returning o.status, o.linked_at into v_status, v_linked_at;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'This account is already linked to a Growth Partner' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'growth_partner_id', v_partner,
    'referral_code', v_code,
    'linked_at', v_linked_at,
    'status', v_status,
    'partner_name', public.growth_partner_display_name(v_partner)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- guard_growth_referral_identity — defense in depth. The immutability rules are
-- copied verbatim from 20260923_referral_fraud_privacy.sql; only the final
-- partner re-check moves onto the helper, so a privileged write (including an
-- admin correction) cannot attribute to a banned partner either.
-- ---------------------------------------------------------------------------
create or replace function public.guard_growth_referral_identity()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'Referral account identity cannot be changed' using errcode = '42501';
    end if;
    if old.growth_partner_id is not null and
       (new.growth_partner_id, new.referral_code, new.linked_at) is distinct from
       (old.growth_partner_id, old.referral_code, old.linked_at) then
      if not coalesce(private.is_admin(), false) then
        raise exception 'Referral attribution is immutable; administrator action required' using errcode = '42501';
      end if;
    else
      -- Milestone/status updates never rotate attribution or revalidate a
      -- historical code that an administrator may since have changed.
      if old.growth_partner_id is not null then return new; end if;
    end if;
  end if;
  if new.growth_partner_id is not null then
    -- Defense in depth for writes through future RPCs: even privileged code
    -- must supply an ACTIVE, UNBANNED partner that owns the validated code.
    perform 1 from public.growth_partners gp where gp.user_id = new.growth_partner_id
      and gp.referral_code = new.referral_code;
    if not found then raise exception 'Invalid or inactive referral code' using errcode = '22023'; end if;
    if not public.growth_partner_is_usable(new.growth_partner_id) then
      raise exception 'Invalid or inactive referral code' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_growth_referral_identity() from public, anon, authenticated;

-- Re-assert the grants the replaced functions carry.
revoke all on function public.link_my_growth_referral(text) from public, anon;
grant execute on function public.link_my_growth_referral(text) to authenticated;

notify pgrst, 'reload schema';

commit;
