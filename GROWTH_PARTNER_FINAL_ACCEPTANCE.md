# Growth Partner — Sections 40–41 acceptance

## Verification result

- `npm run test:partner`: **364 passed, 0 failed**.
- `npm run test:partner:acceptance`: the single, sequential 15-step integration journey.
- `npm run typecheck`, `npm run build`, and `git diff --check`: passed.
- Build retains the existing large-chunk warning.

The integrated test is `tests/dom/partnerFinalAcceptance.test.ts`. It renders the real React login, partner pages, and onboarding screens in JSDOM. It uses the real Supabase SDK, real HTTP responses, Express attribution routes, and the development gateway with PostgreSQL migrations running in an isolated, disk-backed PGlite database. It does **not** stub API, Auth, RPC, or SQL responses. Synthetic users and the temporary database are removed after the test.

The browser adapter supplies a separate visitor cookie jar, HttpOnly cookie handling, clipboard writes, and local endpoint routing. Partner and visitor have independent Auth clients/sessions. This is DOM/HTTP/database integration, **not Chromium browser or pixel/device verification**. Chromium installation failed because browser downloads were unavailable in this environment. Actual mobile layout, browser clipboard/share permissions, and production Supabase deployment remain release checks.

## Section 40 — sequential evidence

| Step | Executed assertion |
|---|---|
| 1 | Admin authenticates and provisions active partners A and B; backend-generated codes are unique. A separate customer is linked to B for isolation testing. |
| 2 | A fills and submits the real `/partner/login` form. |
| 3 | Navigation reaches `/partner/dashboard` and renders the overview. |
| 4 | A's referral code is shown; B's is absent. |
| 5 | A opens Referral Code and copies the URL; clipboard receives the code-bearing URL and snackbar says **Referral link copied**. |
| 6 | A new visitor opens the copied URL using independent Auth and cookies. |
| 7 | Real capture endpoint accepts the code and issues a SameSite=Lax, HttpOnly referral cookie; signup becomes available. |
| 8 | Visitor submits the actual signup form after a screen remount; real Auth creates an account and the linked status appears. |
| 9 | A reads the persisted registration ledger row. Attempting to relink the visitor to B is rejected; the original referral remains. |
| 10 | A's refreshed overview shows one referral and one activity row. |
| 11 | The signup-only referral is **Pending**. |
| 12 | A selects Pending and searches the visitor email through the real server RPC, receiving the referral row. |
| 13 | A opens real referral details; timeline and code appear, but the complete email does not. |
| 14 | A's detail RPC returns no data for B's opaque referral ID; direct ledger select also returns no rows under RLS. |
| 15 | Remount preserves the referral; then logout, HTTP/gateway shutdown, reopening the same on-disk database, and real login preserve the count, ledger ID, referred account, code and registration timestamp. |

The test emits a diagnostic for each completed step and asserts that steps 1–15 ran in order. Gateway-issued development sessions deliberately do not survive server restart; the test signs in again rather than treating an old token as valid.

### Bug discovered and fixed

Real SDK execution exposed an unbound `onAuthStateChange` call in `PartnerPortalLogin.tsx`, causing the login screen to throw. The subscription now calls the method with its Auth client as receiver. Mock-only tests had not revealed this; the integrated journey exercises the fix.

## Section 41 — phase boundary

Current scope remains login, shared route guard, dashboard shell/overview, unique code and referral URL, copy/share, referred users, basic statuses, profile, existing database tables/migrations, RLS, backend APIs, responsive UI, persistence and tests. Existing scenario/component evidence is indexed in `GROWTH_PARTNER_TEST_PLAN.md`.

No partner commission engine, wallet, withdrawal, payout, GST/TDS, advanced earnings, ranking, commission rules, bank-account or UPI-payout functionality was added. Planned sidebar modules remain non-interactive “Soon” labels; the integration asserts that these contain no actionable controls. The legacy commission URL remains an empty “not configured” placeholder, not a financial feature. Unrelated existing staff commission functionality is untouched.

No new tables or migrations were needed for Sections 40–41. No production database was accessed or modified. Local gateway success does not substitute for deploying the existing migration chain and testing production Auth, RLS, cookies, email confirmation, and responsive browser behavior before release.
