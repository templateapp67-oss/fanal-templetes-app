-- Referral lifecycle is separate from the forward-only website state machine.
begin;
alter table public.growth_onboarding add column if not exists referral_status_override text;
alter table public.growth_onboarding drop constraint if exists growth_referral_status_override_valid;
alter table public.growth_onboarding add constraint growth_referral_status_override_valid
  check (referral_status_override is null or referral_status_override in ('inactive', 'cancelled', 'rejected'));

create or replace function public.growth_effective_referral_status(p_onboarding text, p_override text)
returns text language sql immutable set search_path = pg_catalog, public, pg_temp as $$
  select coalesce(p_override, case p_onboarding when 'template_completed' then 'converted'
    when 'template_started' then 'active' else 'pending' end);
$$;
revoke all on function public.growth_effective_referral_status(text, text) from public, anon, authenticated;

create or replace function public.guard_growth_referral_status()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if (tg_op = 'INSERT' and new.referral_status_override is not null)
     or (tg_op = 'UPDATE' and new.referral_status_override is distinct from old.referral_status_override) then
    if not coalesce(private.is_admin(), false) then
      raise exception 'Administrator action required to change referral disposition' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_growth_referral_status() from public, anon, authenticated;
drop trigger if exists trg_guard_growth_referral_status on public.growth_onboarding;
create trigger trg_guard_growth_referral_status before insert or update on public.growth_onboarding
for each row execute function public.guard_growth_referral_status();

create table if not exists public.growth_referral_status_audit (
  id bigint generated always as identity primary key,
  referred_user_id uuid not null,
  old_status text not null,
  new_status text not null,
  actor_id uuid,
  reason text not null,
  changed_at timestamptz not null default now()
);
alter table public.growth_referral_status_audit enable row level security;
revoke all on public.growth_referral_status_audit from public, anon, authenticated;

