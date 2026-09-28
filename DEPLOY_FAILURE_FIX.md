# Failed Vercel deployments — root cause and fix

Project: `templateapp67-oss-projects/fanal-templetes-app` (and its sibling
`nexora-shop-owner-pwa`, which deploys the same commit).

## 1. What was actually failing

Every Vercel deployment marked **"Deployment has failed"** on this repository has
the same cause — a production bundle that does not build:

| Deployment | Commit | Vercel state |
|---|---|---|
| Preview – fanal-templetes-app | `52e20292` | failure |
| Preview – fanal-templetes-app | `fe461cec` | failure |
| Preview – fanal-templetes-app | `2a167dd0` | failure |
| Preview – fanal-templetes-app / nexora-shop-owner-pwa | `d20620b8`, `1305ff2b`, `cb8b6f20`, `fe910a12` | failure |
| Production – fanal-templetes-app / nexora-shop-owner-pwa | `19eb6d4f` | failure |

Rebuilding those commits locally reproduces it exactly:

```
error during build:
src/components/PartnerReferralHistoryPage.tsx (19:2): "fetchMyPartnerReferredSalons"
is not exported by "src/lib/growthPartner.ts", imported by
"src/components/PartnerReferralHistoryPage.tsx".
```

An intermediate commit added the **Referral History page** (page, sidebar entry,
label, nav title) while `src/lib/router.ts` never learned about the section, and
the page imported `fetchMyPartnerReferredSalons`, which the library never
exported. Rollup fails on an unresolved named export, so `vite build` exits
non-zero and Vercel marks the deployment failed. `main` looked healthy only
because a later commit rewired the page to the existing
`fetchMyPartnerReferrals` RPC — the drift itself was still in the tree.

## 2. The drift left real breakage on `main`

`main` (before this fix) deployed, but it was **not** sound:

* `npm run typecheck` (`tsc --noEmit`) failed with **11 errors**, all from the
  same half-registered "Referral History" section
  (`GrowthPartnerSection` / `PartnerPortalSection`), plus two unrelated stale
  types.
* `GET /partner/referral-history` fell back to the **dashboard** — the newest
  partner-portal page had a sidebar entry but no working URL.
* `tests/partnerReferralHistory.test.ts`, two tests in
  `tests/partnerPortalShell.test.ts` and `tests/growthPartnerPage.test.ts`
  failed.

## 3. What this change does

| File | Change |
|---|---|
| `src/lib/router.ts` | Registers `referral-history` in the `GrowthPartnerSection` and `PartnerPortalSection` unions, in `GROWTH_PARTNER_SECTIONS`, `PARTNER_PORTAL_SECTIONS`, `PARTNER_PORTAL_MENU_SECTIONS` and `PARTNER_PORTAL_PATHS` (`/partner/referral-history`). The menu entry now has its own URL and its own page. |
| `src/components/PartnerPortalSections.tsx` | Renders the canonical `GROWTH_PARTNER_REFERRAL_CODE_UNAVAILABLE` ("Referral code not available.") instead of a hard-coded second wording; the constant was imported but unused. |
| `src/components/partner/PartnerReferralQRCode.tsx` | Same canonical sentence for the QR card's unavailable state. |
| `src/components/SaaSDashboard.tsx` | Imports the missing `Youtube` icon; passes a **number** to `compressAndResizeImage(file, maxDimension)`. The object form (`{ maxWidth, maxHeight }`) was silently skipping the resize — favicon/owner/social images were uploaded at full size. |
| `src/themeAccents.ts` | Drops the `barber_classic_gent` / `barber_modern_fade` / `barber_urban_grooming` keys left behind by an older catalog revision — no `BusinessTypeId` can produce them (the barber catalog ships `barber_grooming_club`). |
| `tests/routerSectionRegistry.test.ts` (new) | Deploy guard: every labelled section must be routable, every menu section must have a canonical `/partner/...` URL that resolves back to itself, every section must map to its own content (no dashboard fallback), and the sidebar registry must equal the router menu. |
| `tests/partnerReferralHistory.test.ts` | Pins the wiring that actually ships: the router registration, the shell entry, the page route, and `fetchMyPartnerReferrals` (the session-scoped, RLS-backed RPC) plus the `get_my_partner_referred_salons` migration. |
| `tests/growthPartnerPage.test.ts`, `tests/partnerPortalShell.test.ts` | Updated the two expectations that still described the pre-Referral-History registry. |
| `.github/workflows/deploy-guard.yml` (new) | Runs `tsc --noEmit`, the exact `vercel.json` build command and the registry suites on every push/PR. Vercel does not typecheck, so this is what stops a broken commit from being pushed and deployed. |

## 4. Verification

* `npm run typecheck` — clean (0 errors; was 11).
* `npm run build` — `vite build` + `esbuild dist/server.cjs` succeed.
* Registry + partner suites (`tests/routerSectionRegistry.test.ts`,
  `tests/partnerReferralHistory.test.ts`, `tests/partnerPortalShell.test.ts`,
  `tests/growthPartnerPage.test.ts`, `tests/growthPartnerShell.test.ts`) —
  **51/51 pass**.
* Server-rendered smoke check: `/partner/referral-history` →
  section `referral-history` → canonical `/partner/referral-history` → content
  `referral-history`, with the sidebar link present and `aria-current="page"`.
* The previous commits were rebuilt locally to confirm the failure mode above.

## 5. Still open (not caused by, and not fixed by, this change)

The repository's full suite (`npm test`, `npm run test:partner`) has ~40
pre-existing failures in the jsdom "browser flow" and onboarding-audit tests
(local Supabase/pglite fixtures, enrollment expectations). They are unrelated to
the deployment failures and are deliberately **not** part of the CI gate yet —
adding them would make `main` permanently red. `tests/bookingCreateResilience.test.ts`
also has one timing-sensitive assertion (30s deadline) that fails on a loaded
machine while its siblings pass.
