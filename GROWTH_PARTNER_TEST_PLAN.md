# Growth Partner component architecture and test coverage

## Run the focused regression suite

```sh
npm run test:partner
npm run typecheck
npm run build
```

The test command combines database, HTTP and DOM suites. Database tests apply
committed migrations to local PostgreSQL/PGlite fixtures; gateway tests use real
HTTP requests. DOM tests mount actual React components with controlled responses
and dispatch events. They test wiring and accessible behavior, not physical-device
pixel rendering. Tests do not connect to or modify a production database.

## Section 38 — Existing-framework component map

Keep the project's flat React/TypeScript component conventions and established
names rather than adding duplicate components just to match suggested names.

| Responsibility | Implementation |
|---|---|
| Partner layout | `PartnerPortalShell.tsx`; legacy `GrowthPartnerShell` remains in `GrowthPartnerPage.tsx` for its existing tab layout |
| Sidebar/drawer | Shared `PartnerPortalNavList` and nav-item components within `PartnerPortalShell.tsx`; desktop and mobile use the same navigation definition |
| Header | One header in `PartnerPortalShell.tsx`, with reusable `PartnerProfileMenu` and `PartnerNotificationsPanel`; layout owns coordinated drawer/menu focus state |
| Route guard | `PartnerRouteGuard.tsx`: shared hook delegates to `resolveGrowthPartnerGate`, handles login redirects, rejects stale-user verification and renders denied/loading states |
| Stat card | `PartnerStatCard.tsx`; `KpiCard` remains a compatibility export from `GrowthPartnerSections.tsx` |
| Referral code/share | `ReferralCodeCard` in `GrowthPartnerSections.tsx`, `PartnerReferralCodeSection`, and the shared `usePartnerClipboard` hook |
| Referral table | `ReferralTable.tsx`: masked referral and legacy customer presentations; no fetching, authorization decisions or metric calculation |
| Status badge | `ReferralStatusPill.tsx`, backed by the existing shared status descriptors/theme |
| Filters | `ReferralSearchControls.tsx`, shared status tabs and server-side paging controller |
| Details | `ReferralDetailsDrawer.tsx` with opaque resource IDs and backend-owned access checks |
| Profile | `GrowthPartnerProfilePage.tsx`, backed by the allowlisted profile RPCs and Auth-only email workflow |
| Account status | `PartnerStatusScreen.tsx` and the shared guard's pending/rejected views; prior status exports remain available from `GrowthPartnerPage.tsx` |
| Formatting | `partnerPresentation.ts`, reused by layout and tables without importing a whole page component |

`GrowthPartnerPage` remains the route/data controller: it verifies the caller's
own partner record, reads their own application only when no partner exists, and
runs section queries only for a ready guard. The guard is not a substitute for
Auth/RLS: each backend RPC still derives its caller server-side. Pending/rejected
status comes from the user's own database application, never a URL/localStorage
flag. Missing/failed verification never mounts a protected child. Identity changes
hide cached data until the new user's verification completes.

## Section 39 — Scenario-to-test map

| Requested scenario | Automated coverage |
|---|---|
| Partner can log in | `localSupabaseGateway.test.ts`, `growthPartnerLogin.test.ts`, `dom/partnerPortalLoginBrowserFlow.test.ts` |
| Normal user cannot enter dashboard | `growthPartnerAuthAudit.test.ts`, `localSupabaseGateway.test.ts`, `dom/partnerRouteGuardBrowserFlow.test.ts` |
| Suspended partner blocked | Gate and backend inactive-guard tests; new route matrix exercises every canonical and legacy protected route |
| Expired session redirected | New route matrix verifies canonical/legacy login destinations and no private RPCs |
| Valid code resolves partner | `publicPartnerReferral.test.ts`, `referralAttribution.test.ts` |
| Invalid code rejected | Public-code, attribution and onboarding error-recovery tests |
| Inactive partner code rejected | Public-code, attribution and fraud/privacy database tests |
| Case normalization | Public-code and attribution tests exercise lowercase/whitespace inputs |
| New signup attributed correctly | `referralAttribution.test.ts`, `partnerReferralsTable.test.ts`, `referralOwnershipJourney.test.ts` |
| Same user not duplicated | One-use attribution, global ledger account uniqueness, replay and rollback tests |
| Existing user not reassigned | Ownership journey/fraud tests and `dom/partnerExistingReferralBrowserFlow.test.ts` |
| Partner cannot self-refer | Attribution, fraud/privacy and physical ledger tests |
| Partner A sees own referrals | RLS, physical ledger, gateway and events tests |
| Partner A cannot read B's referrals | `partnerReferralEventsRls.test.ts`, `referralSearchDetails.test.ts`, `referralFraudPrivacy.test.ts`; includes broad-policy drift and opaque-ID guessing |
| Anonymous cannot read referrals | RLS/ledger/gateway tests execute with anonymous role and no authenticated session |
| Counts match database | `partnerDashboardMetrics.test.ts`, `partnerDashboardActivity.test.ts`, `growthPartnerDashboard.test.ts` |
| Status filters | `referralStatusTabs.test.ts`, `referralLifecycle.test.ts`, DOM status-tab flow |
| Pagination | Backend list tests and DOM search/details tests traverse 20-row pages and verify request offsets |
| Search | `referralSearchDetails.test.ts`, `growthPartnerReferredUsers.test.ts`, DOM search/details flow |

Additional guard tests cover pending/rejected accounts, approval retry, unmounted
private children and identity switching. Existing migration safety, session
spoofing, copy confirmation, profile security and error-redaction tests stay in
the same focused regression command; the requested scenarios do not replace them.

## Sections 40–41: integrated final acceptance

See `GROWTH_PARTNER_FINAL_ACCEPTANCE.md` for the sequential 15-step evidence and phase boundary. Run `npm run test:partner:acceptance` for React + real HTTP/Auth/RPC/RLS + disk-backed PGlite restart verification. The broad `npm run test:partner` gate now passes **364 tests**. This adds backend-integrated DOM coverage, not actual browser/device verification.
