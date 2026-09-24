# Growth Partner — full database & website audit

Run against `origin/main` + the `arena/…` branch (commit `e08aa8a` + this change), 2026-09-24.

**Method.** Four independent passes, all reproducible in this repository:

1. **Schema scan** — every `public.<relation>` reference in all 71 migrations, matched against every
   `create table`/`create view` in the same set, to find relations that are used but never created.
2. **Live RPC matrix** — every RPC the client calls (`grep '\.rpc(' src/` → 69 names) invoked over the
   local gateway's real PostgREST surface as **anon**, **authenticated non-partner** and **provisioned
   partner** (plus the admin account), recording HTTP status and Postgres code.
3. **Fresh-project replay** — bootstrap + `LOCAL_GROWTH_CHAIN` + the reward migrations, applied to a bare
   PGlite, to prove a project built only from this repository can apply the chain.
4. **Frontend pass** — every Growth Partner component/service that reads partner data, checked for
   null/undefined access and for whether a database failure can reach the screen as raw text.

Pinned by `tests/growthPartnerMigrationPrerequisites.test.ts` (4 tests) and the existing guards.

---

## 1. Migrations: what `GROWTH_PARTNER_SETUP.md` lists vs. what is applied

All 14 migration groups in §3 exist as files and apply locally. The two legacy files the document marks
**"do not apply"** (`20260911092650`, `20260911092959`) are correctly absent from the chain.

Two gaps were real:

| Gap | Evidence | Status |
| --- | --- | --- |
| **Three relations are referenced (and foreign-keyed, and seeded) by committed migrations but created by none**: `shop_attributions` (6 files), `partner_reward_milestones` (2), `user_preferences` (1) | `20261007` resolves `partner_shop_daily_qualification.shop_attribution_id references public.shop_attributions(id)` at **apply** time and then seeds `partner_reward_milestones` with `on conflict (code)` — on a project built from this repository the file could not apply at all. Production carries these tables (that is how the legacy `20260911092650` generation was written), so nothing ever failed there. | **FIXED** — `2026100500_growth_partner_attribution_prerequisites.sql` (guarded `create table if not exists`, RLS on, no client policies, `service_role` grants; a no-op on a project that already has them) |
| **Five Growth Partner migrations never `notify pgrst, 'reload schema'`** (`20260920`, `20260921`, `20261007`, `20261008`, plus the profile settings migration) | PostgREST caches the catalogue at startup; on a project where they were applied while it was running, `rpc('get_my_partner_reward_dashboard')` is answered `PGRST202 … not in the schema cache` — the "database setup is missing" notice — although the migration applied cleanly. The repository already fixed this class once for the security RPCs (`20260919130100`). | **FIXED** — `20261013_reload_postgrest_schema_growth_partner.sql` |

**Naming** — the area has no `referrals` or `payouts` table. The canonical names are `partner_referrals`,
`partner_referral_events`, `partner_payout_requests`, `partner_earnings`; the per-salon customer loyalty
ledger is the unrelated `referrals`.

## 2. Row provisioning (item 2 of the request)

Already implemented and re-verified end-to-end — no new logic was added:

* `ensure_my_growth_partner()` provisions `auth.uid()` only, is idempotent, and never reactivates a
  suspended partner (`20260922091000`). The dashboard pages call it after a missing-row read, so a
  signed-in account never sees a blocking error page.
* Live: fresh signup → `get_my_growth_partner` `null` → `ensure_my_growth_partner` `200` + row →
  `get_my_partner_dashboard` `200`.
* **Admin account (`admin@nexora.local`)**: admin-claimed requests run as `service_role`. The local
  bootstrap granted that role EXECUTE on functions but **nothing on tables** and no USAGE on `auth` —
  unlike Supabase, which grants service_role the whole data plane and `BYPASSRLS`. Consequences, both
  reproduced and now fixed: `42501 permission denied for table "growth_partners"` on every admin table
  read, and **`42703` from `get_my_growth_partner()` for an admin** — that function probes
  `information_schema.columns` for `is_active`, and information_schema only lists columns the *current
  role* may read, so the probe answered false, the legacy `gp.status` branch was chosen, and the area
  answered `400` instead of the caller's row. (**FIXED** in `server/localSupabase.ts`; pinned by the
  admin-parity test.)

## 3. RPC inventory (client-called, partner surface: 27)

After the fixes, every partner-surface RPC exists. Matrix summary (anon is refused everywhere, as it
must be):

| RPC | anon | non-partner | partner |
| --- | --- | --- | --- |
| `ensure_my_growth_partner`, `get_my_growth_partner` | 403 | 200 | 200 |
| `get_my_partner_dashboard`, `get_my_partner_referrals`, `…_referrals_filtered`, `…_referral_detail`, `…_performance`, `…_account_settings`, `…_security_overview` | 403 | 200 | 200 |
| `get_my_growth_partner_profile`, `get_partner_profile`, `save_partner_profile_details` | 403 | 200 / validated 400 | 200 / validated 400 |
| `request_my_partner_account_deactivation`, `revoke_my_other_partner_sessions`, `cancel_my_*` | 403 | 200 / gate | 200 / gate |
| `list_growth_partner_applications`, `review_growth_partner_application` | 403 | **403 (admin-only)** | 403 (admin: 200) |
| **`get_my_partner_reward_dashboard`, `get_my_partner_onboarding_rewards`** | — | — | **PGRST202 locally** |

