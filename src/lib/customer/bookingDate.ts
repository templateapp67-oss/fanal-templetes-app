/** Calendar-date helpers for booking. Appointment dates are salon wall dates, not UTC instants. */
export const BOOKING_TIMEZONE = 'Asia/Kolkata';

/** Accept the date input's YYYY-MM-DD format and the legacy DD-MM-YYYY format. */
export function normalizeBookingDate(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  let iso = raw;
  const legacy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(raw);
  if (legacy) iso = `${legacy[3]}-${legacy[2].padStart(2, '0')}-${legacy[1].padStart(2, '0')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [year, month, day] = iso.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return iso;
}

/** Today's salon-calendar date, independent of the browser/server's UTC offset. */
export function todayInTimezone(now: Date = new Date(), timeZone = BOOKING_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Add days using UTC calendar arithmetic so local DST/timezone cannot shift a date. */
export function addBookingDays(value: string, days: number): string {
  const normalized = normalizeBookingDate(value);
  if (!normalized) return '';
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function weekdayForBookingDate(value: string): number {
  const normalized = normalizeBookingDate(value);
  if (!normalized) return -1;
  const [year, month, day] = normalized.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

export function minutesNowInTimezone(now: Date = new Date(), timeZone = BOOKING_TIMEZONE): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((item) => item.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((item) => item.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}
