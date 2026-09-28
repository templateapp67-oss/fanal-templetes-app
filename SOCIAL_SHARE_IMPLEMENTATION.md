# Social share images: upload → save → crawler-visible HTML

This repository uses React/Vite + Express/Vercel, not Next.js. The feature is
integrated into the existing Website Editor and atomic save pipeline.

## Deploy

1. Back up/review Storage policies, then run the whole file:
   `supabase/migrations/20261029000000_social_share_brand_assets.sql`.
2. The website persistence migration (`20261028000000_complete_website_editor_persistence.sql`)
   must already be applied. Do not replay every historical migration.
3. Deploy updated frontend, API and root `middleware.ts` to Vercel.
4. Upload/generate a card, set SEO title/description, press **Save & Update Website**,
   refresh, and inspect the public URL's raw HTML (not just the browser Elements tab).

The `brand-assets` bucket is public, limited to PNG/JPEG/WebP and 2 MB. Authenticated
users insert/select/delete only under their own UUID folder. Unique filenames
avoid overwrite races and stale CDN images. The migration refuses to make an
existing PRIVATE bucket public. Existing broad Storage policies must be reviewed;
PostgreSQL permissive policies combine with OR. Do not store private documents here.

## Field mapping / schema

The app already stores the complete profile in JSONB. Do not add an unused flat
`og_image_url` column to salon_public_websites:

| Requested field | Existing state | Durable storage |
| --- | --- | --- |
| og_image_url | profile.socialShareImageUrl | owner_editor_state.state.profile.socialShareImageUrl |
| seo_title | profile.seoTitle | owner_editor_state.state.profile.seoTitle |
| seo_description | profile.seoDescription | owner_editor_state.state.profile.seoDescription |

The atomic RPC also copies these public fields into
`salons.data.editor_profile`. The public lookup API uses that public metadata.
No private editor snapshot is fetched by the public HTML renderer.

## Upload and state

`src/lib/socialShareAssets.ts` validates the ORIGINAL file (2 MB, raster types),
centre-crops it to exactly 1200×630, then uploads a raster blob with a verified
Auth identity to `brand-assets/<user-id>/social/<uuid>.jpg`. It verifies identity
again after uploading before returning the public URL. SVG uploads are not accepted.
The original crop is not retained; the UI describes this behaviour.

```tsx
const image = await prepareSocialShareImage(file);
const publicUrl = await uploadSocialShareImage(supabase, image, profile.ownerId);
setProfile(previous => ({ ...previous, socialShareImageUrl: publicUrl }));
```

WebsiteEditor shows busy/error states and disables competing actions during the
upload. Failures retain the previous image. Uploaded URLs enter the same debounced
save/draft path as the other profile fields. An upload success means **uploaded**,
not **published**. Clear writes an explicit empty string rather than undefined.
Old objects are deliberately not immediately deleted: they may still be referenced
by the last published snapshot or an in-flight save. Orphan cleanup is a separate
retention task and must check references before deleting.

## Branded generator — accurate limitation

The existing “Generate with AI” implementation was HTML Canvas, NOT an AI model.
It is now honestly labelled **Generate branded card**. It renders the salon name,
tagline, primary color, phone and location to 1200×630 and uploads the result to
Storage exactly like a custom image. Generation is disabled while an active image
exists; clear it first so a custom upload is never silently replaced.

There is no billed AI image-model integration in this implementation. Adding one
requires a server-side, authenticated provider endpoint and its private API key;
never put such a key into browser environment variables. The deterministic branded
fallback works without that provider and does not claim verified-business status.

## Save payload

The editor uses App.tsx's centralized pipeline. Its Supabase function is
`saveOwnerEditorState` (`src/lib/ownerEditorState.ts`); conceptually:

```ts
await saveOwnerEditorState(supabase, {
  ownerId: user.id,
  profile: {
    ...profile,
    socialShareImageUrl: publicUrl,
    seoTitle,
    seoDescription,
  },
  services,
  stylists,
  loyaltyConfig,
  selectedTemplateId,
});
```

The actual handler calls `supabase.rpc('save_owner_editor_state', { p_state })`.
Use the existing App pipeline from UI actions so hydration guards, local recovery,
auth refresh, retries and save status remain consistent. Do not introduce a second
upsert with guessed table columns.

## Preview and metadata

`SocialSharePreview.tsx` uses the same `socialMetadata()` mapper as the server.
It shows the active image (or cover/portrait fallback), SEO title, SEO description
and the real site host. It is an approximation: apps control their layout/cache.

`middleware.ts` → `server/publicSocialPage.ts` serves initial HTML with metadata
for `/?site=<slug>` and supported tenant/custom-domain root URLs on Vercel. It
fetches only the existing public site API plus static index.html, with a timeout,
no cookies/tokens forwarded, no shared HTML caching, and no index.html recursion.
API failures fall through to the normal SPA instead of breaking the site.
Express development/production hosts use the same metadata injector in server.ts.

`injectSocialMetadata()` escapes owner-controlled text, rejects non-HTTP image
URLs (data URLs cannot be crawler images), replaces stale duplicate tags and keeps
bundled script assets intact. Tenant `?site=` identity remains in og:url/canonical.
For an active prepared social image, the returned HTML contains:

```html
<meta property="og:image" content="https://PROJECT.supabase.co/storage/v1/object/public/brand-assets/USER/social/IMAGE.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:title" content="Saved SEO title">
<meta property="og:description" content="Saved SEO description">
<meta name="twitter:card" content="summary_large_image">
```

Cover/portrait fallbacks do not claim dimensions we have not measured. The client
SEO hook uses the same mapper for navigation, but crawler support does NOT depend
on React executing.

## Verification

`tests/socialShareImplementation.test.ts` covers initial HTML, escaped metadata,
site-specific canonical URLs, SEO preview text, upload validation/auth scoping,
Storage RLS isolation, repeatable migration, and real PostgreSQL snapshot/public
metadata round-trips including clearing the image. This does not prove live
Supabase/Vercel deployment.

After deployment, inspect with:

```sh
curl -s 'https://fanal-templetes-app.vercel.app/?site=star-salon'
```

Check og:image and dimensions in that response, open the image URL while signed
out, then test with Facebook Sharing Debugger / WhatsApp / iMessage. Third-party
previews can remain cached even after a successful database save; refresh their
cache where tooling permits. Do not report a crawler cache as data loss.