The last row is the one remaining gap, and it is a **local-gateway** gap, not a production one: those two
RPCs are `SECURITY DEFINER` and read four tables that are *legacy production schema* — none of them is
created by any migration:

* `partner_reward_claims` (`id, growth_partner_id, milestone_id, claim_number, status, status_reason, created_at`)
* `partner_reward_shop_qualifications` (`growth_partner_id, shop_attribution_id, status, active_scan_count, qualified_at, reviewed_at, reason_code, source_event_id`)
* `qualifying_transactions` (`shop_attribution_id, growth_partner_id, business_date, qr_transaction_paise, company_commission_paise, eligible_amount_paise, settlement_confirmed, refund_or_reversal, daily_status, rejection_status, qualification_status, active_scan_count, reversed_at, calculated_at`)
* `shop_onboarding_applications` (`id, status, owner_phone_verified_at, reviewed_at, owner_name, submitted_by_partner_id`)

Those column sets are the complete set the three reward migrations use — supplied here so the tables can
be **exported from the production project** (`\d <table>`) or created deliberately, rather than guessed
at by a migration. Deliberately *not* reconstructed: they are business ledgers (QR money), and a
plausible-but-wrong shape is worse than a named gap.

## 4. Frontend / service layer

Nothing on the Growth Partner surface calls Supabase directly from a component; the sections go through
`src/services/growthPartner.ts` (`{ok:true,data}|{ok:false,error}`, paise, JWT identity only). Four real
defects were found outside that facade and fixed:

| Where | Defect | Fix |
| --- | --- | --- |
| `src/lib/readPartnerProfile.ts` (used by the profile modal and the website editor) | threw `Profile load failed (PGRST202): <PostgREST text>` — the **raw database message was rendered to the user** | returns `{ok:true,data}` / `{ok:false,error:{code,message}}` with reviewed copy; the real error goes to `console.error('[partner-profile] …')` |
| `src/components/PartnerProfileModal.tsx` | save path `throw result.error` → raw PostgREST text in the form; load path printed `e.message` | reviewed copy per failure; real cause logged with its code |
| `src/components/PartnerRewardsCommission.tsx` | **crash class**: `data.rewards.length` / `data.milestones.map` on a payload missing the key; `money()` used `Number(paise) \|\| 0`, i.e. a missing amount rendered a confident **₹0**; `next_milestone ?? 1000` invented a target; `new Date(…).toLocaleDateString()` printed `Invalid Date` | payloads normalised at the boundary (`asArray`, `isNumber`), `money()` renders `—` for anything not finite (a real 0 still prints ₹0), unknown target stays unknown, dates via a guarded helper, and each failed RPC logs one line with its code |
| `src/components/WebsiteEditor.tsx` | completion badge treated an RPC failure as an error string | uses the result object; badge shows its degraded state, cause logged |

`npm test` covers the non-DOM half; `npm run test:dom` exercises these screens in jsdom.

## 5. What to run on your Supabase project

```sql
-- 1. the two new migrations, in this order
--    supabase/migrations/2026100500_growth_partner_attribution_prerequisites.sql
--    supabase/migrations/20261013_reload_postgrest_schema_growth_partner.sql
-- 2. confirm the reward tables exist (they should, since 20261007/08/09 applied there):
select table_name from information_schema.tables where table_schema='public'
  and table_name in ('shop_attributions','partner_reward_milestones','partner_reward_claims',
                     'partner_reward_shop_qualifications','qualifying_transactions','shop_onboarding_applications');
-- 3. after applying, flush the cache once more:
notify pgrst, 'reload schema';
```

Then open `/partner/dashboard`: the Rewards/Commission sections should render instead of the
"database setup is missing" notice. `npm run diagnose:partner-dashboard -- .env --email you@example.com`
reports the same checks from the CLI.

## 6. Verified in this pass

* `./node_modules/.bin/tsc --noEmit` → 0 · `npm run lint` → 0
* `tests/growthPartnerMigrationPrerequisites.test.ts` → 4/4 (fresh-project replay, re-runnability,
  reload migration, admin parity)
* `tests/referralAttributionLock.test.ts` → 8/8 (the "no parallel referral schema" guard, updated with
  the two new canonical tables and why each is not a second store)
* Gateway boots on the replayed chain (`36 real migrations`), partner flow `signup → ensure → dashboard`
  all 200, admin row read 200 (was 42501/42703)
* `npm test` → **1650 tests, 1638 pass, 3 skipped, 9 fail** — the same 9 pre-existing failures that
  fail on `main` too (onboardingStateResolution, part1SharedBackend, part1cSecurity, onboardingApp,
  ownerEntryRoute ×2, templateCompletion, templateHandoff, bookingModal). The four new tests are included
  in that count.
* `npm run test:dom` → 129 / 123 / **6**, the same six names that fail before this change.
* `npm run lint` → 0 (the repo's lint script is `tsc --noEmit`).
* `tests/referralAttributionLock.test.ts` → 8/8 · `tests/part3GrowthPartnerIntegration.test.ts` → 9/9 ·
  `tests/growthPartnerMigrationPrerequisites.test.ts` → 4/4.
