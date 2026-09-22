import type { PartnerReferralEntry } from './growthPartner';

export function formatPartnerDate(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString();
}

export function referralTitle(row: Pick<PartnerReferralEntry, 'ref' | 'display_name'>): string {
  const name = String(row?.display_name ?? '').trim();
  if (name) return name;
  // A row whose masked reference did not arrive still has a readable label
  // ("Referred user") instead of printing "undefined".
  const ref = String(row?.ref ?? '').trim();
  return ref ? `Referred user ${ref}` : 'Referred user';
}

// ---------------------------------------------------------------------------
// Formatting for the portal's operational sections (Earnings, Withdrawals,
// Leaderboards, Support, …). One place so a payout row and an earnings row
// never spell the same status differently.
// ---------------------------------------------------------------------------

/** The ledger stores paise (₹1 = 100 paise); every money read goes through here. */
export function formatPartnerMoney(paise: number | null | undefined, currency = 'INR'): string {
  const amount = typeof paise === 'number' && Number.isFinite(paise) ? paise : 0;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 0,
    }).format(amount / 100);
  } catch {
    // An unsupported currency code must not blank a balance out.
    return `₹${Math.round(amount / 100).toLocaleString('en-IN')}`;
  }
}

export function formatPartnerDateTime(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatPartnerFileSize(bytes: number | null | undefined): string {
  const size = typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : 0;
  if (size <= 0) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** Statuses shared by earnings rows, payout requests and support tickets. */
export const PARTNER_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  available_for_withdrawal: 'Available',
  held: 'On hold',
  paid: 'Paid',
  reversed: 'Reversed',
  in_review: 'In review',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

export function partnerStatusLabel(status: string | null | undefined): string {
  const key = String(status || '').trim();
  if (!key) return '—';
  return PARTNER_STATUS_LABELS[key] || key.replaceAll('_', ' ');
}

export const PARTNER_EARNING_TYPE_LABELS: Record<string, string> = {
  recurring_subscription_commission: 'Subscription commission',
  onboarding_reward: 'Onboarding reward',
  tier_bonus: 'Tier bonus',
  manual_adjustment: 'Adjustment',
};

export function partnerEarningTypeLabel(type: string | null | undefined): string {
  const key = String(type || '').trim();
  if (!key) return '—';
  return PARTNER_EARNING_TYPE_LABELS[key] || key.replaceAll('_', ' ');
}

/** '1500' bps → '15%'. Commission rates are stored in basis points everywhere. */
export function formatPartnerRateBps(bps: number | null | undefined): string {
  const value = typeof bps === 'number' && Number.isFinite(bps) ? bps : 0;
  const percent = value / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}

