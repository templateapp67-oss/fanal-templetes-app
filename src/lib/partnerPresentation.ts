import type { PartnerReferralEntry } from './growthPartner';

export function formatPartnerDate(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString();
}

export function referralTitle(row: Pick<PartnerReferralEntry, 'ref' | 'display_name'>): string {
  const name = (row.display_name || '').trim();
  return name || `Referred user ${row.ref}`;
}

