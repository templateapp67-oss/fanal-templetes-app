# Partner profile settings

Signed-in partners open **User Profile Settings** from the avatar in the global header. Avatar, WhatsApp number, DOB, Indian PIN code, city, locality and WhatsApp consent persist through authenticated Supabase RPCs.

## Deployment

The live app https://fanal-templetes-app.vercel.app uses Supabase project `qwaehqsmodekbgvnaavz` (`nexora-staging`). This was verified through `/api/health`, not inferred from a project name.

Applied on 2026-09-09:
- `20260909035237_partner_profile_settings.sql`: private settings, validated save/load RPCs and avatar bucket; compatible with the deployed normalized profile schema and the repository legacy schema.
- `20260909043304_partner_profile_column_grants.sql`: column-level permission for editable profile fields, preserving role/balance restrictions.
- `20260909043430_verify_partner_profile_rollback.sql`: live save/reload, validation and isolation checks inside a rolled-back subtransaction. Test values do not persist.

The normalized schema uses existing `pincode`, avatar, DOB and city/locality fields. WhatsApp has its own field and does not overwrite login phone details. Consent also updates existing `user_preferences.whatsapp_notifications`.

Avatar files are public for salon display; DOB and consent are owner-private. Images are compressed to at most 500px. Failed saves attempt to remove their new upload; old saved images are retained to preserve references.

WhatsApp consent is persisted only. Automatic delivery requires a WhatsApp provider and booking-event integration.

## Verification

`npm run typecheck`, `npm run build`, and `node --import tsx --test tests/partnerProfile.test.ts`.

Live database save/reload and permission tests passed with rollback; no new security advisor findings were introduced by the initial migration. Full-suite results from the initial implementation: 770 passed, 12 failed in payment/API tests in the unconfigured local environment.

Optional real storage HTTP test: `node scripts/verify-partner-profile.mjs /path/to/private.env` using the target project's service-role and public keys. It creates and cleans up a temporary test account and image. Vercel sensitive service keys cannot be exported, so this test was not completed in this session. Browser automation was unavailable; no visual/end-to-end browser verification is claimed.
