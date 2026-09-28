# Complete Website Editor persistence

## Actual architecture and failure

This checkout is React/Vite, not Next.js. `WebsiteEditor` calls its save prop;
`src/App.tsx` builds the full editor snapshot and calls `runSalonSavePipeline`.
The authenticated write in `src/lib/ownerEditorState.ts` calls
`save_owner_editor_state({ p_state })`. The HTTP fallback in
`server/websiteSave.ts` calls the same RPC, not a different schema or an
unrestricted service-role upsert. The old `SUPABASE_SETUP.md` toast originates
in `summarizeSaveError`, not a database constraint. New diagnostics retain the
missing object name where supplied by PostgreSQL/PostgREST.

The reported project mixes legacy `services.owner_id` with normalized salon
workspace tables. It was missing contact columns on salons, normalized service
columns, `staff_schedules.is_working`, and the atomic RPC helper functions.

## One SQL file for this reported project

Back up, then run the ENTIRE file below in the Supabase SQL Editor:

`supabase/migrations/20261028000000_complete_website_editor_persistence.sql`

It supersedes the 20261026 bridge; do not apply both or replay all historical
migrations. It assumes the existing profiles, salons, services, staff, schedule,
organization/membership tables and `nexora_owner_salon_ids()` already reported
by the user. It is not a fresh-database bootstrap.

The transaction adds the missing bridge columns, creates owner_editor_state
if absent, restores save helpers, and provides a caller-only snapshot read.
It replaces the RPC wrappers using DROP without CASCADE to handle differing
return types. If a dependency blocks replacement, the transaction fails rather
than deleting that dependency. It does not seed a salon or assign legacy
service ownership, change organization membership, or disable RLS.

The earlier `20261025000000_profile_owner_name_guard.sql` can separately repair
placeholder profile names from the same user's Auth metadata. If no real name
exists anywhere, Profile Settings must collect it; never guess from an email.

## Field contract (no duplicate flat website columns)

The full snapshot is `owner_editor_state.state`; each field below is inside
`state.profile`. Public presentation is copied through an allowlist into
`salons.data.editor_profile`. Arrays stay arrays, booleans stay booleans, and
explicit empty values are not replaced by demo defaults on refresh.

| Section | Canonical keys |
| --- | --- |
| Salon details | businessName, tagline, about, ownerName |
| Contact/location | phone, whatsapp, email, city, postalCode, areaLocality, address, state, landmark |
| Favicons | faviconLetter, faviconColor, customFaviconUrl |
| Brand system | primaryColor, secondaryColor, customAccentColor, backgroundColor, headingStyle, buttonStyle, borderRadius, appearance, themeAccentKey |
| Typography | headingFont, bodyFont |
| Social share image | socialShareImageUrl |
| SEO | seoTitle, seoDescription, seoKeywords |
| Social links | instagramHandle, facebookPage, tiktokProfile/tiktokHandle/tiktokUrl |
| Founder | ownerPhotoUrl, ownerName, ownerRole, ownerExperience, ownerQualifications, ownerBio |
| Videos/gallery/lookbook | socialVideos[], gallery[], lookbookPhotos[] |
| Testimonials | testimonials[] (name, comment, rating, etc.) |
| Sections/headings | sectionVisibility{}, sectionHeadings{}; whatsappFloat is camelCase |
| Experience/subdomain | scentProfile, soundscape, consultationStyle, subdomain, whiteLabelEnabled |

Desktop and Apple-touch icons are derived by `useSalonFavicon` from the saved
letter/color or custom image, not separately edited database assets. The custom
favicon upload also needs `20261027000000_website_favicon_bucket.sql` and the
updated frontend. Other uploads follow their existing upload paths.

## Refresh and account name

The existing account-scoped hydration calls `get_owner_editor_state()` and
`mergeHydratedSalonState`: saved fields replace startup defaults, but edits made
while the read was in flight survive. The new read RPC replaces stale snapshot
ownerName with the caller's real profiles.full_name. The save transaction does
the same before publishing. Rename the account through Profile Settings.

The editor's profile sync also replaces demo founder names with the verified
account name. Scent, soundscape and consultation previously lived only in
component-local useState; they now use the persisted profile and common save
pipeline. Lookbook photos were absent from the SQL public allowlist; they are
now validated and included alongside gallery items.

`?site=star-salon` is the PUBLIC site lookup in this repository, not authority to
read/edit another owner's private snapshot. Do not fetch private editor rows by
an arbitrary query-string slug. A signed-in owner's editor restores their
account-scoped workspace; public URLs read published salon metadata.

## Verification / deployment

Local tests execute real PostgreSQL (PGlite) save/read transactions and verify
all 13 sections, refresh merging, canonical profile names, account isolation,
repeat application and upgrade from the reported mixed schema. They do not
prove production deployment or fix a missing salon membership.

1. Apply the complete migration after backup.
2. Run `supabase/repairs/diagnose_website_save_schema.sql` again.
3. Deploy the updated frontend/API to Vercel (old toast wording implies the
   old build may still be deployed).
4. Save representative values in all sections, refresh the authenticated
   editor, and separately load the public site in a new browser context.
5. If `Select a salon owned by this account` appears, inspect owner workspace
   provisioning/membership instead of disabling RLS or assigning an owner by
   email. If a save fails, capture the exact missing object/constraint message.

## Crash/reload draft journal (frontend follow-up)

`src/lib/websiteDraft.ts` adds a synchronous pre-debounce safety net, wired to
`App.tsx` rather than a second competing save engine. Keys are
`nexora_draft_<ownerId>_<salonId>` (encoded components); before the first publish
has a canonical salon ID, the last component is `workspace`. This additional
owner scope avoids leaking drafts on shared browsers. It does not use a mutable
subdomain as the permanent key. Recovery after the first publish transfers the
workspace draft only for a matching owner and saved slug.

The journal stores both the last loaded/acknowledged cloud baseline and the
latest local snapshot. After cloud hydration, only fields changed locally from
that baseline override the cloud row; unrelated server updates survive. Account
identity/name remain authoritative. A save acknowledgement rebases newer edits
instead of deleting them. Only a matching saved snapshot clears the journal.
Cache failures are caught and logged, not reported as successful cloud saves.
Storage is browser-local, not encrypted; use it only on trusted devices.

Cloud writes remain paused until the authenticated workspace has loaded. The
non-blocking status notice now exposes loading/errors and a retry action.
Caching starts once the workspace baseline is established; it is not a substitute
for initial cloud hydration. Public/customer/partner views and signed-out users
cannot write this owner-editor journal. On hide/close the journal is written
synchronously; network flush is best-effort, not relied on for crash safety.

Existing centralized save entry points remain:
- `persistSalonState()` in App: validation, auth/hydration guard, cloud pipeline.
- `handleSaveNow()`: cancels debounce and requests an immediate manual save.
- `saveOwnerEditorState()` in src/lib/ownerEditorState.ts: authenticated,
  serialized Supabase `save_owner_editor_state` RPC writes.
- Auto-save debounce: `AUTOSAVE_DEBOUNCE_MS = 1200`.

Tests: `tests/websiteDraftRecovery.test.ts` cover refresh-before-debounce,
explicit clears/false values, unrelated cloud updates, tenant/site isolation,
newer edits during a save, first-publish transition and corrupt/quota-limited
storage. No database changes beyond the complete persistence migration are
required for this frontend draft journal.
