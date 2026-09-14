# PHASE 10 — OWNER WORKSPACE RESOLUTION

Audit of the complete owner provisioning path, then the smallest change that
makes an owner with **more than one salon** a normal owner instead of a dead end.

Every number, quotation and line reference below was produced by running this
tree: the real migrations in PGlite (`tests/ownerWorkspaceResolution.test.ts`,
`tests/ownerWorkspaceProvisioning.test.ts`, `tests/ownerWorkspaceRpc.test.ts`,
`tests/ownerEntryRoute.test.ts`, `tests/ownerRoleCanonical.test.ts`) and the real
client modules in node.

## The verdict, up front

**The schema was read before anything was written, and it was already canonical.
Nothing was switched to a legacy table, and no table, column, index or policy was
added.** Authority is, and remains, `organization_members`
(`user_id`, `organization_id`, `role`, `status`) via `nexora_owner_salon_ids()`.

**The dead end had two halves, in two places:**

1. **SQL** — `nexora_save_owner_workspace()` resolved its target by matching
   `salons.slug` to `profile.subdomain`, and otherwise required **exactly one**
   owned salon (`20260909142000_normalized_owner_workspace.sql:24-29`). With two
   authorized salons and no matching subdomain it raised
   `Select a salon owned by this account` and the save was refused.
2. **Client** — that failure was answered with
   `'This account has more than one salon, so the save could not pick one automatically.'`
   (`src/lib/ownerEditorState.ts`, old lines 31-33 and 68-84), and
   `ownerEntryRoute` had an entire `workspace-ambiguous` stage that parked such an
   owner on the landing page instead of the editor.

**One canonical rule now decides, server-side**, in a new migration
`supabase/migrations/20261006_owner_salon_resolution.sql`:
**primary active → most recently created active → first authorized active →
first authorized**, applied **only** to the set `nexora_owner_salon_ids()`
authorizes. The save function is patched in place to use it; the client's
ambiguity branch and stage are deleted.

**What changed, in one line each:** one migration (283 lines, functions only),
three client modules (`ownerWorkspace.ts`, `ownerEditorState.ts`,
`ownerEntryRoute.ts`), one line of local-dev wiring
(`server/localSupabase.ts` → `LOCAL_GROWTH_CHAIN`), and tests. No new screen, no
new table, no new token, no new RPC that a client did not already have.

**Evidence:** 11 new tests (10.1a–10.3d) plus 26 updated owner-workspace tests
are green; the full suite is 1405 tests / **0 failures**; `tsc --noEmit` and the
production build are clean; `test:dom` 70/70; `test:partner` 451/451.

**The forbidden copy does not exist in this repository.** A case-insensitive
repository-wide sweep for `multiple salons` returns only comments and this
migration's own header; there is no user-facing string that turns several salons
into a support request or a refusal.

---

## PART A — the canonical model, inspected before it was touched (10.1)

What exists today, where it lives, and what Phase 10 did to it:

| Concern | Existing authority | Phase 10 |
| --- | --- | --- |
| Ownership | `organization_members(user_id, organization_id, role, status)` — `20261002:158-171` (unique on `(organization_id, user_id)`) | **Unchanged.** This is the only source of candidates |
| Authorization set | `nexora_owner_salon_ids()` — `20261002:201-230`: `status='active' and role in ('owner','manager') and deleted_at is null`, joined `organization_id = s.organization_id` | **Unchanged.** Every tier of the new rule filters `where s.id in (select public.nexora_owner_salon_ids())` |
| Role gate | `'owner' \| 'manager'` (check constraint `20261002:163`) | **Unchanged**; `invited`, `removed` and `staff` memberships resolve to *no workspace* (test 10.1a) |
| Deleted salons | `salons.deleted_at` (`20261002:186`) | **Unchanged**; excluded from every tier and from `salons[]` |
| Profile display title | `profiles.owner_role` — a title owned by the template/editor, read by no policy or function (`tests/ownerRoleCanonical.test.ts:13-21`) | **Not consulted.** Grants nothing |
| Legacy address hint | `profiles.subdomain` matched against `salons.slug` | **Kept, as a hint only.** It can only ever match inside the caller's own authorized set (test 10.1b: a foreign tenant's salon whose slug is named by the profile is *never* selected) |
| Tenant scope | `salons.organization_id` | **Unchanged**; `salons[]` lists live salons of the resolved organization only, capped at 25 |

