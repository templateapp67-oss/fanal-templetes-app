-- Public social graphics only; never private documents.
-- Canonical og_image_url mapping: owner_editor_state.state.profile.socialShareImageUrl
-- and salons.data.editor_profile.socialShareImageUrl, saved by the atomic RPC.
-- SEO title/description use seoTitle/seoDescription in the same profile JSON.
begin;
-- Never turn an existing private bucket public: it may contain private files.
do $$ begin
  if exists(select 1 from storage.buckets where id='brand-assets' and public is distinct from true) then
    raise exception 'brand-assets already exists as a private bucket. Review its contents or choose a dedicated public social-image bucket before proceeding.';
  end if;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('brand-assets','brand-assets',true,2097152,array['image/png','image/jpeg','image/webp']::text[])
on conflict(id) do update set public=excluded.public,
  file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists brand_asset_insert_own on storage.objects;
create policy brand_asset_insert_own on storage.objects
for insert to authenticated with check (
  bucket_id='brand-assets' and (storage.foldername(name))[1]=(select auth.uid())::text
);
drop policy if exists brand_asset_select_own on storage.objects;
create policy brand_asset_select_own on storage.objects
for select to authenticated using (
  bucket_id='brand-assets' and (storage.foldername(name))[1]=(select auth.uid())::text
);
drop policy if exists brand_asset_delete_own on storage.objects;
create policy brand_asset_delete_own on storage.objects
for delete to authenticated using (
  bucket_id='brand-assets' and (storage.foldername(name))[1]=(select auth.uid())::text
);
-- Unique names + upsert:false: no UPDATE permission is required.
notify pgrst,'reload schema';
commit;
