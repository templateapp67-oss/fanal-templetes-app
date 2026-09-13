# Growth Partner security and migration review — Sections 31–34

## Scope and evidence

Reviewed the committed partner/onboarding client, referral-cookie API, local
Supabase-compatible gateway, and the full local migration chain through
`20261001_partner_dashboard_activity.sql`. Verified the SQL against PGlite's
PostgreSQL engine and exercised UI and HTTP boundaries with regression tests.
This is a repository/local-database review, **not a live production penetration
test** or confirmation of a deployed project's grants, secrets, Storage policies,
Auth settings, or perimeter controls. No production data was accessed or changed.

## Findings fixed in this change

1. **Development gateway session spoofing:** the previous refresh credential was
   derived from a user ID. Replaced it with 256-bit random opaque tokens, stored
   hashed in process memory, time-limited, consumed before async rotation, and
   revoked on logout/password change. Guessed IDs and old refresh-token replay
   fail. Rotation also invalidates the old access token.
2. **Development signing default:** removed the fixed fallback JWT secret. A random
   per-process key is now the default; an explicitly configured key must be at
   least 32 bytes. Verification checks signature in constant time, algorithm,
   type, audience, role, finite expiry/issued-at, and UUID subject. Gateway reads
   additionally require an issued, non-revoked session; a merely signed but
   unissued token is insufficient.
3. **Privilege freshness:** the gateway resolves administrator authority from the
   live Auth row's server-owned `raw_app_meta_data`, not client body metadata or
   localStorage. Normal signup cannot populate that authority field.
4. **Single-connection isolation:** Auth/catalog queries now share the same queue
   as role-scoped requests. Raw Auth queries must not run while another request
   has changed PGlite's role/JWT settings. Concurrent partner reads are tested.
5. **Production misuse guard:** gateway construction itself refuses production
   mode, in addition to the application mount guard. Local session maps are not
   persistent: restarting the gateway requires signing in again.

These changes harden the local tool; they do not replace or modify production
Supabase Auth.

## Threat coverage

| Threat | Server/database boundary | Evidence |
|---|---|---|
| IDOR | Detail UUIDs are looked up within the caller's active partner ownership. Foreign/unknown detail IDs disclose no referral. | `referralSearchDetails`, `referralFraudPrivacy`, `partnerReferralEventsRls` tests |
| Broken authorization | RLS plus restrictive owner fences on partner, ledger, events and onboarding. `partner_dashboard_caller()` derives identity from `auth.uid()` and denies absent/paused partners. | RLS tests deliberately add broad policies/grants and still cannot read peers |
| Partner impersonation | Dashboard/analytics accepts no partner/user identity argument. Local HTTP named-argument injection is rejected. Supabase validates the production JWT. | `growthPartnerContract`, `localSupabaseGateway` tests |
| Referral code tampering | Code normalized/validated in SQL. Seven-day first-valid cookie capability, code-rotation/deactivation checks, atomic signup consumption, no-self-referral guards. | `referralAttribution`, `referralFraudPrivacy`, `referralOwnershipJourney` tests |
| Duplicate referrals | Canonical account relationship, one-use capabilities, global unique successful-account index, same-row ledger promotion, first-occurrence event uniqueness. | Ledger, events, attribution and ownership journey tests |
| Session spoofing | Signed, checked, gateway-issued local sessions; random single-use refresh tokens; logout/password-change revocation. No Auth role comes from user metadata/localStorage. | HTTP spoofing/rotation/replay and concurrent context tests |
| Unauthorized admin operations | Browser roles cannot execute provision/correction/recorder functions; trusted service role and admin authorization govern corrections with reason/actor/old/new audit. | Contract, fraud/privacy, profile, ownership journey and gateway tests |
| Cross-partner data exposure | Recent users, seven-day count and every daily bucket are independently caller-scoped SQL queries. Analytics returns only name, date, effective status and opaque referral ID. | `partnerDashboardActivity` upgrade/privacy tests; existing list/profile/events tests |
| Client-supplied status | Profile patch allows only name/phone/photo; milestones require verified workflow; admin dispositions are separate audited operations. | `growthPartnerProfileBasics`, `referralLifecycle`, `templateCompletion` tests |

A frontend `user_id` used to detect a session change is only a UX consistency
check. Server Auth/SQL remains authoritative. Opaque referral and application IDs
are resource selectors, not authorization. Neither an identifier nor a UI admin
flag grants an operation.

## Migration safety

Inspected and reused `growth_onboarding` (canonical registered attribution),
`growth_partners`, `profiles`, the physical `partner_referrals` ledger, and
`partner_referral_events`. The new analytics needs **no new table or view**.
It adds one non-unique query index and replaces the existing dashboard RPC while
preserving its older response fields and restricted grants. It performs no data
INSERT/UPDATE/DELETE/TRUNCATE, no account rewrite, and no table drop/rename.

The migration is transactional, has explicit prerequisite checks, and is rerunnable.
Missing/incompatible prerequisites fail rather than inventing an alternate schema.
Upgrade tests apply it over existing accounts/referrals/events and unrelated
salon/booking/service sentinels, compare all rows before/after, rerun it, and verify
that no new table/view appeared. Incomplete-schema tests verify rollback.

Deploy after `20260930_partner_dashboard_metrics.sql`. First inspect the actual
staging/production schema and grants against the committed chain; reconcile drift
explicitly rather than running older table-creation migrations indiscriminately.
Take a normal backup. The index is built transactionally, **not concurrently**;
use a maintenance window on large tables, or have the DBA prebuild that same
index concurrently before applying this idempotent migration. Do not restore an
old database snapshot merely to roll back the UI; the response extension is
backward-compatible.

## Remaining deployment boundaries

- The local gateway is **development-only**: it has a documented demo admin and
  intentionally logs recovery links instead of sending email. Do not expose it
  to untrusted users or store real production data in it. Its session/refresh
  behavior is intentionally simpler than Supabase and is not a production Auth
  implementation.
- Production service-role keys and admin workflows must stay server-side. Normal
  browser admin widgets do not justify granting privileged SQL functions to all
  authenticated users. Use the existing trusted administrative workflow.
- Verify deployed Supabase RLS, function EXECUTE grants, Storage owner policies,
  Auth configuration and key rotation separately. No deployment was performed.
- Public referral capture is intentionally anonymous. Rate-limit/monitor both the
  Node endpoint and direct public Supabase RPC access, and apply documented
  expired-capability retention. Registration counts cannot be inflated merely by
  clicks, but click spam can still consume resources.
- The platform's shared profile/public-avatar visibility belongs to its wider
  privacy contract. This change does not revoke unrelated platform grants or
  expose new email, phone, Auth metadata, token or payment fields via analytics.