Nothing else was promoted into an authority. `profiles.subdomain`,
`profiles.owner_role`, `owner_editor_state` and `template_handoffs` are read
exactly where they were already read — none of them decides which salon an owner
may write to.

**10.1a** proves the gates behave as the model says: an `active` owner and an
`active` manager resolve; `invited`, `removed` and `staff` memberships do not;
soft-deleting the salon removes it from resolution; adding a salon to another
tenant's organization never makes it visible or selectable.
**10.1c** proves, on the migration text itself, that the candidate set is
`nexora_owner_salon_ids()` and nothing hand-rolled.

---

## PART B — several salons: one rule instead of a refusal (10.2)

### B1. Exactly what was wrong

```
-- 20260909142000_normalized_owner_workspace.sql:24-29
select count(*), min(id::text)::uuid into candidate_count,target from public.salons
 where id in (select public.nexora_owner_salon_ids()) and slug=profile->>'subdomain';
if candidate_count <> 1 then
 select count(*), min(id::text)::uuid into candidate_count,target from public.salons
   where id in (select public.nexora_owner_salon_ids());
end if;
if candidate_count <> 1 then raise exception 'Select a salon owned by this account' ...;
```

The subdomain match is a *good* rule — it is the owner naming the salon they
mean — but the fallback demanded exactly one candidate, so a second salon made
every save without an exact subdomain match fail. On the read side,
`get_my_owner_workspace()` (`20261002:482-555`) already returned
`resolved = true` whenever *any* live salon existed and reported
`ambiguous = true` alongside it; the client then used `ambiguous` to refuse.

### B2. The rule as implemented (`20261006_owner_salon_resolution.sql:73-155`)

| Tier | Selection | Condition | Reported as `selection` |
| --- | --- | --- | --- |
| 1 | the salon the deployment marks primary | only when the deployment actually carries a `salons.is_primary` column, and the salon is active | `primary` |
| 2 | the most recently created **active** salon | `created_at desc nulls last, id` | `most-recent` |
| 3 | the first authorized **active** salon | `created_at asc nulls last, id` | `first-authorized` |
| 4 | the first authorized salon, even if inactive | `created_at asc nulls last, id` | `first-authorized-inactive` |

Two properties are deliberate and asserted:

* **Tier 1 cannot fire by accident.** `20261002:175-188` does *not* create
  `is_primary`; the marker is probed (`owner_workspace_has_column('salons','is_primary')`)
  and the tier is skipped on a deployment without it. A test fixture adds the
  column to prove the tier works (`10.2b`), and `10.3d` proves the migration
  itself adds no column, table, index or `alter table`.
