begin;
create or replace function public.complete_shop_onboarding(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare v_owner uuid := auth.uid(); v_shop public.shops; v_partner public.growth_partners; v_workspace jsonb; v_salon uuid; v_attr uuid;
begin
  if v_owner is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if nullif(trim(p_payload->>'shop_name'),'') is null or nullif(trim(p_payload->>'owner_name'),'') is null or nullif(trim(p_payload->>'contact_phone'),'') is null then raise exception 'Shop name, owner name and contact phone are required' using errcode='22023'; end if;
  if nullif(p_payload->>'referral_code','') is not null then
    select * into v_partner from public.growth_partners where referral_code=upper(trim(p_payload->>'referral_code')) and is_active and status='approved';
    if not found then raise exception 'Referral code is invalid or inactive' using errcode='22023'; end if;
  end if;
  v_workspace := public.ensure_owner_workspace();
  v_salon := nullif(v_workspace->>'salon_id','')::uuid;
  if v_salon is null then raise exception 'Could not provision shop workspace' using errcode='P0001'; end if;
  update public.salons set name=p_payload->>'shop_name',phone=p_payload->>'contact_phone',address=coalesce(p_payload->>'address',''),city=coalesce(p_payload->>'city',''),state=coalesce(p_payload->>'state',''),category=coalesce(p_payload->>'business_type','salon'),data=coalesce(data,'{}'::jsonb)||jsonb_build_object('selected_template_id',p_payload->>'selected_template_id','theme_key',p_payload->>'theme_key','upi_id',p_payload->>'upi_id','qr_payload',p_payload->>'qr_payload'),updated_at=now() where id=v_salon;
  if v_partner.id is not null then
    insert into public.shop_attributions(growth_partner_id,salon_id,attribution_method,status,attributed_at,effective_from,source_event_id,reason)
    values(v_partner.id,v_salon,'deep_link','pending',now(),now(),'shop-onboarding:'||v_owner::text,'Created by completed shop-owner onboarding')
    on conflict do nothing returning id into v_attr;
    if v_attr is null then select id into v_attr from public.shop_attributions where growth_partner_id=v_partner.id and salon_id=v_salon order by created_at desc limit 1; end if;
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
