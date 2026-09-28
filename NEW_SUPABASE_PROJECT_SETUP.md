# Connect this app to the new Supabase project

Project URL: `https://zilwgiuiygqqardzutxi.supabase.co`  
Project ref: `zilwgiuiygqqardzutxi`

## Important: project provisioning is not yet complete

The repository contains a large set of historical SQL migrations for multiple generations of the app schema. The existing `SUPABASE_SETUP.md` explicitly warns that these migrations must not be blindly run against an existing database. A project URL alone does not authorize this repository to connect to or modify the database, and this workspace does not have the project's API keys or database password. **No remote database has been modified by this change.**

## Credentials to add privately

Retrieve these from the new project's Supabase Dashboard → **Project Settings → API** and add them to the deployment environment / local `.env` (never commit `.env`):

```dotenv
VITE_SUPABASE_URL=https://zilwgiuiygqqardzutxi.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable-or-anon-key>
SUPABASE_URL=https://zilwgiuiygqqardzutxi.supabase.co
SUPABASE_ANON_KEY=<publishable-or-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<secret-service-role-key>
```

The service-role/secret key must remain server-side; never use it in a `VITE_` variable, browser code, GitHub, or chat. Add the same appropriate variables to the app's hosting provider (for example, Vercel). Do not share the database password or secret key in a public issue or commit.

## Safe database rollout

1. Confirm the new Supabase project is the intended production project and take a backup if it contains data.
2. Review `SUPABASE_SETUP.md`, `ARCHITECTURE.md`, and all files under `supabase/migrations/`. In particular, resolve the documented schema-generation compatibility warning before applying migrations. The directory contains incremental migrations and is not equivalent to a single clean, guaranteed bootstrap.
3. Install/use the Supabase CLI, authenticate in a trusted local environment, and link only the intended project:

   ```bash
   supabase login
   supabase link --project-ref zilwgiuiygqqardzutxi
   supabase migration list
   ```

4. Review the pending migration list and SQL, then apply only the validated migration set:

   ```bash
   supabase db push --dry-run
   # Only after the dry run and migration review:
   supabase db push
   ```

   Do not run `supabase db reset` against the hosted project. Do not disable RLS as a deployment workaround.
5. Enable/configure the required Auth providers and redirect URLs in Supabase Dashboard. Deploy and configure Edge Functions separately if the app uses them; configure their secrets server-side.
6. Verify the live schema, RLS policies, auth signup/login, tenant isolation, booking flows, and server health against this specific project before declaring migration complete.

## What is still needed

To complete and verify the live setup, a project administrator must make the API keys available through the private environment/secrets mechanism and confirm the target database can be migrated. Credentials are intentionally not requested in chat. The app's schema and RLS source of truth is in `supabase/migrations/`; this file is a deployment checklist, not a claim that the remote backend is already provisioned.
