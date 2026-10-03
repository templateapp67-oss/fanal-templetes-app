# Nexora core flow audit — 2026-10-03

Status: confirmed code defects repaired; end-to-end production completion is blocked. This branch is not a production sign-off.

Base: `main` at `9ebd6647d61892f28477f5d34278a3d8905b3878`.

## Repaired defects

| Trigger | Before | Result |
|---|---|---|
| A browser submits `depositPercent: 1` to normalized checkout | Gateway order inherited the browser percentage | The validated server quote always uses 25% |
| A captured payment is less than the required advance | Any positive amount up to the total could pass | Insufficient advances are rejected before the booking RPC |
| A deleted salon or invalid catalogue price reaches booking creation | Creation did not match the availability deletion filter; bad amounts could reach persistence | Deleted salons are excluded; invalid paise values are rejected |
| Security overview RPC fails | Most failures and the Retry control were hidden | A field-specific notice and Retry appear while account forms remain usable |
| Auth MFA uses its actual `data.all` response | The client only read `data.factors`, so a verified authenticator could be shown as off | The Auth all-factor list is read and overrides a stale database mirror |
| Both security overview and MFA reads fail | UI could report 2FA off | MFA status remains unknown |
| Security overview RPC is absent | A fallback fabricated a current-session row and timestamps | The failure is surfaced; no session/log is fabricated |
| Booking checks use an injected clock | Date validation used the real wall clock | The booking path consistently uses its configured clock |
| An unrelated origin calls the cookie-based referral endpoint | The origin was reflected with credentials | Cross-site requests are rejected before rate limiting or database access |
| Photo regression exists in a `.test.tsx` file | DOM and partner commands only included `.test.ts` | Both commands now include the photo regression |

## Verification

- Focused checkout, booking, security and photo suites: **89 passed, 0 failed**.
- Referral cookie/origin and rate-limit regression subset: **3 passed, 0 failed**.
- TypeScript: passed.
- Production Vite/server build: passed; existing bundle-size warnings remain.
- `git diff --check`: passed.
- Broad baseline: 1,925 tests; 1,858 passed, 64 failed, 3 skipped.
- Broad rerun: 1,894 tests; 1,834 passed, 57 failed, 3 skipped. Some fixture files abort before all subtests are enumerated, so totals are not directly comparable.
- DOM baseline: 225 tests; 198 passed, 27 failed.
- DOM rerun (including `.tsx`): 227 tests; 202 passed, 25 failed.

No failing checks were deleted or marked skipped to claim a green suite. A pre-existing UI regression fixture now makes MFA unavailable explicitly when asserting unknown status; a separate regression verifies the real Auth `all` response.

## Connected backend evidence

The connected Supabase project is `zilwgiuiygqqardzutxi` (NEW FINAL TEMLETE APP), matching the checked-in example URLs. Its relationship to the requested deployed app could not be independently verified because that Vercel project is inaccessible through the current connection.

| Area | Observed mismatch / state | Impact |
|---|---|---|
| 25% settings | 4 rows, 0 invalid percentages; 25% constraint validated | Existing deposit repair is present |
| Booking creation | `nexora_create_customer_booking` and `record_verified_payment_capture` absent | Current normalized creation/capture path cannot complete on this project |
| Booking row | `customer_user_id`, `total_paise`, `appointment_start`, `appointment_end` absent | Server normalized projection does not match the live booking table |
| Payment/customer tables | `payments`, `salon_customers`, `staff_time_off` absent | Payment reuse and booking dependencies are missing |
| Availability | Live routine returns JSONB `available_slots`; server expects rows with `slot_start`, `slot_end`, `staff_id`, `total_paise` | Present function name does not establish compatibility |
| Availability internals | Routine references `bookings.primary_staff_id`, `starts_at`, `ends_at`, which are absent | This installed routine can fail when those branches execute |
| Referral signup | `capture_growth_referral`, `prepare_growth_referral_signup`, `growth_referral_attributions` absent | Capability-backed referral capture/signup requires reconciliation |
| Partner security | `get_my_partner_security_overview`, `partner_security_events`, `partner_deactivation_requests` absent | Overview and account-operation setup is incomplete |
| Storage | `partner-avatars` and `salon-media` buckets present | Bucket presence checked; actual upload policies/session path need authenticated verification |

All inspected public tables have RLS enabled. That does not prove grants or policies are sufficient. Security advisors also report 10 RLS-enabled tables without policies, 3 mutable function search paths, and callable SECURITY DEFINER functions requiring individual guard review. No blanket grants or policy weakening were applied.

