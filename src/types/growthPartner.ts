// ============================================================================
// The Growth Partner area's public TYPE surface.
//
// One import path for anything consuming the facade:
//
//   import type { GrowthPartnerResult, PartnerReferralEntry } from '../types/growthPartner';
//
// This file re-exports and DOES NOT DEFINE ANYTHING — that is the point. The
// only thing worse than a wrong type name is two of them: a component reading
// `partner.referralCode` while the database sends `referral_code` compiles
// cleanly and renders "—" forever. The single definitions live in
// `src/lib/growthPartner.ts`, `src/lib/partnerPortalOperations.ts` and
// `src/services/growthPartner.ts`; a test pins this file to re-exports only
// (`tests/growthPartnerPublicSurface.test.ts`), so a second definition cannot
// quietly appear here.
// ============================================================================

// ---------------------------------------------------------------------------
// Identity + gate (who the caller is, decided by the database from the JWT)
// ---------------------------------------------------------------------------

export type {
  GrowthPartner,
  GrowthPartnerApplicationRow,
  GrowthPartnerGate,
  GrowthOnboardingStatusValue,
  GrowthOnboardingStatus,
  GrowthOnboardingRow,
  GrowthReferralRelationship,
  OnboardingProgressAction,
  ValidateReferralResult,
} from '../lib/growthPartner';

// ---------------------------------------------------------------------------
// Dashboard + referral read models (masked contact, server-side paging)
// ---------------------------------------------------------------------------

export type {
  PartnerActivityEntry,
  PartnerActivityType,
  PartnerDashboardData,
  PartnerMonthlyPoint,
  PartnerPerformanceData,
  PartnerReferralActivity,
  PartnerReferralEntry,
  PartnerReferralFilter,
  PartnerReferralList,
} from '../lib/growthPartner';

// ---------------------------------------------------------------------------
// Operational sections: every value in these payloads is PAISE (INR), never a
// currency-scoped float and never a client-side computation.
// ---------------------------------------------------------------------------

export type {
  PartnerEarningRow,
  PartnerEarningsPayload,
  PartnerLeaderboardPayload,
  PartnerLeaderboardRow,
  PartnerLevelRow,
  PartnerLevelsPayload,
  PartnerMarketingAsset,
  PartnerMarketingCategory,
  PartnerNotificationPreferences,
  PartnerNotificationRow,
  PartnerNotificationsPayload,
  PartnerPayoutMethod,
  PartnerPayoutRequestRow,
  PartnerPayoutRequestsPayload,
  PartnerSupportTicketReceipt,
  PartnerSupportTicketRow,
  PartnerTicketPriority,
} from '../lib/partnerPortalOperations';

// ---------------------------------------------------------------------------
// The result contract: `{ ok: true, data } | { ok: false, error }`.
//
// A method on this facade never rejects and never returns a fake zero: a value
// that could not be read is `ok: false` with a classified error, and the caller
// decides what to render.
// ---------------------------------------------------------------------------

export type {
  GrowthPartnerFailure,
  GrowthPartnerResult,
  GrowthPartnerSuccess,
  PayoutRequestInput,
  PartnerReferralQuery,
} from '../services/growthPartner';

// The one value in a type surface, on purpose: callers need the class for
// `instanceof` and for `GrowthPartnerServiceError.from(thrown)`.
export { GrowthPartnerServiceError } from '../services/growthPartner';

/** The classified cause behind an `ok: false` (kind, owner, next step, code). */
export type { PartnerAreaFailure } from '../lib/partnerAreaFailure';

// ---------------------------------------------------------------------------
// Not in this vocabulary — and why
//
// Ideas from other Growth Partner codebases map onto these names, but the
// fields differ, so aliasing them would compile and then read undefined:
//
//   TransformedReferral     → PartnerReferralEntry   (masked_contact, not email;
//                                                      referral_status, not status;
//                                                      joined_at, not joinedAt;
//                                                      NO earnings field)
//   TransformedEarnings     → PartnerEarningsPayload (totals.*_paise + transactions,
//                                                      not total/pending/paid floats)
//   PartnerStats            → PartnerDashboardData.kpis + PartnerPerformanceData
//                             (counts and rates are computed SERVER-side)
//   partner.name/.email     → display_name / masked_contact (raw contact never
//                             leaves the database)
//   partner.tier            → no equivalent: commission comes from
//                             PartnerLevelRow.commission_bps
//   partner.referralCode    → referral_code (snake_case; there is no camelCase row)
//   fetchPartner(partnerId) → growthPartnerService.getMyPartner() — the identity
//                             is the session JWT and a partner id is never sent.
// ---------------------------------------------------------------------------
