# Template preview and website content wiring

## Delivered
- Every registered template (27) now has at least five relevant services, each with a category, description, image, INR price and duration.
- Explorer previews receive demo reels AND showcases, owner portrait/name/role/biography/experience/specialties, gallery and opening hours.
- Demo video cards are explicitly labelled. They use a sample animation player, not falsely attributed customer footage. Replace them with the salon's own YouTube links before publishing. Players load on click, with an external YouTube fallback.
- Shared YouTube management supports add/edit/delete, title, description, link and placement. Watch/Shorts/youtu.be links are parsed by the existing strict host validator. Direct video file uploads are not provided.
- Service images support URL or validated/compressed JPG/PNG/WebP upload. Both service editors expose image, details, price and duration.
- Address-based map embeds work without an API key. Saved coordinates are supported, invalid coordinates are rejected, and empty addresses do not invent a Mumbai location.
- Owner information, gallery, section headings and visibility use the saved profile rather than disposable preview state.
- Public site lookup now includes saved videos, gallery, public owner details, appearance/SEO settings, offers and promotional banner settings. Service presentation metadata is matched by tenant-scoped catalogue IDs; public booking IDs/prices remain authoritative.
- Saved opening hours, service category filters, dark/light appearance, promotional schedules/custom colours and custom SEO descriptions are reflected by the renderer.
- Explicit empty media/service lists remain empty after reload; template browsing does not overwrite an existing salon.

## Where to edit
- **SaaS Dashboard → Social & Reels:** YouTube videos.
- **SaaS Dashboard → Services:** images, details, rates, time, duration visibility; Add Service.
- **SaaS Dashboard → Appearance & Content:** owner portrait/bio, gallery, testimonials, headings and section visibility.
- **Website Editor:** shared content controls, services and address/map.
- **Preview → Edit / Customize:** inline services and the shared content controls.

For a new/empty owner website, use **Add missing starter content + 5 template services** in the Website Editor, or **Add 5 template services** on the dashboard's empty Services panel. This is an explicit import, not a background overwrite of an existing business's details. Intentionally deleted videos/gallery entries are restored only by the separate demo/gallery import buttons.

## Follow-up: end-to-end fixes and gap analysis

### Fixed and regression-tested
| Gap | Repair |
| --- | --- |
| Later SQL migrations replaced the normalized save transaction with a snapshot-only save | Added `20261022000000_restore_atomic_website_save.sql`, restoring one authenticated transaction for contact, services, staff, assignments/schedules, presentation metadata and the editor snapshot. |
| Deleted services reappeared from an old draft, with IDs unsuitable for booking | Public reads keep the normalized catalogue authoritative, including an empty catalogue. Metadata is matched to canonical service IDs. |
| One owner's latest draft could supply another of their websites' content | Snapshot identity must match the salon ID or its legacy slug; new published metadata is stored per salon. Multi-site deletion and slug/contact changes have PostgreSQL regression coverage. |
| A stale staff assignment made service deletion fail | Retired services remain in history, but cannot remain active staff assignments or online-booking options. Re-adding a service reactivates its canonical row. |
| Profile/media errors could be presented as successful saves | Shared validation for editor/HTTP paths, direct-RPC validation, caller-authenticated writes, and distinct validation/conflict/access/service-unavailable responses. Removed the unused service-role write fallback. |
| A failed workspace restore could be reported as an empty new workspace | Failed reads now return an explicit failure rather than claiming onboarding is needed. Unresolved workspace provisioning preserves the original save error. |
| Empty menus or paused websites could start booking a template fallback service | Preview booking only uses current services; no catalogue means no booking/authentication flow. |
| Clearing a cover image or testimonial did not reliably survive preview/reload | Explicit image removals are preserved; testimonials now live in the saved profile and have dashboard controls. |
| Delayed image uploads could restore deleted images or overwrite gallery changes | Upload sequence/value checks, unmount guards and functional gallery updates. |
| Maps wrote fabricated Mumbai coordinates/contact details or stale local inputs | Controlled address inputs, no mount-time writes, no fabricated geocoding success, bounded lookup requests, stale-response guards and address-based embedding. Added the geocode route to the serverless entry point. |
| Appearance/owner/media settings were missing in public projections | Public allowlists cover these fields; new per-site SQL metadata excludes arbitrary private profile fields. Authoritative booking prices/IDs and pause settings are not replaced by presentation JSON. |
| Tests used incomplete profiles, draft catalogue fallbacks or outdated route contracts | Updated the affected fixtures/assertions without bypassing identity checks or weakening partner approval. Added `npm run test:website`. |

