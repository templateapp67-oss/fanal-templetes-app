# SEO and social-link persistence

## Canonical field contract

This React/Vite app uses the existing atomic `save_owner_editor_state` RPC,
not an unrelated flat `sites` upsert. These six values are part of the SAME
controlled `profile` state and save payload as every other Website Editor field:

| Requested API concept | Actual profile JSON key |
| --- | --- |
| seo_title | seoTitle |
| seo_description | seoDescription |
| seo_keywords | seoKeywords |
| instagram_url | instagramHandle (handle or full URL) |
| facebook_url | facebookPage |
| tiktok_url | tiktokHandle (handle or full URL) |

`owner_editor_state.state.profile` stores these keys. The atomic SQL function
also writes them to `salons.data.editor_profile` through its public allowlist.
Both manual save and the 1200ms autosave use App.tsx's centralized pipeline.
The current complete persistence migration already supports them; do NOT add
unused instagram_url/facebook_url columns to a different website table.

```ts
// Relevant subset of the existing full snapshot sent by the save handler:
await supabase.rpc('save_owner_editor_state', {
  p_state: {
    profile: {
      ...profile,
      seoTitle: profile.seoTitle,
      seoDescription: profile.seoDescription,
      seoKeywords: profile.seoKeywords,
      instagramHandle: profile.instagramHandle,
      facebookPage: profile.facebookPage,
      tiktokHandle: profile.tiktokHandle,
    },
    services,
    stylists,
    loyaltyConfig,
    selectedTemplateId,
  },
});
```

Use the existing App save pipeline rather than duplicating this call inside an
input handler: it provides hydration guards, debounce, draft recovery and the
manual success/failure UI.

## Fixes

- All six inputs are controlled and have accessible labels. Changes update
  shared profile state, not separate temporary component state.
- TikTok reads existing tiktokProfile/tiktokUrl aliases when the handle is empty
  (including empty template defaults). Edits and clears write ALL three aliases
  together, preventing an old alias from resurrecting a removed link. The legacy
  profile-row mapper also resolves these aliases consistently.
- A shared `parseSeoKeywords` splits commas, trims whitespace, removes empty
  entries and deduplicates case-insensitively, retaining the first spelling.
  The raw input remains unchanged while typing. Badges and generated metadata
  use that same parsed representation.
- The real live website header now includes TikTok alongside Instagram/Facebook.
  Handle and full-URL formatting is shared; unsupported schemes, credentials
  and mismatched external domains are not rendered as social links.
- The initial published HTML now contains saved title, description AND keywords.
  The metadata injector replaces stale/duplicate keywords tags and escapes text.
  The client SEO hook uses the same keywords instead of repopulating generic
  platform keywords after a user clears the field.

## Deployment and verification

No additional SQL or Storage bucket is required for these six fields if
`20261028000000_complete_website_editor_persistence.sql` is already applied.
Deploy the updated frontend, API and middleware to Vercel. A redeploy of an old
commit does not include workspace changes.

Test each field, save, refresh, then open the public site and inspect:
- Instagram/Facebook/TikTok links in the header;
- `<title>`, `<meta name="description">`, `<meta name="keywords">` in raw HTML;
- clearing fields and saving must not restore stale values on refresh.

Automated coverage:
- `tests/dom/seoSocialEditor.test.ts`: actual controlled-input events, save
  snapshot, remount, keyword badges, header icons and legacy TikTok clearing.
- `tests/seoSocialPersistence.test.ts`: real PostgreSQL atomic saves and public
  mapping, updates/clears for all six fields and crawler keywords injection.

Live Supabase/Vercel changes are not performed by these code edits.
