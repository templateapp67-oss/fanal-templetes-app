-- Sections 8–10: immutable, non-self attribution and privacy-minimized partner reads.
begin;

-- One referred user already has exactly one row (growth_onboarding.user_id PK).
-- Fail migration rather than silently rewriting any pre-existing self referrals.
alter table public.growth_onboarding drop constraint if exists growth_onboarding_no_self_referral;
alter table public.growth_onboarding add constraint growth_onboarding_no_self_referral
  check (growth_partner_id is null or growth_partner_id <> user_id);

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
    -- must supply the partner that owns the validated referral code.
    perform 1 from public.growth_partners gp where gp.user_id = new.growth_partner_id
      and gp.referral_code = new.referral_code and gp.is_active for share;
    if not found then raise exception 'Invalid or inactive referral code' using errcode = '22023'; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_growth_referral_identity() from public, anon, authenticated;
drop trigger if exists trg_guard_growth_referral_identity on public.growth_onboarding;
create trigger trg_guard_growth_referral_identity before insert or update on public.growth_onboarding
for each row execute function public.guard_growth_referral_identity();

-- No browser write path, even if an older deployment granted broader access.
revoke insert, update, delete, truncate, references, trigger on public.growth_onboarding from public, anon, authenticated;

create table if not exists public.growth_referral_admin_audit (
  id bigint generated always as identity primary key,
  referred_user_id uuid not null,
  old_partner_id uuid not null,
  new_partner_id uuid not null,
  old_referral_code text not null,
  new_referral_code text not null,
  actor_id uuid,
  reason text not null,
  changed_at timestamptz not null default now()
);
alter table public.growth_referral_admin_audit enable row level security;
revoke all on public.growth_referral_admin_audit from public, anon, authenticated;

-- Trusted administrator operation only, code-based just like normal linking.
create or replace function public.admin_correct_growth_referral(p_referred_user_id uuid, p_code text, p_reason text)
returns void language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  v_old public.growth_onboarding;
  v_partner uuid;
  v_code text := public.growth_normalize_code(p_code);
begin
  if not coalesce(private.is_admin(), false) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 or length(p_reason) > 1000 then
    raise exception 'An audit reason of 5–1000 characters is required' using errcode = '22023';
  end if;
  select * into v_old from public.growth_onboarding where user_id = p_referred_user_id for update;
  if not found or v_old.growth_partner_id is null then
    raise exception 'Existing referral required' using errcode = '22023';
  end if;
  select user_id into v_partner from public.growth_partners where referral_code = v_code and is_active for share;
  if v_partner is null or v_partner = p_referred_user_id then
    raise exception 'Invalid referral code or self referral' using errcode = '22023';
  end if;
  if (v_old.growth_partner_id, v_old.referral_code) is not distinct from (v_partner, v_code) then return; end if;
  update public.growth_onboarding set growth_partner_id = v_partner, referral_code = v_code
    where user_id = p_referred_user_id;
  insert into public.growth_referral_admin_audit
    (referred_user_id, old_partner_id, new_partner_id, old_referral_code, new_referral_code, actor_id, reason)
  values (p_referred_user_id, v_old.growth_partner_id, v_partner, v_old.referral_code, v_code, auth.uid(), btrim(p_reason));
end;
$$;
revoke all on function public.admin_correct_growth_referral(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_correct_growth_referral(uuid, text, text) to service_role;

-- Mask inside the database, never send raw contact data to the browser.
create or replace function public.growth_mask_referral_email(p_email text)
returns text language sql immutable
set search_path = pg_catalog, public, pg_temp as $$
  select case when length(btrim(p_email)) <= 254
    and btrim(p_email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    then left(split_part(btrim(p_email), '@', 1), least(2, greatest(0, length(split_part(btrim(p_email), '@', 1)) - 1)))
      || '***@' || lower(split_part(btrim(p_email), '@', 2))
    else null end;
$$;
revoke all on function public.growth_mask_referral_email(text) from public, anon, authenticated;

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
  if v_filter not in ('all', 'pending', 'in_progress', 'completed') then
    raise exception 'Unknown referral filter' using errcode = '22023';
  end if;
  if v_search is not null then
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  select count(*) into v_total
    from public.growth_onboarding o
    left join public.profiles p on p.id = o.user_id
    where o.growth_partner_id = v_partner.user_id
      and (v_filter = 'all'
        or (v_filter = 'pending' and o.status = 'linked')
        or (v_filter = 'in_progress' and o.status = 'template_started')
        or (v_filter = 'completed' and o.status = 'template_completed'))
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
           o.status as status,
           o.linked_at as linked_at,
           o.template_started_at as template_started_at,
           o.template_completed_at as template_completed_at
      from public.growth_onboarding o
      left join public.profiles p on p.id = o.user_id
      join auth.users u on u.id = o.user_id
      where o.growth_partner_id = v_partner.user_id
        and (v_filter = 'all'
          or (v_filter = 'pending' and o.status = 'linked')
          or (v_filter = 'in_progress' and o.status = 'template_started')
          or (v_filter = 'completed' and o.status = 'template_completed'))
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
revoke all on function public.get_my_partner_referrals(text, text, int, int) from public, anon;
grant execute on function public.get_my_partner_referrals(text, text, int, int) to authenticated;
comment on function public.get_my_partner_referrals(text, text, int, int) is
'Active caller own referrals only; server-masked email, minimal display/funnel fields. Converted means website/template completed, not a payment. No partner ID input.';
notify pgrst, 'reload schema';
commit;
