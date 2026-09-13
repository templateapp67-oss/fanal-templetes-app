import { STATUS_TONE_CLASSES, type StatusTone } from './statusTheme';

export type ReferralStatus = 'clicked' | 'registered' | 'pending' | 'active' | 'converted' | 'inactive' | 'cancelled' | 'rejected';
export const REFERRAL_STATUS_DESCRIPTORS: Record<ReferralStatus, { label: string; tone: StatusTone; description: string }> = {
  clicked: { label: 'Clicked', tone: 'slate', description: 'A referral link was opened; no account is linked yet.' },
  registered: { label: 'Registered', tone: 'amber', description: 'An account was created with validated attribution.' },
  pending: { label: 'Pending', tone: 'amber', description: 'Registered with your code; website onboarding has not started.' },
  active: { label: 'Active', tone: 'blue', description: 'Website onboarding is underway.' },
  converted: { label: 'Converted', tone: 'emerald', description: 'The referred user completed their website. This does not indicate a payment.' },
  inactive: { label: 'Inactive', tone: 'slate', description: 'An administrator has marked this referral inactive.' },
  cancelled: { label: 'Cancelled', tone: 'slate', description: 'An administrator has cancelled this referral.' },
  rejected: { label: 'Rejected', tone: 'rose', description: 'An administrator has rejected this referral.' },
};
export const PRIMARY_REFERRAL_STATUSES: ReferralStatus[] = ['pending', 'active', 'converted', 'inactive'];

/** Supports older RPC payloads without changing the onboarding state machine. */
export function resolveReferralStatus(value: unknown): ReferralStatus | null {
  if (typeof value !== 'string') return null;
  if (Object.prototype.hasOwnProperty.call(REFERRAL_STATUS_DESCRIPTORS, value)) return value as ReferralStatus;
  if (value === 'linked' || value === 'not_started') return 'pending';
  if (value === 'template_started') return 'active';
  if (value === 'template_completed') return 'converted';
  return null;
}

export function referralStatusDescriptor(value: unknown) {
  const status = resolveReferralStatus(value);
  const descriptor = status ? REFERRAL_STATUS_DESCRIPTORS[status] : { label: 'Unknown', tone: 'slate' as const, description: 'Referral status is unavailable.' };
  return { ...descriptor, badgeClassName: `border ${STATUS_TONE_CLASSES[descriptor.tone].badge}` };
}

/** Primary v1 tabs. All includes Cancelled/Rejected referrals as well. */
export const REFERRAL_STATUS_TABS = ['all', 'pending', 'active', 'converted', 'inactive'] as const;
export type ReferralStatusTab = typeof REFERRAL_STATUS_TABS[number];
export type ReferralStatusCounts = Record<ReferralStatusTab, number> & Partial<Record<'cancelled' | 'rejected', number>>;