-- null clears an admin disposition and resumes the real milestone-derived status.
create or replace function public.admin_set_growth_referral_status(p_referred_user_id uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_old public.growth_onboarding;
  v_status text := nullif(lower(btrim(p_status)), '');
begin
  if not coalesce(private.is_admin(), false) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if v_status is not null and v_status not in ('inactive', 'cancelled', 'rejected') then
    raise exception 'Unsupported referral disposition' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 or length(p_reason) > 1000 then
    raise exception 'An audit reason of 5–1000 characters is required' using errcode = '22023';
  end if;
  select * into v_old from public.growth_onboarding where user_id = p_referred_user_id for update;
  if not found or v_old.growth_partner_id is null then
    raise exception 'Existing referral required' using errcode = '22023';
  end if;
  if v_old.referral_status_override is not distinct from v_status then return; end if;
  update public.growth_onboarding set referral_status_override = v_status where user_id = p_referred_user_id;
  insert into public.growth_referral_status_audit(referred_user_id, old_status, new_status, actor_id, reason)
  values (p_referred_user_id, public.growth_effective_referral_status(v_old.status, v_old.referral_status_override),
    public.growth_effective_referral_status(v_old.status, v_status), auth.uid(), btrim(p_reason));
end;
$$;
revoke all on function public.admin_set_growth_referral_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_growth_referral_status(uuid, text, text) to service_role;

create or replace function public.get_my_partner_referrals(
  p_status_filter text default null,
  p_search text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_partner public.growth_partners%rowtype := public.partner_dashboard_caller();
  v_filter text := lower(btrim(coalesce(p_status_filter, 'all')));
  v_search text := nullif(btrim(left(coalesce(p_search, ''), 64)), '');
  v_like text;
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int := 0;
  v_rows jsonb := '[]'::jsonb;
begin
  -- Keep old filter keys working for existing clients.
  v_filter := case v_filter when 'in_progress' then 'active' when 'completed' then 'converted' else v_filter end;
  if v_filter not in ('all', 'pending', 'active', 'converted', 'inactive', 'cancelled', 'rejected') then
    raise exception 'Unknown referral filter' using errcode = '22023';
  end if;
  if v_search is not null then
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  select count(*) into v_total
    from public.growth_onboarding o
    left join public.profiles p on p.id = o.user_id
    where o.growth_partner_id = v_partner.user_id
      and (v_filter = 'all' or public.growth_effective_referral_status(o.status, o.referral_status_override) = v_filter)
      and (v_search is null or p.full_name ilike v_like escape '\');

  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows
  from (
    select '…' || right(o.user_id::text, 8) as ref,
           nullif(btrim(coalesce(p.full_name, '')), '') as display_name,
           public.growth_mask_referral_email(u.email) as masked_contact,
           u.created_at as joined_at,
           o.referral_code as referral_code,
           case when o.status = 'template_completed' then 'converted' else 'not_converted' end as conversion_status,
           greatest(o.linked_at, o.template_started_at, o.template_completed_at) as last_activity_at,
           public.growth_effective_referral_status(o.status, o.referral_status_override) as referral_status,
           o.status as status,
           o.linked_at as linked_at,
           o.template_started_at as template_started_at,
           o.template_completed_at as template_completed_at
      from public.growth_onboarding o
      left join public.profiles p on p.id = o.user_id
      join auth.users u on u.id = o.user_id
      where o.growth_partner_id = v_partner.user_id
        and (v_filter = 'all' or public.growth_effective_referral_status(o.status, o.referral_status_override) = v_filter)
        and (v_search is null or p.full_name ilike v_like escape '\')
      order by o.linked_at desc nulls last, o.user_id desc
      limit v_limit offset v_offset
  ) r;

  return jsonb_build_object(
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'rows', v_rows
  );
end;
$$;
create or replace function public.get_my_partner_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_partner public.growth_partners%rowtype := public.partner_dashboard_caller();
  v_total int := 0;
  v_completed int := 0;
  v_activity jsonb := '[]'::jsonb;
begin
  select count(*), count(*) filter (where o.status = 'template_completed')
    into v_total, v_completed
    from public.growth_onboarding o
    where o.growth_partner_id = v_partner.user_id;

  select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) into v_activity
  from (
    select s.type, s.ref, s.display_name, s.at from (
      select 'referral_added'::text as type,
             '…' || right(o.user_id::text, 8) as ref,
             nullif(btrim(coalesce(p.full_name, '')), '') as display_name,
             o.linked_at as at
        from public.growth_onboarding o
        left join public.profiles p on p.id = o.user_id
        where o.growth_partner_id = v_partner.user_id and o.linked_at is not null
      union all
      select 'website_started'::text,
             '…' || right(o.user_id::text, 8),
             nullif(btrim(coalesce(p.full_name, '')), ''),
             o.template_started_at
        from public.growth_onboarding o
        left join public.profiles p on p.id = o.user_id
        where o.growth_partner_id = v_partner.user_id and o.template_started_at is not null
      union all
      select 'website_completed'::text,
             '…' || right(o.user_id::text, 8),
             nullif(btrim(coalesce(p.full_name, '')), ''),
             o.template_completed_at
        from public.growth_onboarding o
        left join public.profiles p on p.id = o.user_id
        where o.growth_partner_id = v_partner.user_id and o.template_completed_at is not null
    ) s
    order by s.at desc
    limit 8
  ) e;

  return jsonb_build_object(
    'partner', jsonb_build_object(
      'referral_code', v_partner.referral_code,
      'is_active', v_partner.is_active,
      'partner_since', v_partner.created_at
    ),
    'kpis', jsonb_build_object(
      'total_referrals', v_total,
      'active_onboarding', v_total - v_completed,
      'completed', v_completed
    ),
    'referral_status_counts', (
      select jsonb_build_object(
        'pending', count(*) filter (where public.growth_effective_referral_status(o.status, o.referral_status_override) = 'pending'),
        'active', count(*) filter (where public.growth_effective_referral_status(o.status, o.referral_status_override) = 'active'),
        'converted', count(*) filter (where public.growth_effective_referral_status(o.status, o.referral_status_override) = 'converted'),
        'inactive', count(*) filter (where o.referral_status_override = 'inactive'),
        'cancelled', count(*) filter (where o.referral_status_override = 'cancelled'),
        'rejected', count(*) filter (where o.referral_status_override = 'rejected')
      ) from public.growth_onboarding o where o.growth_partner_id = v_partner.user_id
    ),
    'recent_activity', v_activity
  );
end;
$$;
-- Replacements retain the existing restricted RPC grants.
revoke all on function public.get_my_partner_referrals(text, text, int, int) from public, anon;
grant execute on function public.get_my_partner_referrals(text, text, int, int) to authenticated;
revoke all on function public.get_my_partner_dashboard() from public, anon;
grant execute on function public.get_my_partner_dashboard() to authenticated;
notify pgrst, 'reload schema';
commit;