Advisor references: [missing-policy review](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [function search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [public definer routines](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

## Deployment blocker

The current Vercel connection lists only `final-new-app-templete`, whose deployments point to `FINAL-NEW-APP-TEMPLETE-`, a different repository. Fetching `https://fanal-templetes-app.vercel.app/api/health?deep=1` through the connector was denied (403, `read_protection_bypass`). Update the Vercel connection to authorize the requested project's actual team/project. Confirm its configured Supabase URL before applying schema changes.

No production DDL, data changes, deployment, merge or pull request was performed. The read-only `scripts/audit-core-contracts.sql` reproduces core table/column/RPC compatibility checks. It is diagnostic SQL, not a repair migration.

## Remaining work

1. Match the requested Vercel project to its actual Supabase backend.
2. Reconcile the booking, payment, referral and security contracts against that schema, with a tested migration or matching API adapter; adding empty tables alone is insufficient.
3. Repair the failing migration fixtures and reconcile outdated partner review/enrollment and source-pattern expectations without changing the intended open-enrollment behavior.
4. Resolve remaining behavioral failures in signup recovery, referral persistence and partner navigation.
5. Verify fresh signup/login, refresh persistence, template selection/editor save, publish/public site, slots, captured 25% advance, and referral attribution using separate owner/customer/partner accounts. Verify two-account isolation and webhook retries.

## Broad rerun failures by test file

### Node tests

| File | Failed entries |
|---|---:|
| `tests/bookingCreateResilience.test.ts` | 1 |
| `tests/growthPartnerAccessRecovery.test.ts` | 2 |
| `tests/growthPartnerApproval.test.ts` | 2 |
| `tests/growthPartnerDirectAccess.test.ts` | 3 |
| `tests/growthPartnerEnrollment.test.ts` | 1 |
| `tests/growthPartnerProfileBasics.test.ts` | 1 |
| `tests/headerNav.test.ts` | 1 |
| `tests/localSupabaseGateway.test.ts` | 2 |
| `tests/onboardingReferralPersistenceIntegration.test.ts` | 1 |
| `tests/onboardingStateResolution.test.ts` | 10 |
| `tests/ownerBookingRpcMigration.test.ts` | 1 |
| `tests/ownerWorkspaceProvisioning.test.ts` | 1 |
| `tests/part1SharedBackend.test.ts` | 3 |
| `tests/part1cSecurity.test.ts` | 4 |
| `tests/part3GrowthPartnerIntegration.test.ts` | 1 |
| `tests/partnerDashboardActivity.test.ts` | 1 |
| `tests/partnerProfile.test.ts` | 1 |
| `tests/partnerReferralEventsRls.test.ts` | 2 |
| `tests/partnerSafeResponse.test.ts` | 2 |
| `tests/phase1ReferralRole.test.ts` | 1 |
| `tests/publicSiteRoute.test.ts` | 1 |
| `tests/referralAttribution.test.ts` | 1 |
| `tests/referralAttributionLock.test.ts` | 2 |
| `tests/referralCodeAudit.test.ts` | 1 |
| `tests/referralValidation.test.ts` | 1 |
| `tests/restoreAuthSession.test.ts` | 1 |
| `tests/secureContinuation.test.ts` | 8 |
| `tests/signupIdempotency.test.ts` | 1 |

### DOM tests

| File | Failed entries |
|---|---:|
| `tests/dom/growthPartnerAccessRecovery.test.ts` | 2 |
| `tests/dom/growthPartnerBrowserFlow.test.ts` | 1 |
| `tests/dom/loginAndSignupRecoveryBrowserFlow.test.ts` | 2 |
| `tests/dom/onboardingJourneyBrowserFlow.test.ts` | 1 |
| `tests/dom/onboardingSignupBrowserFlow.test.ts` | 1 |
| `tests/dom/part3GrowthPartnerJourneyBrowserFlow.test.ts` | 1 |
| `tests/dom/partnerActivitySharingBrowserFlow.test.ts` | 1 |
| `tests/dom/partnerExistingReferralBrowserFlow.test.ts` | 2 |
| `tests/dom/partnerFinalAcceptance.test.ts` | 1 |
| `tests/dom/partnerPortalModulesBrowserFlow.test.ts` | 3 |
| `tests/dom/partnerPortalShellBrowserFlow.test.ts` | 2 |
| `tests/dom/partnerProfileEmptyStatesBrowserFlow.test.ts` | 2 |
| `tests/dom/partnerRouteGuardBrowserFlow.test.ts` | 3 |
| `tests/dom/publicReferralSharing.test.ts` | 1 |
| `tests/dom/referralAttributionBrowserFlow.test.ts` | 1 |
| `tests/dom/referralAttributionPersistence.test.ts` | 1 |

