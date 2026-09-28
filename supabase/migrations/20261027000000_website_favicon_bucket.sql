-- Favicon letter/color/URL are saved by save_owner_editor_state in JSON:
-- owner_editor_state.state.profile and salons.data.editor_profile.
-- No new profiles columns or website ownership mapping are required.
-- PUBLIC bucket: for website icons only, never private documents.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('website-favicons','website-favicons',true,2097152,array['image/png','image/jpeg','image/webp']::text[])
on conflict(id) do update set public=excluded.public,
  file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists website_favicon_insert_own on storage.objects;
create policy website_favicon_insert_own on storage.objects
for insert to authenticated with check (
  bucket_id='website-favicons' and (storage.foldername(name))[1]=(select auth.uid())::text
);
drop policy if exists website_favicon_select_own on storage.objects;
create policy website_favicon_select_own on storage.objects
for select to authenticated using (
  bucket_id='website-favicons' and (storage.foldername(name))[1]=(select auth.uid())::text
);
drop policy if exists website_favicon_delete_own on storage.objects;
create policy website_favicon_delete_own on storage.objects
for delete to authenticated using (
  bucket_id='website-favicons' and (storage.foldername(name))[1]=(select auth.uid())::text
);
-- Unique names + upsert:false: no UPDATE permission is required.
notify pgrst,'reload schema';
commit;
