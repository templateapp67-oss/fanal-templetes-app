-- Growth Partner self-application. Approval is still required before access.
create table if not exists public.growth_partner_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  full_name text not null,
  phone text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.growth_partner_applications enable row level security;
revoke all on public.growth_partner_applications from public, anon;
grant select, insert on public.growth_partner_applications to authenticated;
drop policy if exists growth_partner_applications_self_select on public.growth_partner_applications;
create policy growth_partner_applications_self_select on public.growth_partner_applications
  for select to authenticated using (user_id = (select auth.uid()) or private.is_admin());
drop policy if exists growth_partner_applications_self_insert on public.growth_partner_applications;
create policy growth_partner_applications_self_insert on public.growth_partner_applications
  for insert to authenticated with check (user_id = (select auth.uid()) and status = 'pending');

create or replace function public.submit_growth_partner_application(p_full_name text, p_phone text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare actor uuid := auth.uid(); row public.growth_partner_applications;
begin
  if actor is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if nullif(btrim(p_full_name), '') is null then raise exception 'Full name is required' using errcode='22023'; end if;
  insert into public.growth_partner_applications(user_id, full_name, phone)
  values (actor, left(btrim(p_full_name),120), nullif(left(btrim(coalesce(p_phone,'')),30),''))
  on conflict (user_id) do update set full_name=excluded.full_name, phone=excluded.phone,
    status=case when public.growth_partner_applications.status='rejected' then 'pending' else public.growth_partner_applications.status end,
    review_note=case when public.growth_partner_applications.status='rejected' then null else public.growth_partner_applications.review_note end,
    updated_at=now()
  returning * into row;
  return jsonb_build_object('id',row.id,'status',row.status,'created_at',row.created_at);
end $$;
revoke all on function public.submit_growth_partner_application(text,text) from public, anon;
grant execute on function public.submit_growth_partner_application(text,text) to authenticated;

-- Admin-only approval. The function creates the production growth_partners row,
-- so applicants cannot self-assign partner access or referral ownership.
create or replace function public.review_growth_partner_application(p_application_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); app public.growth_partner_applications; code text; ref text;
begin
  if actor is null or not private.is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
  select * into app from public.growth_partner_applications where id=p_application_id for update;
  if app.id is null then raise exception 'Application not found' using errcode='22023'; end if;
  if p_approve then
    code := 'NXGP-' || upper(substr(replace(app.user_id::text,'-',''),1,10));
    ref := 'REF-' || upper(substr(replace(app.user_id::text,'-',''),11,10));
    insert into public.growth_partners(user_id, partner_code, referral_code, status)
      values(app.user_id, code, ref, 'approved') on conflict (user_id) do update set status='approved';
    update public.growth_partner_applications set status='approved',review_note=nullif(btrim(p_note),''),reviewed_by=actor,reviewed_at=now(),updated_at=now() where id=app.id;
  else
    update public.growth_partner_applications set status='rejected',review_note=nullif(btrim(p_note),''),reviewed_by=actor,reviewed_at=now(),updated_at=now() where id=app.id;
  end if;
  return jsonb_build_object('id',app.id,'status',case when p_approve then 'approved' else 'rejected' end);
end $$;
revoke all on function public.review_growth_partner_application(uuid,boolean,text) from public, anon, authenticated;
notify pgrst, 'reload schema';
