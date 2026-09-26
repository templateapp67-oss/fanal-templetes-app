# Production flow audit — partial remediation (not an E2E sign-off)

| File/function | Observed issue / impact | Change | Verification |
|---|---|---|---|
| `StatusScreen` | Referred owners received partner QR and analytics, with fallback demo codes and names | Removed partner-only cards from the referred-user status screen | Source inspection; live role test pending |
| `HeaderReferralWidget` | Owner header showed “Referral code unavailable” when owner had been *referred*, because the widget queries the owner's own partner code | Hide sharing widget when no own partner code; referral attribution remains on onboarding status | Source inspection; live handoff pending |
| `App` initial state / workspace resolution | Unscoped browser salon snapshot was rendered before session ownership could be established; old data could flash to new users | Production starts blank, resets on auth change and logout, then resolves workspace from authenticated RPC | Typecheck/build; two-account browser test pending |
| `flow.validateSignup`, `SignupScreen`, `auth.signUpWithEmail` | Required phone contrary to optional-phone requirement; inconsistent referral and existing-email copy | Validate phone only if present; update guidance | Typecheck/build; browser autofill test pending |

## Limitations / blockers

No production Supabase credentials, deployment access, or browser automation were available in this workspace. The exact production referral URL, fresh-account signup, persistence, publishing, and public site were **not** verified. No migration was applied to a live database. The proposed SQL changes include restrictive RLS policies, tested only against a PGlite fixture. Do not deploy as a complete production fix without reviewing remaining tenant queries and performing the two-account browser exercise. The full test suite timed out after older self-enrollment expectation failures; separate handoff tests failed. A local referral-attribution fixture could not run the new migrations due to an incomplete migration chain. The focused 23-test suite, lint, typecheck, and build passed; this is not a full-suite or live-flow sign-off. No test account or website was created.