* **Every tier is bounded by the authorized set.** There is no code path in
  which a salon outside `nexora_owner_salon_ids()` can be returned — not at tier
  4 either (`10.2c`: an inactive authorized salon is chosen, an unauthorized one
  is not, and a foreign tenant's salon is never a candidate).

### B3. Never a dead end

* Tier 4 exists so that an owner whose only salon is deactivated still has a
  workspace: editing a deactivated salon is still the owner's own data, and
  refusing would be a dead end for an authorized account (`10.2c`).
* `get_my_owner_workspace()` now reports `resolved = true` **iff** the rule
  returned a pick. `ambiguous` is retained but is informational only — "more than
  one live salon exists" — and no caller consults it to decide whether to act
  (`src/lib/ownerWorkspace.ts:52-56,116-122`).
* The response gained one field, `selection`, and `salons[]` now leads with the
  chosen salon instead of the oldest one; the list is still bounded at 25.

### B4. What the owner experiences now

| Situation | Before | After |
| --- | --- | --- |
| 1 salon | saved into it | saved into it (unchanged) |
| 2+ salons, save names one by its address | saved into the named salon | saved into the named salon (unchanged, `10.2d`) |
| 2+ salons, no address match | **refused**, with a message telling the owner to contact the salon's address manually | saved into the rule's pick (`10.2d`) |
| 2+ salons at login | landed and stayed on the landing page (`workspace-ambiguous`) | routed to the wizard like any other owner with a workspace |
| all salons inactive | unresolved | resolved via tier 4 |

`Select a salon owned by this account` still exists — but its meaning narrowed to
"this caller has no authorized salon at all". It is now a protocol sentinel: it is
what triggers `saveOwnerEditorState()` to run `ensure_owner_workspace()` and retry
once (`src/lib/ownerEditorState.ts:63-77`). No owner with an authorized salon can
reach it.

### B5. Routing loses its second dead-end stage

```
before:  'no-profile' | 'no-workspace' | 'workspace-ambiguous' | 'onboarding-incomplete' | …
after:   'no-profile' | 'no-workspace' | 'onboarding-incomplete' | …
```

`OwnerEntryFacts.workspaceAmbiguous` is gone; `workspaceResolved` is taken
verbatim from the RPC's `resolved` (`src/lib/ownerEntryRoute.ts:141-146`), and an
unresolved workspace classifies as `no-workspace` → the wizard
(`src/lib/ownerEntryRoute.ts:170-175,193-199`). The test that pinned the old
dead end was replaced by one pinning the opposite: several salons route to the
editor (`tests/ownerEntryRoute.test.ts`, 19/19).

---

## PART C — idempotency and races (10.3)

Phase 10 adds **no write path at all** — the new rule is a `stable` read and the
save patch only changes how an existing transaction *chooses* its target. The
provisioning guarantees from PART 3 are therefore unchanged, and remain pinned:

| Invariant | Mechanism | Pinned by |
| --- | --- | --- |
| No duplicate organization / membership / salon | `ensure_owner_workspace()` returns early when a membership already resolves; rows are inserted only on the miss | `10.3a`: two resolutions and a re-run produce 1 org / 1 membership / 1 salon / 1 slug |
| No lost update between concurrent callers | per-caller transaction advisory lock (`20261002:303`) taken **before** the existence read, so the second caller reads the first caller's rows | `10.3b`: 3 concurrent calls ⇒ exactly one `provisioned:true`, 1 org / 1 salon |
| No shared domain or website config | `salons.slug` is `unique` (`20261002:177`) with a bounded random-suffix retry (×8) on collision | `10.3c`: two owners asking for the same name get distinct slugs, distinct salons, distinct website data |
| Re-applying the migration is a no-op | `create or replace` throughout; the save-side patch returns early when `owner_workspace_pick_salon() ->> 'salon_id'` is already present, and raises rather than guessing if the function body changed shape | `10.3d`: re-running the file creates nothing new and the patched save function references the picker exactly once |
| Safe on a generation without the save function | the patch returns silently when `to_regprocedure('public.nexora_save_owner_workspace(jsonb)')` is null (the local gateway chain is exactly this case) | exercised on every run of `test:dom` / `test:partner` |

Two collisions this phase had to keep straight, both asserted: the *slug* retry
(still bounded at 8, still on the unique constraint) and the *resolution* pick
(never a retry — one deterministic answer, chosen by the tiers above).

---

## PART D — deployment and dev/production parity

* **Production:** apply `20261006_owner_salon_resolution.sql` after `20261002`
  (filename order, which is how the chain already runs). It is written to be a
  no-op on a database that lacks the normalized objects: every function checks
  `to_regclass` / `to_regprocedure` first and returns early, and the save patch
  skips silently when the function is absent.
* **Local gateway:** `20261006` was added to `LOCAL_GROWTH_CHAIN`
  (`server/localSupabase.ts`) so the running app, the browser-flow tests and the
  live preview use the same rule production will. The save-side patch is a
  deliberate no-op there — `nexora_save_owner_workspace()` is not part of that
  chain; the owner/editor save path reads the normalized production schema.
* **Not verifiable in this sandbox:** applying `20261006` to the live project —
  no credentials here. This is the same standing caveat PART 3 recorded for
  `20261002`, and the fix is the same: run the migration, then
  `npm run verify:growth-partner -- .env`.

---

## PART E — change list

| File | Change |
| --- | --- |
| `supabase/migrations/20261006_owner_salon_resolution.sql` | **New.** `owner_workspace_pick_salon()` (the one rule, no client grants), `get_my_owner_workspace()` (same shape + `selection`, chosen salon first, `ambiguous` informational, `resolved` = "a salon was chosen"), and an in-place patch of `nexora_save_owner_workspace()` via the `pg_get_functiondef` + replace idiom `20260911112000` / `20260911113000` already use |
| `src/lib/ownerWorkspace.ts` | `selection` on `OwnerWorkspace` (and the unresolved default); `ambiguous` documented as informational; `salons[]` documented as chosen-first |
| `src/lib/ownerEditorState.ts` | `AMBIGUOUS_WORKSPACE_MESSAGE` and the whole ambiguity branch **deleted**; the retry is gated on `!workspace.salonId` alone |
| `src/lib/ownerEntryRoute.ts` | `workspace-ambiguous` stage and `workspaceAmbiguous` fact removed; subdomain/count-based ambiguity inference removed (the RPC's `resolved` is used verbatim) |
| `server/localSupabase.ts` | `20261006` appended to `LOCAL_GROWTH_CHAIN` |
| `tests/ownerWorkspaceResolution.test.ts` | **New** — 10.1a–c, 10.2a–d, 10.3a–d |
| `tests/ownerWorkspaceProvisioning.test.ts` | Applies `20261006`; the multi-salon case now asserts the rule's pick instead of a refusal |
| `tests/ownerWorkspaceRpc.test.ts` | The multi-salon save retries once and succeeds |
| `tests/ownerEntryRoute.test.ts` | The dead-end test replaced with "several salons route to the editor" (and a fact-shape test dropped one line) |
| `tests/onboardingStateResolution.test.ts` | Removed the `workspaceAmbiguous` line from the fact fixture |

---

## PART F — verification

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm run build` (`vite build`) | clean |
| `npm test` | **1405 tests, 1402 pass, 0 fail, 3 skipped** (was 1394/1391/3) |
| `npm run test:dom` | 70 / 70 |
| `npm run test:partner` | 451 / 451 |
| `tsx --test tests/ownerWorkspaceResolution.test.ts` | 11 / 11 |
| `tsx --test` over `localSupabaseGateway`, `ownerWorkspaceResolution`, `ownerWorkspaceProvisioning`, `ownerWorkspaceRpc`, `ownerEntryRoute` | 66 / 66 |
| `tsx --test tests/ownerEntryRoute.test.ts` alone | 19 / 19 |

The live-schema probe used while developing this phase (a throwaway script that
proved each tier, the exclusion of deleted and foreign-tenant salons, and that a
two-salon `save_owner_editor_state` succeeds) was deleted before the commit — its
assertions are now permanently in `tests/ownerWorkspaceResolution.test.ts`
against the real migrations under PGlite.

---

## What this phase did not change

* Ownership authority, the authorization set, provisioning, grants and RLS. The
  new rule is an internal helper: `revoke all … from public, anon, authenticated`
  — clients reach it only through `get_my_owner_workspace()`, which is why the
  new suite verifies it through the RPC a client actually has rather than by
  widening the surface for a test.
* `get_my_owner_workspace()` is still revoked from `anon` and granted to
  `authenticated` only, and still raises `Sign in required` with no session.
* The `profiles.subdomain` hint, the single-salon path, and the
  `ensure → resolve → save → complete` ordering of the funnel.

## Still open (carried over, unchanged by this phase)

* **G1 (Phase 8):** an owner who completes the wizard directly never has that
  completion recorded — needs no schema change, awaiting a decision.
* **`anon` EXECUTE** on the ten commission/payroll RPCs
  (`20260910_complete_staff_performance_backend.sql:1053-1062`).
* **`20261006` (like `20261002`) has not been applied to the live project** — no
  credentials in this sandbox.
