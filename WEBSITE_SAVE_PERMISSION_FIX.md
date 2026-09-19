# Fix: Website Editor save — "Database permission problem — please sign in again"

Reported symptom (red toast after clicking **Save & Update Website**):

```
Save failed: Database permission problem — please sign in again. If it persists,
confirm the Supabase schema, RLS policies and grants (supabase/migrations,
SUPABASE_SETUP.md) are applied.
```

That toast is produced by `summarizeSaveError()` (`src/lib/autoSave.ts`) for
every auth-like rejection. It covered **two different root causes**, and the
fix therefore has two halves.

## Root cause A — a stale access token was treated as a database problem

The editor used whatever session the Supabase client happened to hold. When the
tab had been backgrounded (or the laptop slept, or the refresh token had been
rotated/revoked elsewhere) the write went out with a JWT that had expired;
PostgREST answers `401` / `"JWT expired"` **before** any RLS policy is
consulted, and the app reported it as a permission/RLS failure. Nothing was
wrong with the database.

**Fix — refresh silently, retry once, then say what actually happened:**

| Where | What it does now |
| --- | --- |
| `src/lib/authSession.ts` (new) | `ensureFreshSession(client)` returns a usable token, refreshing first when the token is expired or within a 120s margin. A refresh that fails while the token is still valid keeps that token instead of failing the save. `refreshSessionForSave()` forces a refresh for the retry. Never throws. |
| `src/lib/autoSave.ts` (`runSalonSavePipeline`) | If the **direct table write** (`syncSalonToSupabase`) is refused as unauthenticated, refresh the session and retry that write once with the fresh token; only if it fails again does the pipeline degrade to the service-role fallback, which then reuses the same fresh token. |
| `src/lib/ownerEditorState.ts` | Before the `save_owner_editor_state` RPC, refresh the session; if the RPC is still rejected as unauthenticated, refresh once and retry the same transaction before reporting a failure. Only *session* failures are retried — a missing GRANT/RLS rejection is deterministic and is surfaced immediately. |
| `src/lib/autoSave.ts` | `runSalonSavePipeline` accepts a `refreshSession` hook and uses the fresh token for the service-role fallback (`POST /api/website/save`, which verifies the token against Supabase Auth). New `isSessionExpiryFailure()` separates session expiry from grants/RLS; `SESSION_EXPIRED_SAVE_MESSAGE` is the new owner-facing copy. |
| `src/App.tsx` | The save pre-flight (and the hydration pre-check) now refresh the session. A save that still cannot authenticate flips `saveNeedsSignIn`, which the editor renders as a notice; it clears on a successful save or a fresh sign-in / token refresh. |
| `src/components/SavePermissionNotice.tsx` (new) + `WebsiteEditor.tsx` | In-editor amber notice: *"Your session expired, so this website could not be published to the cloud. Your edits are saved on this device — sign in again and press Save to publish them."* with **Sign in again** and **Retry Save** actions. |

A real session expiry no longer says "Database permission problem"; a genuine
grants/RLS rejection still does (that is the correct advice for it).

## Root cause B — the salon-profile table could be missing its policy/grants

The current save transaction is caller-scoped and ends in an **INVOKER**
function:

```
save_owner_editor_state(jsonb)           -- security invoker wrapper
  └─ nexora_save_owner_workspace(jsonb)  -- SECURITY DEFINER, owns the transaction
       └─ sync_owner_contact(jsonb)      -- SECURITY INVOKER → runs AS THE OWNER
```

`sync_owner_contact()` updates `public.profiles` and upserts
`public.owner_editor_state` with the signed-in role's privileges, so a project
where either

* the `authenticated` role lacks the table/column GRANTs
  (`permission denied for table profiles`, `42501`), or
* the owner-scoped RLS policy is missing
  (`new row violates row-level security policy`)

fails every editor save with exactly the reported toast. Older column-level
GRANT migrations (`20260909043304`, `20260909045308`) name optional columns; on
a schema without one of them the whole migration errored and rolled back —
taking the RPC grants and the `owner_editor_state` policy with it, which is how
a project ends up with tables but no privileges.

**Fix — `supabase/migrations/20261010_salon_profile_rls_and_grants.sql`
(idempotent):**

