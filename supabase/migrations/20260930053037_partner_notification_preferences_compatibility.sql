-- Adapt notifications to projects where growth_partners uses user_id as its primary key.
begin;
do $migration$ begin
if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='growth_partners' and column_name='id') then
execute $ddl$
create or replace function public.my_active_partner_id() returns uuid language sql stable security definer set search_path='' as $body$
select user_id from public.growth_partners where user_id=auth.uid() and is_active;
$body$;
$ddl$;
create table if not exists public.partner_notification_preferences(
 partner_id uuid primary key references public.growth_partners(user_id) on delete cascade,
 email_enabled boolean not null default true,in_app_enabled boolean not null default true,updated_at timestamptz not null default now());
alter table public.partner_notification_preferences enable row level security;
revoke all on public.partner_notification_preferences from public,anon,authenticated;
grant select on public.partner_notification_preferences to authenticated;
drop policy if exists partner_preferences_select_own on public.partner_notification_preferences;
create policy partner_preferences_select_own on public.partner_notification_preferences for select to authenticated using(partner_id=public.my_active_partner_id());
execute $ddl$
create or replace function public.get_my_partner_notification_preferences()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(
   (select jsonb_build_object('email_enabled', email_enabled, 'in_app_enabled', in_app_enabled,
                              'updated_at', updated_at)
      from public.partner_notification_preferences
     where partner_id = public.my_active_partner_id()),
   jsonb_build_object('email_enabled', true, 'in_app_enabled', true, 'updated_at', null)
 );
$$;

create or replace function public.update_my_partner_notification_preferences(p_email_enabled boolean, p_in_app_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_partner uuid := public.my_active_partner_id(); v_result jsonb; begin
  if v_partner is null then
    raise exception 'Active Growth Partner required' using errcode = '42501';
  end if;
  insert into public.partner_notification_preferences
    (partner_id, email_enabled, in_app_enabled, updated_at)
  values (v_partner, coalesce(p_email_enabled, true), coalesce(p_in_app_enabled, true), now())
  on conflict (partner_id) do update
    set email_enabled = excluded.email_enabled,
        in_app_enabled = excluded.in_app_enabled,
        updated_at = now()
  returning jsonb_build_object('email_enabled', email_enabled, 'in_app_enabled', in_app_enabled,
                               'updated_at', updated_at)
    into v_result;
  return v_result;
end $$;

$ddl$;
execute $ddl$
create or replace function public.get_my_partner_notifications(p_type text default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $body$
declare actor uuid:=public.my_active_partner_id(); begin
if actor is null then raise exception 'Active Growth Partner required' using errcode='42501'; end if;
return jsonb_build_object('unread_count',(select count(*) from public.partner_notifications where partner_user_id=actor and read_at is null),
'items',coalesce((select jsonb_agg(to_jsonb(n)||jsonb_build_object('is_read',n.read_at is not null) order by n.created_at desc,n.id desc)
from (select id,title,body,notification_type,read_at,created_at from public.partner_notifications where partner_user_id=actor
and (p_type is null or notification_type=p_type) order by created_at desc,id desc limit least(greatest(coalesce(p_limit,50),1),100)) n),'[]'::jsonb));
end $body$;
create or replace function public.mark_my_partner_notifications_read(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path='' as $body$
declare actor uuid:=public.my_active_partner_id(); touched integer; begin
if actor is null then raise exception 'Active Growth Partner required' using errcode='42501'; end if;
update public.partner_notifications set read_at=now() where partner_user_id=actor and read_at is null and (p_ids is null or id=any(p_ids));
get diagnostics touched=row_count; return touched;
end $body$;
$ddl$;
revoke all on function public.my_active_partner_id(),public.get_my_partner_notification_preferences(),public.update_my_partner_notification_preferences(boolean,boolean),public.get_my_partner_notifications(text,integer),public.mark_my_partner_notifications_read(uuid[]) from public,anon;
grant execute on function public.my_active_partner_id(),public.get_my_partner_notification_preferences(),public.update_my_partner_notification_preferences(boolean,boolean),public.get_my_partner_notifications(text,integer),public.mark_my_partner_notifications_read(uuid[]) to authenticated,service_role;
end if;
end $migration$;
notify pgrst,'reload schema';
commit;
