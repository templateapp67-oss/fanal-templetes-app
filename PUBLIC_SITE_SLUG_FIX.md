# Public salon site (`/?site=slug`) — it opens the published template again

Reported: opening `https://fanal-templetes-app.vercel.app/?site=hello` as the
signed-in owner ended on **“Website unavailable”** instead of the salon's
website template. An anonymous visitor loading the same URL got the site, so
the difference had to be the owner's own browser state.

## Root causes

1. **Owner state hijacked the public URL.**
   While the tenant lookup was in flight, `isPublicSite` is still `false`. In
   that window:
   * the debounced auto-save was live, so a signed-in owner's pending hydration
     state could be written to the salon they were only *visiting* — the save
     commits `salons.slug` **and** the catalogue, so it can rename the slug the
     visitor is using or persist an empty service list;
   * the PHASE 2 tenant-isolation effect called
     `setSiteTenant({ isTenant: false, found: false })` and, for
     `needs_onboarding`, `setCurrentView('wizard')` → `navigate('/')`, which
     **silently drops `?site=slug`**. The next lookup is host-based, finds no
     tenant on `*.vercel.app`, and the page falls through to
     “Website unavailable”.

2. **One transient failure was a dead end.** A cold serverless start, a dropped
   connection or a database timeout answered the very first
   `GET /api/site?site=…` with a 5xx, and the app immediately rendered
   “Website unavailable” with no retry and no way back.

3. **The published template rendered empty.** Both published salons
   (`hello`, `star-salon`) return a salon row with **zero** `services`/`staff`.
   The public lookup reads only the normalized catalogue, so the visitor got a
   template with an empty menu, and the owner's chosen template id was never
   part of the public payload at all.

4. **Visitors were shown the owner's address form.** The location card rendered
   `InteractiveMapSetup` for everybody: a “Salon Address & Localization Setup”
   form with inputs, “Use Current Location”, and that component's hard-coded
   Mumbai fallback address (`Linking Road, Santa Cruz West…`) on salons that
   never entered one.

## Fixes

| # | Change |
|---|--------|
| 1 | `src/App.tsx` — every owner-side read/write effect now guards on `shouldBlockForSiteLookup` (the whole lookup window), not only on `isPublicSite`: auto-save, appointment cloud sync, workspace resolution, profile sync and tenant isolation. A public salon URL is read-only, end to end. |
| 2 | `src/App.tsx` — `fetchSiteJsonWithRetry` retries transport/5xx/408/429 failures (3 attempts, backoff). A JSON verdict — including `found: false` — is never retried. The “Website unavailable” screen now shows the failing slug and offers **Try again** / **Reload the page**. |
| 3 | `server/siteLookup.ts` — the public payload now carries `selectedTemplateId`, and the owner's saved editor draft is a **fallback** for an empty catalogue: the normalized catalogue always wins when it has rows, the draft only fills empty slots, and only empty profile text fields. Malformed rows are dropped and staff phone numbers are never published. |
| 3 | `src/App.tsx` — the public site renders the tenant's `selectedTemplateId`, so a salon opens its own chosen template instead of this browser's default. |
| 4 | `src/components/SalonWebsitePreview.tsx` — `publicView` renders a read-only `PublicLocationMap` (map, address, “View on Google Maps”, “Get Directions”). The editable `InteractiveMapSetup` is owner-only again. |

## Tests

* `tests/publicSiteRoute.test.ts` (new) — pins the read-only guards, the retry,
  the escape hatches on the error screen, and the template hand-off.
* `tests/dom/publicSiteView.test.ts` (new) — mounts the real preview: a visitor
  never sees the owner address form or an invented address, the owner editor
  keeps it.
* `tests/normalizedBackend.test.ts` — catalogue-wins, empty-catalogue fallback,
  template id, profile fill rules, malformed draft rows, unreadable drafts.
* `tests/customerDataLayer.test.ts` — updated for the widened public-site guard.

`npm run typecheck`, `npm run build`, and the suites above pass. (The
growth-partner DOM suite and `ownerEntryRoute` failures are pre-existing and
unrelated — they fail identically on a clean checkout.)
