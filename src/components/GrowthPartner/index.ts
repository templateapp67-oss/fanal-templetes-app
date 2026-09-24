// ============================================================================
// `src/components/GrowthPartner` — the Growth Partner UI entry point.
//
// The components themselves live next to the rest of the app's components
// (`GrowthPartnerPage.tsx`, `GrowthPartnerSections.tsx`, `partner/*`), and every
// one of them is already wired to the facade in `src/services/growthPartner.ts`.
// This barrel gives that set one import path:
//
//   import { GrowthPartnerPage, PartnerEarningsPage } from './components/GrowthPartner';
//
// It RE-EXPORTS and defines nothing. Copying the components into this folder
// instead would create a second implementation of each screen — the exact fork
// this repo avoids everywhere else (`src/components/partner/index.ts` is the same
// idiom). `tests/growthPartnerPublicSurface.test.ts` pins every export here to
// the identical module object, so a fork would fail the build.
// ============================================================================

// The page shell + the dashboard sections (data path: growthPartnerService).
export { GrowthPartnerPage, GrowthPartnerSectionTabs, GrowthPartnerShell, GROWTH_PARTNER_SECTION_LABELS } from '../GrowthPartnerPage';

export {
  // four states every section renders through
  SectionLoading,
  SectionError,
  SectionEmpty,
  Pager,
  // dashboard surfaces
  GrowthPartnerDashboard,
  GrowthPartnerReferrals,
  GrowthPartnerCustomers,
  GrowthPartnerPerformance,
  GrowthPartnerCommission,
  GrowthPartnerProfile,
  // referral surfaces
  ReferralStatusTabs,
  PartnerFilterPills,
  ReferralCodeCard,
  PartnerProfileCard,
  GROWTH_PARTNER_NO_REFERRALS_TITLE,
  GROWTH_PARTNER_NO_REFERRED_USERS_TITLE,
  GROWTH_PARTNER_NO_REFERRALS_BODY,
  GROWTH_PARTNER_NO_COMMISSION_TITLE,
  GROWTH_PARTNER_NO_COMMISSION_BODY,
  GROWTH_PARTNER_NO_PERFORMANCE_TITLE,
  GROWTH_PARTNER_NO_PERFORMANCE_BODY,
} from '../GrowthPartnerSections';

// Access control + the failure surface (cause, owner, next step, diagnostic).
export { PartnerRouteGuard, usePartnerRouteGuard } from '../PartnerRouteGuard';
export {
  PartnerStatusScreen,
  GrowthPartnerLoadError,
  GrowthPartnerSignInPrompt,
  GrowthPartnerUnauthorized,
  GrowthPartnerInactive,
  GrowthPartnerMockNotice,
  GrowthPartnerLoading,
} from '../PartnerStatusScreen';
export { PartnerAreaFailurePanel } from '../PartnerAreaFailurePanel';

// Sign-in surfaces (both namespaces) and the account pages.
export { PartnerPortalLogin } from '../PartnerPortalLogin';
export { GrowthPartnerLogin } from '../GrowthPartnerLogin';
export { GrowthPartnerProfilePage } from '../GrowthPartnerProfilePage';
export { PartnerAccountSettingsPage } from '../PartnerAccountSettingsPage';

// The seven operational modules (each reads and writes through the facade).
export {
  PartnerEarningsPage,
  PartnerWithdrawalsPage,
  PartnerMarketingMaterialsPage,
  PartnerLevelsPage,
  PartnerLeaderboardsPage,
  PartnerNotificationsPage,
  PartnerSupportPage,
} from '../partner';
