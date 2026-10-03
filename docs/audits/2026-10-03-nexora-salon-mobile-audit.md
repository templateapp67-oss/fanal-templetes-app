# nexora-salon: public link and mobile preview audit

## Live evidence

The canonical public link returned HTTP 200. Its /api/site response returned found:true, saved template barber, business name new salon, five services, zero public staff, and an empty cover. The normalized database agrees that the selected template is barber; business_type remains hair_salon and must not override the design. The delivered CSS asset index-DU7pjxZ2.css has zero named salon container queries, so the new responsive patch is not deployed.

The connected Vercel account lists only final-new-app-templete. Access to the actual live deployment was denied with HTTP 403. No production deployment, database mutation, PR or merge was performed.

## Changes

- The shared website canvas is a named inline-size container. Header, hero, contact area, gallery, video grids and service cards respond to the canvas width instead of the outer desktop editor viewport.
- Narrow frames give the brand its own row before booking/contact actions. The salon name no longer collapses to one character per line.
- Preview wrapper uses overflow-x:clip so its sticky toolbar does not create a nested scrollport and cover the salon heading. Preview salon headers remain in normal flow.
- Mobile preview renders one in-frame dock instead of duplicate native/preview docks.
- Template and credential badges use SVG icons, so failed icon-font loading cannot expose material-symbol identifiers across the brand name.
- Mobile hero descriptions are limited to six lines; the About section retains the full text.
- VIP preview uses the same registered design renderer as its editor/public page. Its previous standalone demo bypassed published content and device controls.

## Validation

Real Chromium exercised /templates/:id/preview for all 27 registry entries with a 1440px outer browser and Mobile selected. Every canvas stayed at phone width; names had at least 200px usable width and fewer than 120px height; headers wrapped, had no horizontal overflow and stayed under 260px. The reported Barber toolbar/heading overlap has an explicit geometry assertion. Four published widths (320/390/768/1440) used the captured live public API payload against the changed local build and had no document overflow or page errors.

External media/fonts were blocked during this browser matrix to keep it deterministic; this also tested icon/image fallbacks. It does not verify third-party media availability or the deployed production browser. agent-browser could not start its daemon in this environment, so Chromium was controlled through Playwright pipes. No live booking/payment transaction was performed.

Full DOM suite: 257/257. TypeScript: pass. Production build: pass. Browser matrix: 27 preview designs and 4 published widths pass.

Reproduce tests/e2e/salonMobileFrames.mjs with a Playwright module, installed Chromium executable and SALON_SITE_FIXTURE pointing to a captured public /api/site response. Optional PLAYWRIGHT_MODULE, CHROME_EXECUTABLE_PATH and SALON_SCREENSHOT_DIR select those resources. Production deployment and the previously documented booking availability schema mismatch remain outstanding.
