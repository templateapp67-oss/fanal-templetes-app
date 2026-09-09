# Partner profile settings

Signed-in partners can open **User Profile Settings** from the avatar in the global header. The dialog saves name, WhatsApp number, Indian PIN code, city and avatar to the existing salon profile, and stores DOB, locality and notification consent in owner-private `partner_settings`.

## Deploy

1. Apply `supabase/migrations/20260909035237_partner_profile_settings.sql` to the app's existing Supabase project after the initial schema. It adds a private table, an authenticated transactional RPC, and a public avatar bucket with owner-scoped upload/delete permissions. It does not replace existing tables.
2. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the same project; retain existing server environment configuration.
3. Build and deploy the application. Sign in, open the header avatar, save all fields, reload, and reopen the dialog to verify persistence.

Avatar files are public (suitable for salon pages). DOB and consent remain private under RLS. New images are compressed to at most 500px and uploaded under the authenticated user's UUID. Failed profile saves attempt to remove the new upload. Previously saved images are retained to avoid breaking existing references.

WhatsApp consent is saved only. Automatic message delivery still requires a configured WhatsApp Business provider and booking-event integration; this change does not claim messages were sent.

## Validation

`npm run typecheck`, `npm test`, and `npm run build`.
The new PGlite database tests execute the migration and RPC, test persistence, malformed PIN rejection, anonymous access rejection and cross-owner isolation.
