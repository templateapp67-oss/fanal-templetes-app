# Nexora repository audit and checkout fixes — 2026-10-07

Base: `main` at `55dd1983d50a4179e0c3de34f54711fb699376fc`.
Branch: `fix/e2e-gap-audit-20261007`. No merge or production database change.

This is a verified repair batch, **not a complete production E2E sign-off**.

## Runtime defects repaired

| Trigger | Previous behavior | Repair |
|---|---|---|
| A customer enters `9123456789` | Unconditional prefix stripping shortened the number to 8 digits, blocking booking and corrupting confirmation contact details | Shared length-aware normalization preserves subscriber digits and supports `+91`, `0091`, and trunk prefixes |
| Booking opens after midnight IST but before midnight UTC, or from abroad | Today/Tomorrow and the date input used UTC/browser dates | All three use the Indian salon's civil date; Tomorrow highlights only the actual next day |
| Guest details reach checkout, including a resumed draft | UI promised a WhatsApp OTP and displayed verification despite skipping verification; drafts could mark the phone verified | Remove unused mock OTP state, code and UI; show the entered contact number and never fabricate verification |
| A booking insert never responds | Automatic timeout retry consumed about 30 seconds and could repeat a write that committed late | Booking insert opts out of timeout retries, returns the existing retryable error after one 15-second attempt; quick transport retry remains covered |
| An optional profile WhatsApp field contains malformed text | Invalid nonempty input could be returned unchanged or cleared silently | Reject it; show the exact WhatsApp field error before starting a save; blank optional input still works |
| App state changes after a referral signup modal is closed | Fresh inline tracker options retriggered the URL effect and could reopen signup | Depend on the callback rather than the options object; navigation detection and clearing still work; browser storage uses `window` |

The existing fixed **25% advance** contract is retained. No new SMS/OTP service was introduced.

## Gap-list reconciliation

Read all three current supplied files: `1_TEMPLATES_missing_and_gaps(1).md`, `2_CUSTOMER_missing_and_gaps.md`, and `3_SHOP_OWNER_ADMIN_missing_and_gaps.md`. They are static audits from October 4, not current runtime acceptance evidence.

Already present in current code: 28 composition recipes, font variables, VIP editor integration, package resolution against the live menu, template package UI/management component, salon experience fields, customer password recovery, gender discovery filters, and booking price breakdown. Their presence does not establish live Supabase persistence or production payment success. This batch does not rebuild those features based on the old missing-item labels.

## Verification

- Original full Node suite: **1,982 tests; 1,927 passed, 52 failed, 3 skipped** on Node 24.19.0. Some fixture failures prevent subtests from being enumerated.
- Original full DOM suite: **382 passed, zero failures/skips**.
- Repair regressions: `npm run test:checkout`: **88 passed, zero failures/skips**.
- Complete DOM rerun: `npm run test:dom`: **385 passed, zero failures/skips**.
- TypeScript: passed.
- Production client/server build: passed; existing large-chunk warnings remain.
- `git diff --check`: passed.
- The isolated partner acceptance test passed all fifteen steps using React, local HTTP/Auth/RPC/RLS and disk-backed PostgreSQL; this is local acceptance, not the deployed Supabase project.
- DOM file concurrency is now bounded to two workers to avoid unbounded process/resource pressure.
- CI now runs checkout regressions and the complete DOM suite in addition to its existing typecheck/build/router checks.

No baseline failing tests were deleted or skipped. Regression coverage was added; one flaky DOM assertion was corrected to count referral queries rather than unrelated background requests. The complete Node suite remains a tracked blocker; the two repaired baseline failures were independently reproduced and rerun successfully.

## Remaining baseline failures

| Test file | Failed entries in baseline |
|---|---:|
| `tests/bookingCreateResilience.test.ts` | 1 |
| `tests/growthPartnerAccessRecovery.test.ts` | 2 |
| `tests/growthPartnerApproval.test.ts` | 2 |
| `tests/growthPartnerDirectAccess.test.ts` | 3 |
| `tests/growthPartnerEnrollment.test.ts` | 1 |
| `tests/growthPartnerOpenEnrollment.test.ts` | 1 |
| `tests/growthPartnerProfileBasics.test.ts` | 1 |
| `tests/headerNav.test.ts` | 1 |
| `tests/onboardingReferralPersistenceIntegration.test.ts` | 1 |
| `tests/onboardingStateResolution.test.ts` | 10 |
| `tests/part1SharedBackend.test.ts` | 3 |
| `tests/part1cSecurity.test.ts` | 4 |
| `tests/part3GrowthPartnerIntegration.test.ts` | 2 |
| `tests/partnerProfile.test.ts` | 1 |
| `tests/partnerReferralEventsRls.test.ts` | 2 |
| `tests/partnerSafeResponse.test.ts` | 2 |
| `tests/phase1ReferralRole.test.ts` | 1 |
| `tests/referralAttribution.test.ts` | 1 |
| `tests/referralAttributionLock.test.ts` | 2 |
| `tests/referralValidation.test.ts` | 1 |
| `tests/restoreAuthSession.test.ts` | 1 |
| `tests/secureContinuation.test.ts` | 8 |
| `tests/websiteSaveSchemaBridge.test.ts` | 1 |

The booking timeout and malformed WhatsApp failures in this table are repaired by this batch. Other failures require individual reconciliation:

1. **Migration fixture ordering:** onboarding state and continuation fixtures apply the newer `LOCAL_GROWTH_CHAIN` before older contact/editor definitions. The old `create function save_owner_editor_state` then collides with the already installed definition, aborting 18 cases. Repair fixture order and validate intended state behavior; do not overwrite current RPCs with older definitions merely to make tests pass.
2. **Outdated source/contract assertions:** several partner tests require old error wording, a literal direct enrollment call instead of the current guard path, historical table inventories or approval-only behavior. Header assertions require an exact CSS string. Determine the current contract and replace fragile assertions with meaningful behavior checks.
3. **Security assertions need targeted review:** a raw-source sweep flags auth environment diagnostics that detect prohibited service keys and referral query detection as authorization. These are not proof of an exposed key or authorization bypass. Preserve security checks and test the actual browser bundle/server boundary.
4. **Other contract/fixture failures:** referral attribution/events/RLS, PAN validation fixtures, auth restoration, remain unresolved. The website-save schema-bridge worker failed with a native V8/WASM JIT assertion on Node 24 after two tests passed; that entry is a runtime crash, not a proven application assertion failure. Rerunning the unchanged file on the CI runtime (Node 22.23.3) passes all five tests. Do not classify all remaining failures as harmless or use CI success as production acceptance.
5. **Live acceptance remains unverified:** authenticated owner/customer/partner accounts, deployed Supabase schema and storage policies, editor refresh/publish, live slot conflict prevention, captured Razorpay advance/webhook retries, and commission attribution need connected testing. No production credentials were inferred or migrations applied.

The wider saved-address, owner availability/reviews and platform-admin requirements from the gap documents are not implemented by this repair batch. Their implementation and live acceptance remain separate work.