### Verification performed
- **`npm run test:website`: 405 passed, 0 failed.** Covers all 27 starter kits, content validation, YouTube rules, save/auth/refresh/hydration, public mapping, routing, PostgreSQL transactions and real React DOM interaction tests.
- **PostgreSQL transaction tests:** apply the original normalized save, the actual contact/slug migration, the later save overrides, then the repair. Verify persistence, deletion/re-add, idempotency, rollback, private metadata exclusion, multi-site separation, and cross-account/anonymous denial.
- **HTTP round trip:** production save handler → local Auth/PostgREST test transport → actual PGlite transaction → authenticated reload → production public-content mapper. Verifies images, videos, gallery, headings, prices, canonical IDs and explicit deletions. The Auth transport is a test double; this is not a live Supabase deployment test.
- **DOM regressions:** controlled map hydration, unsafe image rejection, in-flight upload versus removal, empty/paused-menu booking, and testimonial deletion/remount.
- **`npm run typecheck` and `npm run build`: passed.** Build still reports large-bundle/dynamic-import warnings.
- **`git diff --check`: passed.**
- Local development preview is running on port 3000 in **mock mode**. A successful HTTP response verifies route serving, not a pixel-level browser check.

### Wider repository audit — not a global all-green claim
The broad audit run recorded:

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Non-DOM | 1,585 | 82 | 3 |
| DOM | 131 | 27 | 0 |

Six of those non-DOM failures were subsequently repaired (ESM imports, save fixtures, and owner-entry fixtures) and pass in the final 405-test focused run. **103 other observed failures remain unresolved**: 76 non-DOM and 27 DOM. Their names also appeared in the initial follow-up audit; that alone does not prove equivalence to the untouched base commit. The full suite was not rerun after the final targeted cleanup, and these counts are not presented as a fresh full-suite result.

See **`WEBSITE_AUDIT_REMAINING_FAILURES.json`** for the exact list. Main groups:
- Partner approval/access, referral attribution, partner portal APIs and browser flows.
- Legacy onboarding/secure-continuation fixtures with duplicate `save_owner_editor_state` definitions; those suites need their migration setup reconciled, not a weakened production authorization gate.
- Booking-create resilience and session-restoration coverage.

These require a separate cross-module remediation pass. This change does **not** certify that the entire application is bug-free or that every live SaaS integration works.

## Required rollout

**A database migration IS required for the repaired save path.** The earlier presentation-only implementation did not identify the later SQL overrides; deploying frontend changes alone is insufficient.

1. Back up and validate in a staging copy of the normalized Supabase database.
2. Apply `supabase/migrations/20261022000000_restore_atomic_website_save.sql` after the existing migration chain, through the project's normal migration workflow. Its filename follows the repository's existing migration versions; it is not an execution-date claim. The repair preserves service/staff history and does not delete bookings.
3. Deploy this branch's API and frontend together. Verify the serverless API has the required Supabase configuration. Do not expose service-role credentials to the browser.
4. **Re-save previously affected websites as their owners.** The migration restores the transaction; it does not blindly replay all old private snapshots into public catalogues. Legacy snapshot-only sites with an empty normalized catalogue intentionally remain unbookable until an authorized save repairs them.
5. Test with two real owner accounts and a separate public-browser session: choose a template, import an empty starter kit, edit services/owner/media/map, save, reload, delete and re-save, and inspect the public site. Confirm another account cannot read/write the first workspace. Verify real availability/booking and any payments separately.

The live Vercel site and production Supabase database were **not deployed or modified** in this sandbox. Real browser visual checks, live YouTube availability/embedding permissions, remote geocoding and production bookings/payments remain release acceptance checks.
