export type ReferralDatePreset = 'all' | 'today' | 'last7' | 'last30' | 'custom';
export interface ReferralFilters {
  search: string;
  datePreset: ReferralDatePreset;
  startDate: string;
  endDate: string;
  conversion: 'all' | 'converted' | 'not_converted';
  sort: 'newest' | 'oldest' | 'recently_active';
}
export const DEFAULT_REFERRAL_FILTERS: ReferralFilters = {
  search: '', datePreset: 'all', startDate: '', endDate: '', conversion: 'all', sort: 'newest',
};
function calendarDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose a valid start and end date.');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error('Choose a valid start and end date.');
  return date;
}
/** Local calendar days, inclusive end date; SQL uses a half-open UTC interval. */
export function referralDateBounds(filters: ReferralFilters, now = new Date()): { joinedFrom?: string; joinedBefore?: string } {
  if (filters.datePreset === 'all') return {};
  let start: Date;
  let end: Date;
  if (filters.datePreset === 'custom') {
    start = calendarDate(filters.startDate); end = calendarDate(filters.endDate);
    if (start > end) throw new Error('Start date must be on or before end date.');
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    end = new Date(start);
    start.setDate(start.getDate() - (filters.datePreset === 'last7' ? 6 : filters.datePreset === 'last30' ? 29 : 0));
  }
  end.setDate(end.getDate() + 1);
  return { joinedFrom: start.toISOString(), joinedBefore: end.toISOString() };
}
