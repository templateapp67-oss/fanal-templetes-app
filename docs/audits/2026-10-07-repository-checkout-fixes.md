# Nexora repository audit and checkout fixes — 2026-10-07

Base: `main` at `55dd1983d50a4179e0c3de34f54711fb699376fc`.
Branch: `fix/e2e-gap-audit-20261007`. No merge or production database change.

The repository repair batch includes runtime fixes, regression coverage, migration-fixture reconciliation and complete CI test coverage. Production database deployment and real payment acceptance remain separate operator steps.

## Runtime defects repaired

| Trigger | Previous behavior | Repair |
|---|---|---|
| A customer enters `9123456789` | Unconditional prefix stripping shortened the number to 8 digits, blocking booking and corrupting confirmation contact details | Shared length-aware normalization preserves subscriber digits and supports `+91`, `0091`, and trunk prefixes |
| Booking opens after midnight IST but before midnight UTC, or from abroad | Today/Tomorrow and the date input used UTC/browser dates | All three use the Indian salon's civil date; Tomorrow highlights only the actual next day |
| Guest details reach checkout, including a resumed draft | UI promised a WhatsApp OTP and displayed verification despite skipping verification; drafts could mark the phone verified | Remove unused mock OTP state, code and UI; show the entered contact number and never fabricate verification |
| A booking insert never responds | Automatic timeout retry consumed about 30 seconds and could repeat a write that committed late | Booking insert opts out of timeout retries, returns the existing retryable error after one 15-second attempt; quick transport retry remains covered |
| An optional profile WhatsApp field contains malformed text | Invalid nonempty input could be returned unchanged or cleared silently | Reject it; show the exact WhatsApp field error before starting a save; blank optional input still works |
| App state changes after a referral signup modal is closed | Fresh inline tracker options retriggered the URL effect and could reopen signup | Depend on the callback rather than the options object; navigation detection and clearing still work; browser storage uses `window` |

| Session recovery fails or stalls | A failed session read was treated as a successful signed-out result | Preserve the known identity, expose the existing retry state, and cancel recovery timers on success, auth events and disposal |
| Referral signup capability is prepared | The latest lookup replacement no longer recorded the factual signup-start milestone | Add an idempotent repair RPC that records it once and rejects expired, consumed, rotated and banned-partner capabilities |
| An existing partner is provisioned with a different requested code | The database preserved the canonical code but returned the unsaved requested code | Return the values actually stored after the idempotent upsert; retain service-only provisioning |
| A publicly prefixed variable contains an opaque service/secret key | Value-based detection could miss the secret before bundling | Reject nonempty public-prefixed service, secret and private variable names without echoing values |

The existing fixed **25% advance** contract is retained. No new SMS/OTP service was introduced.

## Backend and security test reconciliation

Migration fixtures now apply owner-state definitions in chronological order and
finish with the canonical atomic website persistence RPC. They include the
production staff-schedule table and valid operational profile/PAN inputs. Owner
slugs are unique per fixture account. Partner tests follow the current validated
application and enrollment contract, while historical approval behavior is tested
against the compatibility schema that actually uses it.

Security checks still exercise cross-account reads/writes, direct event access,
forged referral payloads, replay, immutable first-touch attribution, rotated
capabilities and banned partners. Browser diagnostics are tested to return only
presence booleans, never key values. Privileged imports are restricted to the
legitimate server modules. Optional WhatsApp, profile field protection and stale
session refusal regressions remain explicit.

No failing test was deleted or newly skipped. Existing credential-gated tests
remain gated. Error-message and source-string assertions were updated only where
the production contract had changed; behavioral authorization and RLS checks
were retained.

## Reliable test execution

Use Node 22 (`nvm use`); Node 24 triggered a native PGlite/V8 WASM JIT crash in the
original baseline. File concurrency is bounded to two workers. Forced-exit flags
were removed after repeated runs showed they could truncate worker reports and
produce inconsistent test counts.

The prelude clears residual timers after each file. DOM bootstrap preserves
BroadcastChannel delivery but unrefs Node's channel so Supabase cross-tab session
updates do not keep a finished worker alive. A child-process regression verifies
that all 40 fixture cases are reported and SDK-style background timers are
cleaned up without forced exit.

The deploy guard now runs typecheck, production build, the complete backend and
migration suite, checkout regressions and the complete DOM suite.

## Verification

| Check | Result |
|---|---|
| Original Node 24 baseline | 1,982 tests: 1,927 passed, 52 failed, 3 credential skips; failed fixture setup prevented some cases from being enumerated |
| Complete Node 22 suite, natural exit | 2,000 tests: 1,997 passed, zero failures, 3 existing credential skips |
| Complete DOM suite, natural exit | 385 passed, zero failures/skips |
| Checkout regression command | 90 passed, zero failures/skips |
| TypeScript | Passed |
| Production client/server build | Passed; existing large-chunk warnings remain |
| Patch whitespace | Passed |
| Integrated partner acceptance | All 15 steps passed against React, local HTTP/Auth/RPC/RLS and disk-backed PostgreSQL |
| Chromium responsive customer suite | All 28 templates passed their six desktop customer pages and mobile drawer/navigation, plus deep-link/back-forward/breakpoint checks |
| Chromium template customer suite | All 28 template recipes passed; VIP discovery/profile passed at 320, 390, 768 and 1440px; mobile package/coupon/simulated-payment confirmation passed |

The three skips require real Razorpay test/live keys and a webhook secret. Mock
checkout, booking inserts, raw-body webhook HMAC validation and idempotency have
local coverage. Chromium results use local/demo data and simulated payment; they
do not establish a captured external payment.

## Migration and deployment boundary

Apply `supabase/migrations/20261102000000_restore_referral_integrity.sql` after the
existing referral lookup/event/admin migrations. It is included in the local
HTTP gateway and was exercised by SQL/RLS tests and the partner acceptance flow.
No production database migration or merge was performed.

Connected production acceptance still requires deployed Supabase schema/storage
policies, authenticated owner/customer/partner accounts and real Razorpay
capture/webhook delivery. Local success is not presented as live sign-off.

## Gap-list reconciliation

The supplied October 4 files (`1_TEMPLATES_missing_and_gaps(1).md`,
`2_CUSTOMER_missing_and_gaps.md`, `3_SHOP_OWNER_ADMIN_missing_and_gaps.md`) contain
static feature audits. Current code already includes 28 composition recipes,
font variables, VIP editor integration, live-menu package resolution, template
package UI/management, salon experience fields, customer password recovery,
gender discovery filters and booking price breakdown. Browser suites exercised
the customer/template paths described above.

This repair does not implement every wider product request in those documents.
Saved-address expansion, owner availability/reviews and broader platform-admin
requirements remain separate feature work. Existing tests that pin unimplemented
onboarding states remain visible; a green regression suite does not assert that
those features have been added.
