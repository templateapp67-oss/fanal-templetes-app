# PHASE 8 — ONBOARDING STATE AUDIT

Branch `arena/01a09e6f-fanal-templetes-app`. Every statement below is either read
out of the current tree or executed by
`tests/onboardingStateResolution.test.ts` against a database built from the
committed migrations (real signup trigger, real RPCs, real RLS, real save path).
Numbers from the runs are in PART H.

## The verdict, up front

**No new table, no new column, no new enum — and none is needed.** Every state
the brief lists already has a home in objects that exist and are already written
by the application, and the production reader
(`src/lib/ownerEntryRoute.ts` → `readOwnerEntryFacts` / `classifyOwnerEntry`,
the code `App.tsx:683-733` runs at login) already resolves six of them from
those objects alone.

**8.1 specifically: do not create `onboarding_sessions`.** The funnel row
`public.growth_onboarding` already *is* the per-user onboarding session record
(one row per `auth.users` id, `user_id` primary key, forward-only status,
server timestamps). A session table would be a second home for the same facts —
exactly the duplicate this phase forbids. PART E states what would have to be
true for one to be justified.

Three things did come out of the audit, and they are the reason it was worth
running rather than assuming:

| | Finding | Kind |
|---|---|---|
| **F1** | The `template-selected` stage is **unreachable** from the reader: `templateId` and `hasEditorState` are read from the same response, so a chosen template always arrives together with editor state. | derivation gaps, no storage change |
| **F2** | `classification` treats *unreadable* state as "move nobody", so the seven states are only trustworthy because the reader distinguishes "read failed" from "no row". | already handled, pinned |
| **G1** | **A direct (non-referred) owner's onboarding can never be recorded as complete.** The completion event is a no-op without a funnel row, and the app never creates one for them — so `template_completed` is unreachable, and such an owner with a finished website is still routed to the editor forever. | real coverage gap — fix needs no schema change (PART F) |

---

## PART A — The seven states, and where the application reads them

Everything below is `auth.uid()`-scoped: there is no id parameter on any of
these paths, so an owner can only ever read their own state.

| # | State in the brief | Authoritative source (already exists) | Read through | `OwnerEntryStage` |
|---|---|---|---|---|
| 1 | **new owner** | `auth.users` row + the `profiles` row the signup trigger writes (`00001_init.sql:84-105`, replaced by `20261003_signup_profile_fields.sql`) | `client.from('profiles').select('id').limit(1)` | `no-profile` (unreadable) → `no-workspace` |
| 2 | **onboarding incomplete** | `growth_onboarding.status in ('not_started','linked')` **plus** whether a workspace resolved | `get_my_onboarding_status()` + `get_my_owner_workspace()` | `onboarding-incomplete` |
| 3 | **business details saved** | `owner_editor_state.state->'profile'` + `salons.name/description/data->'editor_profile'` + `profiles` contact columns — written together by `save_owner_editor_state()` → `nexora_save_owner_workspace()` (`20260909142000:9`, contact sync `20260909045308:16`) | `get_owner_editor_state()` | `editor-started` |
| 4 | **template selected** | `owner_editor_state.state->>'selectedTemplateId'` — the **only** home; there is no template column anywhere (8.4 asserts it) | `get_owner_editor_state()` → `facts.templateId` | `template-selected` — **unreachable, see F1** |
| 5 | **editor started** | (a) the `owner_editor_state` row; (b) the funnel milestone `growth_onboarding.status='template_started'` + `template_started_at` | `get_owner_editor_state()` / `get_my_onboarding_status()` | `editor-started` |
| 6 | **website published** | the salon row (`salons.slug` + `name`, `is_active`, `deleted_at is null`) is what `server/siteLookup.ts:204-206` serves; the funnel side is `status='template_completed'`, which the backend only grants after `template_website_is_complete()` verified the committed state (`20260914:60,141`) | `get_my_onboarding_status()` (+ the public read path) | `published` |
| 7 | **onboarding completed** | `growth_onboarding.status='template_completed'` + `template_started_at` / `template_completed_at` (server timestamps, never client-supplied) | `get_my_onboarding_status()` | `published` (+ funnel phase `completed`) |

