-- Admin partner operations: the area directory, moderation, financial oversight
-- and the export path. Split from 20261101000000 (roles, onboarding, audit,
-- buckets) so the RBAC layer installs even if a project has an unexpected
-- partner-operations shape.
--
-- Generation safety: `partner_referrals`, `partner_earnings` and
-- `partner_payout_requests` do not exist on every project this app can be
-- deployed against, so each read is guarded with to_regclass and the query is
-- assembled as a literal fragment — never from caller data.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The directory
--
-- Scoping rule in one sentence: a super admin sees every area and may pass any
-- filter, everybody else is FORCED to their own `work_area` (and is told so when
-- they have none). Contact details are returned so the page can dial/WhatsApp;
-- bank details are masked unless the caller may manage partner money.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_partner_directory(
  p_area text default null,
  p_status text default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_include_deleted boolean default false
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.admin_role := public.current_admin_role();
  v_area text;
  v_scope text;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_has_referrals boolean := to_regclass('public.partner_referrals') is not null;
  v_has_earnings boolean := to_regclass('public.partner_earnings') is not null;
  v_has_payouts boolean := to_regclass('public.partner_payout_requests') is not null;
  v_has_settings boolean := to_regclass('public.partner_account_settings') is not null;
  v_has_profiles boolean := to_regclass('public.profiles') is not null;
  -- The photo column is not the same on every profiles generation (00001_init
  -- declares owner_photo_url; the local gateway's slice does not), so it is
  -- probed, never assumed.
  v_has_photo boolean := exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'owner_photo_url'
  );
  v_sql text;
  v_items jsonb;
  v_total integer;
  v_money boolean := private.can_manage_partner_money();
begin
  if v_role is null then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if private.is_super_admin() then
    v_area := nullif(btrim(coalesce(p_area, '')), '');
  else
    v_area := public.current_admin_area();
    if v_area is null then
      raise exception 'No work area is assigned to your account' using errcode = '42501';
    end if;
  end if;

  v_scope := 'gp.deleted_at is null';
  if p_include_deleted and private.is_super_admin() then
    v_scope := 'true';
  end if;

  v_sql := format($q$
    with base as (
      select gp.id,
             gp.user_id,
             gp.referral_code,
             %s as partner_code,
             %s as full_name,
             %s as email,
             %s as phone,
             %s as whatsapp,
             %s as photo_path,
             gp.is_active,
             %s as status,
             gp.work_area,
             gp.created_at,
             gp.deleted_at,
             gp.banned_at,
             gp.ban_reason
        from public.growth_partners gp
        %s
       where %s
         and ($1::text is null or coalesce(gp.work_area, '') = $1)
    ), metrics as (
      select b.*,
             %s as onboarded_salons,
             %s as active_referrals,
             %s as lifetime_paise,
             %s as available_paise,
             %s as open_payouts
        from base b
    ), filtered as (
      select * from metrics
       where ($2::text is null or $2::text = 'all'
              or ($2::text = 'active'   and is_active and deleted_at is null and banned_at is null)
              or ($2::text = 'inactive' and (not is_active or banned_at is not null))
              or ($2::text = 'banned'   and banned_at is not null)
              or ($2::text = 'deleted'  and deleted_at is not null)
              or ($2::text = 'pending'  and status = 'pending'))
         and ($3::text is null or full_name ilike '%%' || $3 || '%%' or email ilike '%%' || $3 || '%%'
              or phone ilike '%%' || $3 || '%%' or referral_code ilike '%%' || $3 || '%%')
    )
    select coalesce(jsonb_agg((row_to_json(page)::jsonb) - 'total_count'), '[]'::jsonb),
           coalesce(max(total_count), 0)
      from (
        select f.*,
               %s as bank_details,
               %s as milestones,
               (select count(*) from filtered) as total_count
          from filtered f
         order by f.created_at desc, f.id
         limit least(greatest(coalesce($4, 50), 1), 200) offset greatest(coalesce($5, 0), 0)
      ) page
  $q$,
    -- partner_code / profile columns / status: only when the column exists
    case when exists (select 1 from information_schema.columns where table_schema='public'
                       and table_name='growth_partners' and column_name='partner_code')
         then 'gp.partner_code' else 'null' end,
    case when v_has_profiles then 'p.full_name' else 'null' end,
    case when v_has_profiles then 'p.email' else 'null' end,
    case when v_has_profiles then 'p.phone_number' else 'null' end,
    case when v_has_profiles then 'coalesce(p.whatsapp, p.phone_number)' else 'null' end,
    case when v_has_photo then 'p.owner_photo_url' else 'null' end,
    case when exists (select 1 from information_schema.columns where table_schema='public'
                       and table_name='growth_partners' and column_name='status')
         then 'gp.status' else 'null' end,
    case when v_has_profiles then 'left join public.profiles p on p.id = gp.user_id' else '' end,
    v_scope,
    -- metrics
    '(select count(*) from public.growth_onboarding go where go.growth_partner_id = b.user_id and go.status = ''template_completed'')::integer',
    case when v_has_referrals
         then '(select count(*) from public.partner_referrals pr where pr.partner_id = b.id and pr.status = ''active'')::integer'
         else '0::integer' end,
    case when v_has_earnings
         then 'coalesce((select sum(pe.amount_paise) from public.partner_earnings pe where pe.partner_id = b.id and pe.status not in (''reversed'')), 0)::bigint'
         else '0::bigint' end,
    case when v_has_earnings
         then 'greatest(coalesce((select sum(pe.amount_paise) from public.partner_earnings pe where pe.partner_id = b.id and pe.status = ''available_for_withdrawal''), 0) - '
              || case when v_has_payouts
                      then 'coalesce((select sum(p2.amount_paise) from public.partner_payout_requests p2 where p2.partner_id = b.id and p2.status not in (''cancelled'',''rejected'')), 0)'
                      else '0' end
              || ', 0)::bigint'
         else '0::bigint' end,
    case when v_has_payouts
         then '(select count(*) from public.partner_payout_requests p3 where p3.partner_id = b.id and p3.status in (''pending'',''in_review''))::integer'
         else '0::integer' end,
    -- bank details (masked unless the caller may manage money)
    case when v_has_settings and v_money then
      'coalesce((select jsonb_build_object('
      || '''payout_method'', s.payout_method, ''payout_account_name'', s.payout_account_name, '
      || '''payout_account_number'', s.payout_account_number, ''payout_ifsc'', s.payout_ifsc, ''payout_upi_id'', s.payout_upi_id) '
      || 'from public.partner_account_settings s where s.partner_id = f.id), ''null''::jsonb)'
    when v_has_settings then
      'coalesce((select jsonb_build_object('
      || '''payout_method'', s.payout_method, ''payout_account_name'', s.payout_account_name, '
      || '''account_last4'', right(coalesce(s.payout_account_number, ''''), 4), ''payout_ifsc'', s.payout_ifsc, '
      || '''upi_masked'', case when s.payout_upi_id is null then null else left(s.payout_upi_id, 2) || ''***'' end, '
      || '''read_only'', true) from public.partner_account_settings s where s.partner_id = f.id), ''null''::jsonb)'
    else '''null''::jsonb' end,
    -- milestone forecasting: how close is this partner to the next bonus
    'coalesce((select jsonb_agg(jsonb_build_object('
    || '''code'', rt.code, ''title'', rt.title, ''threshold'', rt.threshold_paid_referrals, '
    || '''bonus_paise'', rt.bonus_paise, ''remaining'', greatest(rt.threshold_paid_referrals - f.onboarded_salons, 0), '
    || '''unlocked'', f.onboarded_salons >= rt.threshold_paid_referrals) order by rt.sort_order) '
    || 'from public.partner_reward_tiers rt where rt.is_active), ''[]''::jsonb)'
  );

  execute v_sql into v_items, v_total using v_area, nullif(btrim(coalesce(p_status, '')), ''), v_search,
    least(greatest(coalesce(p_limit, 50), 1), 200), greatest(coalesce(p_offset, 0), 0);

  return jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'total', coalesce(v_total, 0),
    'work_area', v_area,
    'can_manage_money', v_money,
    'is_super_admin', private.is_super_admin()
  );
end $$;
revoke all on function public.admin_partner_directory(text, text, text, integer, integer, boolean) from public, anon;
grant execute on function public.admin_partner_directory(text, text, text, integer, integer, boolean) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Audit report (active vs inactive, salons onboarded, pending verifications)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_partner_report_summary(p_area text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.admin_role := public.current_admin_role();
  v_area text;
  v_scope text;
  v_summary jsonb;
begin
  if v_role is null then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if private.is_super_admin() then
    v_area := nullif(btrim(coalesce(p_area, '')), '');
  else
    v_area := public.current_admin_area();
    if v_area is null then
      raise exception 'No work area is assigned to your account' using errcode = '42501';
    end if;
  end if;
  v_scope := 'gp.deleted_at is null and ($1::text is null or coalesce(gp.work_area, '''') = $1)';

  execute format($q$
    select jsonb_build_object(
      'total_partners', count(*),
      'active_partners', count(*) filter (where gp.is_active and gp.banned_at is null),
      'inactive_partners', count(*) filter (where not gp.is_active and gp.banned_at is null),
      'banned_partners', count(*) filter (where gp.banned_at is not null),
      'deleted_partners', (select count(*) from public.growth_partners d
                            where d.deleted_at is not null
                              and ($1::text is null or coalesce(d.work_area, '') = $1)),
      'partners_with_work_area', count(*) filter (where nullif(btrim(coalesce(gp.work_area, '')), '') is not null),
      'onboarded_salons', coalesce(sum((select count(*) from public.growth_onboarding go
                                         where go.growth_partner_id = gp.user_id
                                           and go.status = 'template_completed')), 0),
      'pending_verifications', (select count(*) from public.growth_partner_applications a
                                 where a.status = 'pending'),
      'pending_manager_applications', (select count(*) from public.manager_onboarding_applications m
                                        where m.status = 'pending'),
      'pending_payouts', %s,
      'areas', coalesce((select jsonb_agg(distinct coalesce(nullif(btrim(gp2.work_area), ''), 'Unassigned'))
                           from public.growth_partners gp2
                          where gp2.deleted_at is null
                            and ($1::text is null or coalesce(gp2.work_area, '') = $1)), '[]'::jsonb)
    )
      from public.growth_partners gp
     where %s
  $q$,
    case when to_regclass('public.partner_payout_requests') is not null
         then '(select count(*) from public.partner_payout_requests r where r.status in (''pending'',''in_review''))'
         else '0' end,
    v_scope
  ) into v_summary using v_area;
  return v_summary;
end $$;
revoke all on function public.admin_partner_report_summary(text) from public, anon;
grant execute on function public.admin_partner_report_summary(text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Moderation: approve / unapprove / ban / unban / soft delete / restore
--    Super admin can do all of it in any area; admin/area_manager/sub_admin can
--    only moderate INSIDE their area, and soft delete stays super-admin-only.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_set_partner_state(
  p_partner_id uuid,
  p_action text,
  p_reason text default null,
  p_area text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role public.admin_role := public.current_admin_role();
  v_area text := public.current_admin_area();
  v_partner public.growth_partners;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_super boolean := private.is_super_admin();
begin
  if v_role is null then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select * into v_partner from public.growth_partners where id = p_partner_id;
  if v_partner.id is null then
    raise exception 'Partner not found' using errcode = 'P0002';
  end if;
  if not v_super then
    if v_area is null then
      raise exception 'No work area is assigned to your account' using errcode = '42501';
    end if;
    if coalesce(v_partner.work_area, '') <> v_area then
      raise exception 'This partner is outside your work area' using errcode = '42501';
    end if;
  end if;
  if p_action in ('soft_delete', 'restore') and not v_super then
    raise exception 'Only a Super Admin can delete or restore a partner profile' using errcode = '42501';
  end if;

  -- One audit row for this action, written by the RPC with its intent; the
  -- growth_partners trigger is suppressed so the trail does not double up.
  perform set_config('app.audit_suppressed', 'true', true);

  case p_action
    when 'approve' then
      update public.growth_partners
         set status = 'approved', is_active = true, banned_at = null, ban_reason = null, updated_at = now()
       where id = p_partner_id;
    when 'unapprove' then
      update public.growth_partners
         set status = 'pending', is_active = false, updated_at = now()
       where id = p_partner_id;
    when 'ban' then
      if v_reason is null then
        raise exception 'A reason is required to ban a partner' using errcode = '22023';
      end if;
      update public.growth_partners
         set banned_at = now(), ban_reason = v_reason, is_active = false, updated_at = now()
       where id = p_partner_id;
    when 'unban' then
      update public.growth_partners
         set banned_at = null, ban_reason = null, is_active = true, updated_at = now()
       where id = p_partner_id;
    when 'soft_delete' then
      if v_reason is null then
        raise exception 'A reason is required to delete a partner profile' using errcode = '22023';
      end if;
      update public.growth_partners
         set deleted_at = now(), deleted_by = (select auth.uid()), is_active = false, ban_reason = v_reason, updated_at = now()
       where id = p_partner_id;
    when 'restore' then
      update public.growth_partners
         set deleted_at = null, deleted_by = null, banned_at = null, ban_reason = null, is_active = true, status = 'approved', updated_at = now()
       where id = p_partner_id;
    else
      raise exception 'Unknown moderation action' using errcode = '22023';
  end case;

  perform private.log_partner_audit(
    'partner_' || p_action, 'growth_partner', p_partner_id,
    nullif(btrim(coalesce(v_partner.work_area, '')), ''), v_reason,
    jsonb_build_object('from_status', to_jsonb(v_partner) ->> 'status',
                       'from_active', to_jsonb(v_partner) ->> 'is_active')
  );

  select * into v_partner from public.growth_partners where id = p_partner_id;
  return jsonb_build_object(
    'id', v_partner.id,
    'status', to_jsonb(v_partner) ->> 'status',
    'is_active', v_partner.is_active,
    'banned_at', v_partner.banned_at,
    'ban_reason', v_partner.ban_reason,
    'deleted_at', v_partner.deleted_at
  );
end $$;
revoke all on function public.admin_set_partner_state(uuid, text, text, text) from public, anon;
grant execute on function public.admin_set_partner_state(uuid, text, text, text) to authenticated, service_role;

-- Assigning a territory decides what a manager may see, so it is super-admin only.
create or replace function public.admin_assign_partner_area(p_partner_id uuid, p_area text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_partner public.growth_partners; v_area text := nullif(btrim(coalesce(p_area, '')), '');
begin
  if not private.is_super_admin() then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
  update public.growth_partners set work_area = v_area, updated_at = now()
   where id = p_partner_id returning * into v_partner;
  if v_partner.id is null then
    raise exception 'Partner not found' using errcode = 'P0002';
  end if;
  perform private.log_partner_audit('partner_area_assigned', 'growth_partner', v_partner.id, v_area, null,
    jsonb_build_object('work_area', v_area));
  return jsonb_build_object('id', v_partner.id, 'work_area', v_partner.work_area);
end $$;
revoke all on function public.admin_assign_partner_area(uuid, text) from public, anon;
grant execute on function public.admin_assign_partner_area(uuid, text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Financial oversight: bank / UPI details
--
-- The single bank store stays partner_account_settings (the partner edits the
-- same row from their account-settings page), so an admin correction and a
-- partner edit cannot diverge. Audit rows keep only the last four digits.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_update_partner_bank_details(p_partner_id uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_partner public.growth_partners;
  v_area text := public.current_admin_area();
  v_allowed text[] := array['payout_method','payout_account_name','payout_account_number','payout_ifsc','payout_upi_id'];
  v_method text;
  v_ifsc text;
  v_account text;
begin
  if not private.can_manage_partner_money() then
    raise exception 'Admin access required to edit payout details' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or (p_patch - v_allowed) <> '{}'::jsonb then
    raise exception 'Unsupported payout detail' using errcode = '22023';
  end if;
  select * into v_partner from public.growth_partners where id = p_partner_id;
  if v_partner.id is null then
    raise exception 'Partner not found' using errcode = 'P0002';
  end if;
  if not private.is_super_admin() and coalesce(v_partner.work_area, '') <> coalesce(v_area, '') then
    raise exception 'This partner is outside your work area' using errcode = '42501';
  end if;

  v_method := nullif(btrim(coalesce(p_patch ->> 'payout_method', '')), '');
  if p_patch ? 'payout_method' and (v_method is null or v_method not in ('upi','bank_transfer','paypal')) then
    raise exception 'Payout method must be upi, bank_transfer or paypal' using errcode = '22023';
  end if;
  v_ifsc := upper(nullif(btrim(coalesce(p_patch ->> 'payout_ifsc', '')), ''));
  if p_patch ? 'payout_ifsc' and v_ifsc is not null and v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then
    raise exception 'IFSC must look like HDFC0001234' using errcode = '22023';
  end if;
  v_account := nullif(regexp_replace(coalesce(p_patch ->> 'payout_account_number', ''), '[^0-9]', '', 'g'), '');
  if p_patch ? 'payout_account_number' and v_account is not null and length(v_account) < 6 then
    raise exception 'Account number must be at least 6 digits' using errcode = '22023';
  end if;

  insert into public.partner_account_settings(partner_id)
  values (p_partner_id) on conflict (partner_id) do nothing;

  update public.partner_account_settings s
     set payout_method = case when p_patch ? 'payout_method' then v_method else s.payout_method end,
         payout_account_name = case when p_patch ? 'payout_account_name'
                                    then nullif(btrim(coalesce(p_patch ->> 'payout_account_name', '')), '')
                                    else s.payout_account_name end,
         payout_account_number = case when p_patch ? 'payout_account_number' then v_account else s.payout_account_number end,
         payout_ifsc = case when p_patch ? 'payout_ifsc' then v_ifsc else s.payout_ifsc end,
         payout_upi_id = case when p_patch ? 'payout_upi_id'
                              then nullif(btrim(coalesce(p_patch ->> 'payout_upi_id', '')), '')
                              else s.payout_upi_id end,
         updated_at = now()
   where s.partner_id = p_partner_id;

  perform private.log_partner_audit('partner_bank_details_updated', 'growth_partner', p_partner_id,
    nullif(btrim(coalesce(v_partner.work_area, '')), ''), null,
    jsonb_build_object(
      'fields', (select jsonb_agg(k) from jsonb_object_keys(p_patch) as t(k)),
      'account_last4', case when v_account is null then null else right(v_account, 4) end));

  return (select jsonb_build_object(
            'partner_id', s.partner_id, 'payout_method', s.payout_method,
            'payout_account_name', s.payout_account_name, 'payout_account_number', s.payout_account_number,
            'payout_ifsc', s.payout_ifsc, 'payout_upi_id', s.payout_upi_id)
            from public.partner_account_settings s where s.partner_id = p_partner_id);
end $$;
revoke all on function public.admin_update_partner_bank_details(uuid, jsonb) from public, anon;
grant execute on function public.admin_update_partner_bank_details(uuid, jsonb) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4b. The payout desk: the requests themselves (not just who has one open)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_list_partner_payouts(
  p_status text default 'open',
  p_area text default null,
  p_limit integer default 100
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.admin_role := public.current_admin_role();
  v_area text;
  v_items jsonb;
  v_total integer;
begin
  if v_role is null then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if private.is_super_admin() then
    v_area := nullif(btrim(coalesce(p_area, '')), '');
  else
    v_area := public.current_admin_area();
    if v_area is null then
      raise exception 'No work area is assigned to your account' using errcode = '42501';
    end if;
  end if;
  if to_regclass('public.partner_payout_requests') is null then
    return jsonb_build_object('items', '[]'::jsonb, 'total', 0);
  end if;

  execute format($q$
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', r.id, 'partner_id', r.partner_id, 'amount_paise', r.amount_paise,
             'payout_method', r.payout_method, 'destination_label', r.destination_label,
             'status', r.status, 'requested_at', r.requested_at, 'reviewed_at', r.reviewed_at,
             'paid_at', r.paid_at, 'provider_reference', r.provider_reference,
             'rejection_reason', r.rejection_reason,
             'partner_name', %s, 'partner_email', %s, 'partner_code', gp.referral_code,
             'work_area', gp.work_area
           ) order by r.requested_at asc, r.id), '[]'::jsonb),
           count(*)
      from (
        select * from public.partner_payout_requests r0
         where ($1::text = 'all'
                or ($1::text = 'open' and r0.status in ('pending','in_review'))
                or ($1::text = 'paid' and r0.status = 'paid')
                or ($1::text = 'rejected' and r0.status = 'rejected')
                or r0.status = $1::text)
         order by requested_at asc
         limit least(greatest(coalesce($3, 100), 1), 200)
      ) r
      join public.growth_partners gp on gp.id = r.partner_id
      %s
     where ($2::text is null or coalesce(gp.work_area, '') = $2)
  $q$,
    case when to_regclass('public.profiles') is not null then 'p.full_name' else 'null' end,
    case when to_regclass('public.profiles') is not null then 'p.email' else 'null' end,
    case when to_regclass('public.profiles') is not null then 'left join public.profiles p on p.id = gp.user_id' else '' end
  ) into v_items, v_total using nullif(btrim(coalesce(p_status, 'open')), ''), v_area,
      least(greatest(coalesce(p_limit, 100), 1), 200);
  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb), 'total', coalesce(v_total, 0));
end $$;
revoke all on function public.admin_list_partner_payouts(text, text, integer) from public, anon;
grant execute on function public.admin_list_partner_payouts(text, text, integer) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Payout processing with a UTR
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_process_partner_payout(
  p_request_id uuid,
  p_action text,
  p_utr text default null,
  p_note text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.partner_payout_requests;
  v_partner public.growth_partners;
  v_area text := public.current_admin_area();
  v_utr text := nullif(btrim(coalesce(p_utr, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not private.can_manage_partner_money() then
    raise exception 'Admin access required to process payouts' using errcode = '42501';
  end if;
  if p_action not in ('mark_paid', 'reject') then
    raise exception 'Unknown payout action' using errcode = '22023';
  end if;

  select * into v_row from public.partner_payout_requests where id = p_request_id for update;
  if v_row.id is null then
    raise exception 'Payout request not found' using errcode = 'P0002';
  end if;
  select * into v_partner from public.growth_partners where id = v_row.partner_id;
  if not private.is_super_admin() and coalesce(v_partner.work_area, '') <> coalesce(v_area, '') then
    raise exception 'This partner is outside your work area' using errcode = '42501';
  end if;
  if v_row.status not in ('pending', 'in_review') then
    raise exception 'This payout request is already %', v_row.status using errcode = '22023';
  end if;

  if p_action = 'mark_paid' then
    if v_utr is null or length(v_utr) < 6 then
      raise exception 'A UTR / reference of at least 6 characters is required' using errcode = '22023';
    end if;
    update public.partner_payout_requests
       set status = 'paid', paid_at = now(), reviewed_at = coalesce(reviewed_at, now()),
           provider_reference = v_utr, updated_at = now()
     where id = p_request_id returning * into v_row;
  else
    if v_note is null then
      raise exception 'A reason is required to reject a payout request' using errcode = '22023';
    end if;
    update public.partner_payout_requests
       set status = 'rejected', reviewed_at = now(), rejection_reason = v_note, updated_at = now()
     where id = p_request_id returning * into v_row;
  end if;

  begin
    insert into public.partner_notifications(partner_id, notification_type, title, body, data)
    values (
      v_row.partner_id, 'payout',
      case when p_action = 'mark_paid' then 'Withdrawal paid' else 'Withdrawal request rejected' end,
      case when p_action = 'mark_paid'
           then format('₹%s has been sent. Reference %s.', round(v_row.amount_paise / 100.0, 2), v_utr)
           else format('Your withdrawal request of ₹%s was rejected: %s', round(v_row.amount_paise / 100.0, 2), v_note) end,
      jsonb_build_object('payout_request_id', v_row.id, 'status', v_row.status,
                         'utr', v_utr, 'amount_paise', v_row.amount_paise)
    );
  exception when others then
    null;  -- the notification table only exists on a project with the portal schema
  end;

  perform private.log_partner_audit(
    case when p_action = 'mark_paid' then 'partner_payout_paid' else 'partner_payout_rejected' end,
    'partner_payout_request', v_row.id,
    nullif(btrim(coalesce(v_partner.work_area, '')), ''), v_note,
    jsonb_build_object('partner_id', v_row.partner_id, 'amount_paise', v_row.amount_paise, 'utr', v_utr)
  );

  return jsonb_build_object(
    'id', v_row.id, 'status', v_row.status, 'amount_paise', v_row.amount_paise,
    'provider_reference', v_row.provider_reference, 'paid_at', v_row.paid_at,
    'rejection_reason', v_row.rejection_reason
  );
end $$;
revoke all on function public.admin_process_partner_payout(uuid, text, text, text) from public, anon;
grant execute on function public.admin_process_partner_payout(uuid, text, text, text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Audit trail read + export
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_list_audit_logs(
  p_target_type text default null,
  p_target_id uuid default null,
  p_limit integer default 100
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.admin_role := public.current_admin_role();
  v_area text;
  v_items jsonb;
begin
  if v_role is null then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if private.is_super_admin() then
    v_area := null;
  else
    v_area := public.current_admin_area();
    if v_area is null then
      raise exception 'No work area is assigned to your account' using errcode = '42501';
    end if;
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v_items
    from (
      select l.id, l.actor_id, l.actor_email, l.actor_role, l.action, l.target_type, l.target_id,
             l.work_area, l.reason, l.details, l.created_at
        from public.partner_audit_logs l
       where (p_target_type is null or l.target_type = p_target_type)
         and (p_target_id is null or l.target_id = p_target_id)
         and (v_area is null or l.work_area = v_area)
       order by l.created_at desc, l.id desc
       limit least(greatest(coalesce(p_limit, 100), 1), 500)
    ) x;
  return jsonb_build_object('items', coalesce(v_items, '[]'::jsonb));
end $$;
revoke all on function public.admin_list_audit_logs(text, uuid, integer) from public, anon;
grant execute on function public.admin_list_audit_logs(text, uuid, integer) to authenticated, service_role;

-- Export is the one read that only a super admin may take, and the rule lives
-- in SQL as well as in the route layer: hiding a button is not a control.
create or replace function public.admin_export_partner_directory(
  p_area text default null,
  p_status text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_area text; v_role public.admin_role := public.current_admin_role();
begin
  if not private.is_super_admin() then
    raise exception 'Only a Super Admin can export partner data' using errcode = '42501';
  end if;
  v_area := nullif(btrim(coalesce(p_area, '')), '');
  perform private.log_partner_audit('partner_directory_exported', 'partner_directory', null, v_area, null,
    jsonb_build_object('status_filter', p_status));
  return public.admin_partner_directory(v_area, p_status, null, 200, 0, true);
end $$;
revoke all on function public.admin_export_partner_directory(text, text) from public, anon;
grant execute on function public.admin_export_partner_directory(text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