1. Enables RLS on `public.profiles` (and `public.owner_editor_state` when present).
2. Recreates the owner-scoped policies, including the one named in the report:

   ```sql
   drop policy if exists "Users can insert/update their own profile" on public.profiles;
   create policy "Users can insert/update their own profile" on public.profiles
     for all to authenticated
     using (auth.uid() = id) with check (auth.uid() = id);
   ```

   The repair is applied to whichever salon-profile table the project has —
   `profiles` (this repo), `salon_profiles` or `website_profiles` — and the
   owner column is detected per table: `user_id` when present (the classic
   shape the report names), otherwise `id`. The four canonical
   `<table>_*_owner` policies are recreated as well.
3. Applies `GRANT ALL` (the clause the incident report asks an operator to
   confirm) and immediately revokes the privileges that are **not** row-scoped:

   ```sql
   grant all on table public.profiles to authenticated;
   revoke truncate, references, trigger on table public.profiles from authenticated;
   -- (MAINTAIN is also revoked on PG 17+)
   ```

   `TRUNCATE` bypasses Row Level Security completely — left granted, any
   signed-in user could wipe every salon's profile row in one statement — and
   `REFERENCES` / `TRIGGER` / `MAINTAIN` are never used by the save path. The
   net effect is the four DML privileges `20260907_owner_save_grants.sql` has
   always granted, plus per-column `update` grants applied only for columns
   that exist, so no schema variant can half-apply the migration.
4. Re-asserts `EXECUTE` on the save/read RPCs for `authenticated` (revoked from
   `public`/`anon`) and reloads the PostgREST schema cache.
5. Kept in sync with the one-file operator repair
   `supabase/rls-restore-production.sql` (which also gained the combined
   profile policy and the `owner_editor_state` section).

Also fixed while verifying: the grant-verification queries in
`SUPABASE_SETUP.md`, `supabase/rls-restore-production.sql` and
`supabase/rls-test-disable.sql` selected `schemaname`/`tablename` from
`information_schema.role_table_grants`, which has neither column — the
"confirm the grants are applied" step errored out instead of reporting.

## Apply it

```bash
supabase db push          # or paste the file into the SQL Editor
```

Then sign out and back in once and save the editor again. Verify in the SQL
Editor:

```sql
-- 1) RLS + policies (profiles now carries 5 policies, including the combined one)
select c.relname, c.relrowsecurity,
       (select count(*) from pg_policies p
         where p.schemaname='public' and p.tablename=c.relname) as policy_count
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in ('profiles','owner_editor_state');

-- 2) Grants for the signed-in role
select has_table_privilege('authenticated','public.profiles','SELECT') as can_select,
       has_table_privilege('authenticated','public.profiles','INSERT') as can_insert,
       has_table_privilege('authenticated','public.profiles','UPDATE') as can_update,
       has_table_privilege('authenticated','public.profiles','DELETE') as can_delete;

-- 3) Cross-tenant negative test (signed in as a second account) — expect 0
select count(*) from public.profiles where id is distinct from auth.uid();
```

## Tests pinning this

* `tests/authSessionRefresh.test.ts` — refresh-before-save, keep-a-still-valid-token, session-vs-RLS classification, toast copy.
* `tests/ownerEditorStateRefresh.test.ts` — pre-flight refresh, refresh-and-retry on `JWT expired`, no retry for grants/RLS errors, no-auth-client clients still save.
* `tests/savePipeline.test.ts` — the direct table write is retried once with the refreshed token, the service-role fallback reuses it, and non-auth failures never trigger a refresh.
* `tests/salonProfileRlsMigration.test.ts` — runs migration 20261010 in PGlite: the requested policy exists, the owner can CRUD their own row, another owner cannot, idempotency, a minimal schema without optional columns still applies, and a project whose table is literally named `salon_profiles` (owner column `user_id`) gets the reported policy + `GRANT ALL` verbatim.
* `tests/rlsRestoreProductionScript.test.ts` — the operator repair script restores RLS/policies/grants and is safe to re-run.
* `tests/dom/websiteEditorSessionNotice.test.ts` — the editor notice renders with both actions and disappears for a healthy session.