The reader issues exactly four calls — `profiles`,
`get_my_owner_workspace()`, `get_my_onboarding_status()`,
`get_owner_editor_state()` (`src/lib/ownerEntryRoute.ts:108-120`) — and turns
them into one stage (`:161-179`) and one existing view (`:189-210`): wizard,
preview, dashboard, or *no move at all*.

Two states in the brief are therefore **not** separate stored states: "business
details saved" is the save transaction itself, and "website published" is
derived from the salon row + the verified completion. Neither needs a flag, and
adding one would create a second source of truth that could disagree with the
salon the public site is actually served from.

## PART B — The six objects the brief asked to look for

| Object | Verdict | Evidence |
|---|---|---|
| `onboarding_status` | **EXISTS** | `growth_onboarding.status` with `check (status in ('not_started','linked','template_started','template_completed'))` (`20260912:142-155`), read by `get_my_onboarding_status()` (`:371`), written only by the RPCs (forward-only, idempotent). The partner-side projection is `partner_referrals.status` / `conversion_status` (`20260928`, PART 3 audit PART B row 7) — same facts, not a second model. |
| `setup_status` | **ABSENT — and correctly so** | No column, no enum, no migration. "Setup" in this codebase is the workspace question, and it is answered per call by `get_my_owner_workspace()`: `resolved` / `ambiguous` / `salon_count` (`20261002:482`). A stored status would have to be invalidated on every membership/salon change; the derived answer cannot drift. |
| `workspace_status` | **ABSENT — derived** | Workspace state *is* `organization_members(role,status)` + `salons(deleted_at is null)` (`nexora_owner_salon_ids()`, `20261002:211`). `ownerEntryStageRef` (`App.tsx:701`) holds the derived answer for the session only. |
| profile completion | **ABSENT — and no percentage exists** | The profile row always exists (signup trigger), so "completion" is not a state the app can fail to have. What an owner typed lives in `owner_editor_state.state.profile`; contacts are denormalized into `profiles`/`salons` by `sync_owner_contact()` (`20260909045308:16`). No `%` field, no checklist column. |
| salon state | **EXISTS** | `salons.is_active`, `verified`, `deleted_at`, `data`, `updated_at` (production shape, `20261002:175-200`); the membership gate is `organization_members.role/status`. |
| website config | **EXISTS** | `owner_editor_state.state` (the editor's own payload: profile, services, stylists, loyalty config, `selectedTemplateId` — `src/lib/ownerEditorState.ts:41-47`) plus the normalized `salons.data->'editor_profile'`, `services`, `staff`, `staff_services`, `staff_schedules`, `salon_hours` written by the same transaction (`20260909142000`). |

## PART C — One inventory, four authority layers

**The inventory (asserted as an exact list in 8.1 so a future migration that
moves state fails the build):**

```
growth_onboarding   status · linked_at · growth_partner_id · template_started_at · template_completed_at
owner_editor_state  owner_id · state · updated_at
organization_members role · status
salons              slug · name · is_active · deleted_at · data
services            salon_id · is_active
```

**Authority, in order:**

1. **The database** — the five objects above, written by SECURITY DEFINER RPCs.
2. **RPC projections** — `get_my_onboarding_status`, `get_my_owner_workspace`,
   `get_owner_editor_state`, `get_my_growth_referral`, `get_my_partner_*`.
3. **Client cache (`localStorage`)** — `nexora_salon_state_v1` (the editor's
   local copy, `src/lib/salonStore.ts:20`), `nexora_draft_salon_data` (a pending
   cloud draft, `src/lib/autoSave.ts:653`), `nexora_auth_profile_state`. These
   are *copies*: the app treats them as usable when the cloud is unreachable and
   replaces them on the next successful read.
4. **Client-only flags — authority: none.** `onboarding_wizard_completed`
   (`salonStore.ts:21`) is per-device and is consulted **only** after the
   backend stage could not be determined (`App.tsx:1518-1548`). The code says
   why in its own comment: on a new phone it claims "not completed" for an owner
   who published last week. Nothing server-side reads it, and the database has
   no such column (8.1 asserts the whole class is absent).

## PART D — What the walk actually looks like

`8.10` walks one owner through the real database and collects the stages the
classification produces:

```
signup            -> no-workspace            (profile row only; view wizard, step 1)
ensure_owner_workspace -> onboarding-incomplete   (view wizard, step 1)
first save        -> editor-started          (view wizard, step 2)
completion        -> published               (view dashboard)
```

and `8.2`, `8.6`, `8.9`, `8.10` pin the two "never guess" answers, which are
what make the rest trustworthy: an unreadable fact set classifies as `unknown`
and moves nobody, and a database that predates `20261002` is reported as
"workspace unsupported" instead of being mistaken for an incomplete step (the
same rule as `tests/ownerEntryRoute.test.ts:155`).

## PART E — 8.1: why no state table was created

`onboarding_sessions` would store: `user_id`, a status, a step, and timestamps.
All four already exist in `growth_onboarding`, keyed by `user_id` (primary key —
structurally one session per user), with the statuses the app understands and
server-set timestamps. Creating it would:

* give the funnel **two** session records that can disagree, with no rule for
  which one wins (the same failure mode PHASE 7 forbade for referral models);
* duplicate a table other features already read (`get_my_onboarding_status`,
  the partner dashboard's conversion mapping, the PART 3 completion chain);
* require new RLS, new grants and a backfill for existing owners — all to store
  what one indexed row per user already stores.

What *would* justify new storage, stated plainly so the decision is auditable
rather than assumed: a state that (a) cannot be derived from the five objects
above, (b) must be queried/reported on independently of a user session, and
(c) is not a projection of an existing write. The two candidates that came
closest both failed one of those tests:

* **a chosen template with no save yet** — it *is* stored
  (`owner_editor_state.state.selectedTemplateId`); what is missing is the
  *distinction*, not the storage (F1);
* **a direct owner's completion** — the storage exists and is explicitly
  documented as "one row per auth user"; what is missing is that the application
  never creates the row for them (G1). Adding a column or table would not fix
  it; calling the existing path would.

## PART F — The findings, with the minimal fix for each

### F1 — `template-selected` cannot occur (derivation gap)

`facts.templateId` is assigned inside the same block that sets
`facts.hasEditorState = true` (`src/lib/ownerEntryRoute.ts:148-152`), so the
classification can never see "a template was chosen but nothing was saved":

```ts
if (facts.hasEditorState) return 'editor-started';   // always taken first
if (facts.templateId) return 'template-selected';    // unreachable
```

8.4 proves it three ways: a real owner with a saved template classifies as
`editor-started`; an exhaustive sweep of every `get_owner_editor_state` response
shape the reader accepts (`null`, `{}`, template-only, full state) × every
funnel status never yields the stage; and both stages deliberately open the same
wizard step (`ownerEntryWizardStep`, `:217-219`), so no owner-visible behaviour
depends on the distinction today.

Nothing to change unless the product wants the distinction. If it does, the
minimal options are, in order of cost: (a) drop the stage and let the two cases
collapse (a label removal, no schema change); (b) derive it from a signal that
means "not saved yet" — `owner_editor_state` absent while the wizard recorded a
selection — which needs a new writer, not a new column. **Recommendation: (a),
as a follow-up; not done here**, because `tests/ownerEntryRoute.test.ts:111`
asserts the six-stage matrix and the brief for this phase is an audit.

### F2 — "unreadable" is not "not started" (already correct, now pinned)

`readOwnerEntryFacts` distinguishes a failed `profiles` read from a missing row
(`profileReadOk`), and `classifyOwnerEntry` refuses to route on a failed read.
8.10 executes that path for real (every call fails → `unknown` → no move). This
matters for the audit's conclusion: the seven states are trustworthy precisely
because *unreadable* is a seventh answer.

### G1 — a direct owner's onboarding can never be recorded (real gap)

Facts, all executed in 8.9:

* `complete_template_onboarding()` returns `{completed: false, status:
  'not_started'}` and **creates nothing** when the caller has no funnel row
  (`20260914:141-160`) — Phase 5 chose that deliberately and
  `tests/templateCompletion.test.ts:360` pins it;
* the app never creates the row for a direct owner: `updateMyOnboardingProgress`
  has **no callers** in `src/` (only the wrapper exists,
  `src/lib/growthPartner.ts:178`), and the one entry that does write the row for
  a non-referred user — `create_template_handoff()` — refuses them by design
  ("A verified referral is required before entering the Template App",
  `20260913:133`, pinned in 8.8);
* so for an owner who signed up **without** a `?ref=` link: website complete,
  salon named and slugged, an active service, editor state saved — and
  `get_my_onboarding_status()` still answers `not_started` forever. Their
  `OwnerEntryStage` therefore stays `editor-started`, and a returning owner with
  a **finished, public** website is routed to the editor instead of the
  dashboard (`ownerEntryView('editor-started') === 'wizard'`). The Onboarding
  App's own phase mapper agrees with the wrong answer: it folds an unlinked user
  to `pending` regardless of status (`src/onboarding/lib/flow.ts:20-31`,
  asserted in 8.7).

**Minimal fix that needs no schema change** — the insert already exists in the
same module:

```sql
-- 20260912:304 (again at :439 and 20260914:233) — the pattern, verbatim:
insert into public.growth_onboarding as o (user_id) values (actor)
on conflict (user_id) do nothing;
```

so either

* **(a, recommended)** call the existing `update_my_onboarding_progress('start_template')`
  once from the editor's first save (`src/components/WebsiteEditor.tsx`, next to
  `recordTemplateCompletion()`), or
* **(b)** let `complete_template_onboarding()` perform that same insert before
  its `v_row.user_id is null` branch instead of returning early.

Both are behaviour changes to code Phase 5/7 pinned, so **neither is applied
here**: (b) contradicts the documented "no row → no-op (nothing created)"
contract and would have to update `tests/templateCompletion.test.ts:360`; (a)
adds one RPC to the save path for everyone and changes what a referred owner's
`template_started_at` can be (currently server-set at handoff). Say which you
want and it is a small, test-first change; the audit's job is to make the
decision visible, not to take it.

## PART G — Change list

| File | Change |
|---|---|
| `tests/onboardingStateResolution.test.ts` (new, 10 tests) | the audit, executed: inventory + forbidden objects, each of the seven states driven through the production reader and classifier against the real chain, F1's unreachability sweep, and G1 with its consequence |
| `ONBOARDING_PHASE8_STATE_AUDIT.md` (new) | this report |

**No production file was modified. No migration was added. No table, column,
enum, index or RPC was created.** The suite asserts the second claim mechanically:
the migration inventory is unchanged, and none of
`onboarding_sessions|setup_status|workspace_status|profile_completion|onboarding_step|wizard_state|is_published|published_at`
appears in the database, in any committed migration, or in
`App.tsx`/`ownerEntryRoute.ts`/`salonStore.ts`/`growthPartner.ts`.

## PART H — Verification

```
tsc --noEmit (5.8.3)   exit 0
npm run build          exit 0
npx tsx --test tests/onboardingStateResolution.test.ts   10 tests, 10 pass, 0 fail  (~3.4s)
npm test               1386 tests, 1383 pass, 0 fail, 3 skipped   (was 1376)
npm run test:dom         70 tests,   70 pass, 0 fail
npm run test:partner    451 tests,  451 pass, 0 fail
```

Fixture gaps this suite had to model (each one commented in the test, each a
limitation of `tests/liveSchemaFixture.ts` rather than of the product): the
`00001` `profiles` shape the owner-state migrations grant on, the salon columns
production has (`is_active`, `verified`, `owner_id`, `deleted_at`, contact
columns), the `salons.slug` uniqueness that
`ensure_owner_workspace()`'s collision retry is driven by, and `salon_staff`
(which `20260909142000`'s compatibility block resolves by name).

### Related evidence that already existed

* `tests/ownerEntryRoute.test.ts` — the stage matrix, the reader's four reads,
  the "no move on an unreadable state" rules, and the source-scan that keeps
  `App.tsx` routing on the backend stage.
* `tests/templateCompletion.test.ts` — the verified completion, the idempotency,
  and the no-row no-op that G1 rests on.
* `tests/hydrationResume.test.ts`, `tests/ownerWorkspaceRpc.test.ts`,
  `tests/ownerWorkspaceProvisioning.test.ts` — the save path and the workspace
  resolution this audit reads back.
* `tests/dom/onboardingJourneyBrowserFlow.test.ts` — the same states through the
  real browser components.
