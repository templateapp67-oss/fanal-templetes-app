begin;
alter table public.shops add column if not exists salon_id uuid references public.salons(id) on delete set null;
alter table public.shops add column if not exists shop_attribution_id uuid references public.shop_attributions(id) on delete set null;
create unique index if not exists shops_owner_unique_idx on public.shops(owner_id);

create or replace function public.complete_shop_onboarding(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_owner uuid := auth.uid(); v_shop public.shops; v_partner public.growth_partners; v_org uuid; v_salon uuid; v_attr uuid; v_slug text;
begin
  if v_owner is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if nullif(trim(p_payload->>'shop_name'),'') is null or nullif(trim(p_payload->>'owner_name'),'') is null or nullif(trim(p_payload->>'contact_phone'),'') is null then raise exception 'Shop name, owner name and contact phone are required' using errcode='22023'; end if;
  if nullif(p_payload->>'referral_code','') is not null then
    select * into v_partner from public.growth_partners where referral_code=upper(trim(p_payload->>'referral_code')) and is_active and status='approved';
    if not found then raise exception 'Referral code is invalid or inactive' using errcode='22023'; end if;
  end if;
  insert into public.organizations(name,legal_name,display_name,business_category,contact_phone,created_by,status)
  values (p_payload->>'shop_name',p_payload->>'shop_name',p_payload->>'shop_name',coalesce(p_payload->>'business_type','salon'),p_payload->>'contact_phone',v_owner,'active') returning id into v_org;
  insert into public.organization_members(organization_id,user_id,role,status) values(v_org,v_owner,'owner','active');
  v_slug := lower(regexp_replace(coalesce(p_payload->>'shop_name','salon'),'[^a-zA-Z0-9]+','-','g')) || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,7);
  insert into public.salons(organization_id,owner_id,slug,name,phone,address,city,state,category,is_active,verified,data)
  values(v_org,v_owner,v_slug,p_payload->>'shop_name',p_payload->>'contact_phone',coalesce(p_payload->>'address',''),coalesce(p_payload->>'city',''),coalesce(p_payload->>'state',''),coalesce(p_payload->>'business_type','salon'),true,false,jsonb_build_object('selected_template_id',p_payload->>'selected_template_id','theme_key',p_payload->>'theme_key','upi_id',p_payload->>'upi_id','qr_payload',p_payload->>'qr_payload')) returning id into v_salon;
  if v_partner.id is not null then
    insert into public.shop_attributions(growth_partner_id,salon_id,attribution_method,status,attributed_at,effective_from,source_event_id,reason)
    values(v_partner.id,v_salon,'shop_owner_onboarding','pending',now(),now(),'shop-onboarding:'||v_owner::text,'Created by completed shop-owner onboarding') returning id into v_attr;
  end if;
  insert into public.shops(owner_id,shop_name,business_type,address,city,state,owner_name,contact_phone,referral_code,partner_id,selected_template_id,logo_path,theme_key,upi_id,qr_payload,onboarding_step,onboarding_status,completed_at,salon_id,shop_attribution_id)
  values(v_owner,p_payload->>'shop_name',coalesce(p_payload->>'business_type','salon'),coalesce(p_payload->>'address',''),coalesce(p_payload->>'city',''),coalesce(p_payload->>'state',''),p_payload->>'owner_name',p_payload->>'contact_phone',nullif(p_payload->>'referral_code',''),v_partner.id,p_payload->>'selected_template_id',nullif(p_payload->>'logo_path',''),nullif(p_payload->>'theme_key',''),nullif(p_payload->>'upi_id',''),nullif(p_payload->>'qr_payload',''),4,'completed',now(),v_salon,v_attr)
  on conflict (owner_id) do update set shop_name=excluded.shop_name,business_type=excluded.business_type,address=excluded.address,city=excluded.city,state=excluded.state,owner_name=excluded.owner_name,contact_phone=excluded.contact_phone,referral_code=excluded.referral_code,partner_id=excluded.partner_id,selected_template_id=excluded.selected_template_id,theme_key=excluded.theme_key,upi_id=excluded.upi_id,qr_payload=excluded.qr_payload,onboarding_step=4,onboarding_status='completed',completed_at=now(),salon_id=excluded.salon_id,shop_attribution_id=excluded.shop_attribution_id,updated_at=now() returning * into v_shop;
  update public.profiles set onboarding_completed=true where id=v_owner;
  return to_jsonb(v_shop) || jsonb_build_object('salon_id',v_salon,'shop_attribution_id',v_attr,'reward_status',case when v_attr is null then 'no_active_partner' else 'pending_15_day_qualification' end);
end $$;
revoke all on function public.complete_shop_onboarding(jsonb) from public, anon;
grant execute on function public.complete_shop_onboarding(jsonb) to authenticated;
commit;
