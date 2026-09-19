import React from 'react';
import {
  PartnerEarningsPage,
  PartnerLeaderboardsPage,
  PartnerLevelsPage,
  PartnerMarketingMaterialsPage,
  PartnerNotificationsPage,
  PartnerSupportPage,
  PartnerWithdrawalsPage,
} from './partner';

// ============================================================================
// Compatibility shim. These seven components were the "Coming soon" previews
// of the portal modules; Part 3 promoted the sections into real sidebar routes
// and the pages themselves now live in `src/components/partner/` (one file per
// route). This module keeps the previous `Partner*Module` names working for any
// caller that still imports them from here.
// ============================================================================

export const PartnerEarningsModule: React.FC<{ accentHex?: string; navigate?: (to: string) => void }> = (props) => (
  <PartnerEarningsPage {...props} />
);
export const PartnerWithdrawalsModule: React.FC<{ accentHex?: string }> = (props) => <PartnerWithdrawalsPage {...props} />;
export const PartnerMarketingMaterialsModule: React.FC<{ accentHex?: string; referralCode?: string | null }> = (props) => (
  <PartnerMarketingMaterialsPage {...props} />
);
export const PartnerLevelsModule: React.FC<{ accentHex?: string }> = (props) => <PartnerLevelsPage {...props} />;
export const PartnerLeaderboardsModule: React.FC<{ accentHex?: string; partnerId?: string }> = (props) => (
  <PartnerLeaderboardsPage {...props} />
);
export const PartnerNotificationsModule: React.FC<{ accentHex?: string }> = (props) => <PartnerNotificationsPage {...props} />;
export const PartnerSupportModule: React.FC<{ accentHex?: string }> = (props) => <PartnerSupportPage {...props} />;
