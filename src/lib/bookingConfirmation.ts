// ============================================================================
// Booking confirmation page — pure data helpers.
//
// Everything the confirmation screen shows or links to is derived here so it
// can be unit-tested without rendering React:
//   • the summary rows (booking id, salon, service, staff, date, time,
//     address, total price),
//   • an RFC 5545 .ics file and a Google Calendar link for "Add to calendar",
//   • a Google Maps link for "Directions",
//   • the WhatsApp confirmation status line,
//   • the headline, derived from the booking's real status.
//
// Keeping this out of the component is what makes the difference between "the
// button exists" and "the button produces a valid file" — an .ics with the
// wrong line endings or an unescaped comma opens as a corrupt event in Google
// Calendar and Outlook, and that failure is invisible until a customer reports
// a missing appointment.
// ============================================================================

import {
  describeBookingStatus,
  isPersistableBookingStatus,
  bookingStatusHeadline,
  type DisplayBookingStatus,
} from './bookingStatus';

/**
 * Asia/Kolkata. India has no daylight saving, so a fixed offset is correct
 * year-round — unlike a `Date.getTimezoneOffset()` read, which would silently
 * produce the wrong slot for anyone opening the confirmation page from abroad.
 */
export const SALON_UTC_OFFSET_MINUTES = 330;

export interface ConfirmationSummaryInput {
  bookingId?: string | null;
  salonName?: string | null;
  serviceName?: string | null;
  staffName?: string | null;
  /** YYYY-MM-DD */
  date?: string | null;
  /** HH:MM */
  time?: string | null;
  address?: string | null;
  addressKind?: 'salon' | 'home';
  totalAmount?: number | null;
  currency?: string | null;
  durationMinutes?: number | null;
  latitude?: number | null;
  longitude?: number | null;
}

/** Every row the confirmation page renders, plus what the action buttons need. */
export interface BookingConfirmationSummary {
  bookingId: string;
  salonName: string;
  serviceName: string;
  staffName: string;
  date: string;
  time: string;
  addressKind: 'salon' | 'home';
  /** "Salon Address" vs "Service Address" — a home visit is not the salon. */
  addressLabel: string;
  address: string;
  totalAmount: number;
  currency: string;
  durationMinutes: number;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Normalise whatever the checkout knows into the confirmation summary. Every
 * field gets a non-empty fallback so the page can never render a bare label
 * with nothing beside it.
 */
export function buildConfirmationSummary(input: ConfirmationSummaryInput): BookingConfirmationSummary {
  const addressKind: 'salon' | 'home' = input.addressKind === 'home' ? 'home' : 'salon';
  const rawAddress = String(input.address ?? '').trim();
  return {
    bookingId: String(input.bookingId ?? '').trim() || '—',
    salonName: String(input.salonName ?? '').trim() || 'the salon',
    serviceName: String(input.serviceName ?? '').trim() || 'Selected service',
    staffName: String(input.staffName ?? '').trim() || 'Any available specialist',
    date: String(input.date ?? '').trim(),
    time: String(input.time ?? '').trim(),
    addressKind,
    addressLabel: addressKind === 'home' ? 'Service Address' : 'Salon Address',
    address: rawAddress || 'Address not set',
    totalAmount: Number.isFinite(Number(input.totalAmount)) ? Number(input.totalAmount) : 0,
    currency: String(input.currency ?? '').trim() || '₹',
    durationMinutes: Number.isFinite(Number(input.durationMinutes)) && Number(input.durationMinutes) > 0
      ? Number(input.durationMinutes)
      : 60,
    latitude: Number.isFinite(Number(input.latitude)) ? Number(input.latitude) : null,
    longitude: Number.isFinite(Number(input.longitude)) ? Number(input.longitude) : null,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Indian digit grouping (last three, then pairs): 125000 → "1,25,000".
 *
 * Implemented by hand rather than via `toLocaleString('en-IN')` so the result
 * does not depend on the ICU data present in the runtime — a Node built with
 * small-icu formats this as "125,000", which would put a different price on
 * the confirmation page than on the menu.
 */
export function formatIndianNumber(value: number): string {
  const rounded = Math.round(Number.isFinite(value) ? value : 0);
  const sign = rounded < 0 ? '-' : '';
  const digits = String(Math.abs(rounded));
  if (digits.length <= 3) return `${sign}${digits}`;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}${rest},${last3}`;
}

export function formatMoney(amount: number, currency = '₹'): string {
  return `${currency}${formatIndianNumber(amount)}`;
}

/** "2026-09-20" → "Sun, 20 Sep 2026". Returns the input unchanged if unparseable. */
export function formatBookingDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? '').trim());
  if (!match) return String(date ?? '');
  const [, year, month, day] = match;
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex > 11) return String(date);
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(year), monthIndex, Number(day))).getUTCDay()];
  return `${weekday}, ${day} ${MONTHS[monthIndex]} ${year}`;
}

/** "11:30" → "11:30 AM" (24h in, 12h out). Returns the input unchanged if unparseable. */
export function formatBookingTime(timeSlot: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(timeSlot ?? '').trim());
  if (!match) return String(timeSlot ?? '');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return String(timeSlot);
  const suffix = hour < 12 ? 'AM' : 'PM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(hour12).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${suffix}`;
}

/** "Sun, 20 Sep 2026 · 11:30 AM IST" — the single line used on the confirmation page. */
export function formatBookingDateTime(date: string, timeSlot: string): string {
  const parts = [formatBookingDate(date), formatBookingTime(timeSlot)].filter(Boolean);
  return parts.length ? `${parts.join(' · ')} IST` : '';
}

/** Compose the salon's address from the profile fields, dropping blanks and dupes. */
export function formatSalonAddress(profile: {
  shopFlatNo?: string | null;
  areaLocality?: string | null;
  address?: string | null;
  landmark?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  const fields = [
    profile.shopFlatNo,
    profile.areaLocality,
    profile.address,
    profile.landmark,
    profile.city,
    profile.state,
    profile.postalCode,
  ];
  for (const field of fields) {
    const value = String(field ?? '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue; // e.g. areaLocality duplicating address
    seen.add(key);
    parts.push(value);
  }
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Status + headline
// ---------------------------------------------------------------------------

/**
 * Which status the confirmation page should show.
 *
 * `storedStatus` is the row the API actually wrote back, so the page reports
 * what the salon's database holds rather than what the client hoped for. An
 * unreachable API is `not_submitted` — a booking that exists only in this
 * browser tab is not a booking the salon can see.
 */
export function resolveConfirmationStatus(input: {
  savedToCloud: boolean;
  storedStatus?: unknown;
}): DisplayBookingStatus {
  if (!input.savedToCloud) return 'not_submitted';
  return isPersistableBookingStatus(input.storedStatus) ? input.storedStatus : 'pending';
}

/** Customer-facing headline, derived from the resolved status. */
export function confirmationHeadline(status: unknown): string {
  return bookingStatusHeadline(status);
}

// ---------------------------------------------------------------------------
// iCalendar (.ics)
// ---------------------------------------------------------------------------

/** RFC 5545 requires CRLF line endings; LF-only files break some clients. */
const CRLF = '\r\n';
const ICS_MAX_LINE_OCTETS = 75;

/** Escape a TEXT value: backslash, semicolon, comma, and newlines (RFC 5545 §3.3.11). */
export function escapeIcsText(value: string): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold a long content line at octet boundaries, prefixing continuations with a
 * single space. Folds on character boundaries so a multi-byte character (₹, an
 * emoji) is never split in half.
 */
export function foldIcsLine(line: string, maxOctets = ICS_MAX_LINE_OCTETS): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= maxOctets) return line;
  const parts: string[] = [];
  let current = '';
  let currentOctets = 0;
  for (const char of line) {
    const charOctets = encoder.encode(char).length;
    if (currentOctets + charOctets > maxOctets) {
      parts.push(current);
      current = ` ${char}`; // the leading space counts towards the limit
      currentOctets = 1 + charOctets;
    } else {
      current += char;
      currentOctets += charOctets;
    }
  }
  if (current) parts.push(current);
  return parts.join(CRLF);
}

/**
 * Convert a salon-local slot to a UTC instant (ms since epoch).
 * Returns null for an unparseable or impossible date — `Date.UTC` would
 * otherwise silently roll 2026-02-31 into March and book the wrong day.
 */
export function toUtcTimestamp(
  date: string,
  timeSlot: string,
  offsetMinutes = SALON_UTC_OFFSET_MINUTES
): number | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? '').trim());
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(String(timeSlot ?? '').trim());
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const probe = new Date(localAsUtc);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null; // impossible date such as 2026-02-31
  }
  return localAsUtc - offsetMinutes * 60_000;
}

/** Format an instant as an iCalendar UTC timestamp: 20260920T060000Z */
export function formatUtcZ(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

export interface IcsEventInput {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string;
  durationMinutes?: number;
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  /** Injectable so tests get a deterministic DTSTAMP. */
  nowIso?: string;
  /** Reminder offset in minutes; omit to leave out the VALARM block. */
  alarmMinutesBefore?: number;
}

/**
 * Build an RFC 5545 calendar file for the appointment.
 * Returns null when the slot cannot be parsed, so the caller can disable the
 * download instead of handing the customer a corrupt file.
 */
export function buildIcsFile(event: IcsEventInput): string | null {
  const startMs = toUtcTimestamp(event.date, event.time);
  if (startMs === null) return null;

  const duration = Number.isFinite(Number(event.durationMinutes)) && Number(event.durationMinutes) > 0
    ? Number(event.durationMinutes)
    : 60;
  const endMs = startMs + duration * 60_000;
  const stamp = Number.isFinite(Date.parse(event.nowIso ?? ''))
    ? Date.parse(event.nowIso as string)
    : Date.now();

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Fanal//Salon Booking Confirmation//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.uid || `booking-${stamp}`)}`,
    `DTSTAMP:${formatUtcZ(stamp)}`,
    `DTSTART:${formatUtcZ(startMs)}`,
    `DTEND:${formatUtcZ(endMs)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
  ];
  if (String(event.location ?? '').trim()) lines.push(`LOCATION:${escapeIcsText(event.location as string)}`);
  if (String(event.description ?? '').trim()) {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description as string)}`);
  }
  lines.push(`STATUS:${event.status ?? 'CONFIRMED'}`);
  lines.push('TRANSP:OPAQUE');
  if (Number.isFinite(Number(event.alarmMinutesBefore)) && Number(event.alarmMinutesBefore) > 0) {
    lines.push(
      'BEGIN:VALARM',
      `TRIGGER:-PT${Math.round(Number(event.alarmMinutesBefore))}M`,
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(event.title)}`,
      'END:VALARM'
    );
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');

  // A trailing CRLF terminates the last content line, as the spec requires.
  return `${lines.map((line) => foldIcsLine(line)).join(CRLF)}${CRLF}`;
}

/** Filename for the download, e.g. `booking-NX-BLR-12345.ics`. */
export function buildIcsFilename(bookingId: string): string {
  const safe = String(bookingId ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${safe ? `booking-${safe}` : 'booking'}.ics`;
}

// ---------------------------------------------------------------------------
// Calendar + directions links
// ---------------------------------------------------------------------------

export interface CalendarLinkInput {
  title: string;
  description?: string;
  location?: string;
  date: string;
  time: string;
  durationMinutes?: number;
}

/**
 * Google Calendar "create event" URL. Returns null for an unparseable slot so
 * the button can be disabled rather than opening an empty event form.
 */
export function buildGoogleCalendarUrl(event: CalendarLinkInput): string | null {
  const startMs = toUtcTimestamp(event.date, event.time);
  if (startMs === null) return null;
  const duration = Number.isFinite(Number(event.durationMinutes)) && Number(event.durationMinutes) > 0
    ? Number(event.durationMinutes)
    : 60;
  const endMs = startMs + duration * 60_000;

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${formatUtcZ(startMs)}/${formatUtcZ(endMs)}`,
  });
  if (String(event.description ?? '').trim()) {
    params.set('details', String(event.description ?? '').trim());
  }
  if (String(event.location ?? '').trim()) params.set('location', String(event.location ?? '').trim());
  params.set('trp', 'false');
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Google Maps turn-by-turn link.
 *
 * Coordinates win over the address string when present (exact pin, no geocode
 * guess). A literal 0,0 is treated as "unset" — that is what an empty map
 * widget saves, and routing a customer to the Gulf of Guinea is worse than
 * falling back to the address.
 */
export function buildDirectionsUrl(input: {
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
}): string | null {
  const lat = Number(input.latitude);
  const lng = Number(input.longitude);
  const hasCoordinates =
    Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
  if (hasCoordinates) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}`;
  }
  const address = String(input.address ?? '').trim();
  if (!address) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

// ---------------------------------------------------------------------------
// WhatsApp confirmation status
// ---------------------------------------------------------------------------

export type WhatsappConfirmationState = 'sent' | 'verified' | 'not_sent' | 'unavailable';

export interface WhatsappConfirmationStatus {
  state: WhatsappConfirmationState;
  /** Sanitised 10-digit number, or '' when there is none. */
  phone: string;
  /** e.g. "+91 98765 43210" */
  displayPhone: string;
  label: string;
  detail: string;
  tone: 'emerald' | 'amber' | 'slate';
  /** True while the customer still has an action to take. */
  actionPending: boolean;
}

/** Strip a phone number down to the 10-digit Indian subscriber number. */
export function sanitizeIndianPhone(raw: string): string {
  return String(raw ?? '')
    .replace(/\D/g, '')
    .replace(/^(91|0)/, '');
}

/** Format a 10-digit number the way Indian users read it: "+91 98765 43210". */
export function formatIndianPhone(digits10: string): string {
  const clean = sanitizeIndianPhone(digits10);
  if (clean.length !== 10) return clean ? `+91 ${clean}` : '';
  return `+91 ${clean.slice(0, 5)} ${clean.slice(5)}`;
}

/**
 * What the confirmation page can honestly claim about the WhatsApp message.
 *
 * The previous screen printed a hardcoded "WhatsApp verification sent to +91 …"
 * for every booking — including ones where the customer had closed the tab
 * before tapping anything. That conflated two different facts (the number was
 * OTP-verified / the confirmation was actually sent), so the line now reports
 * whichever of them is true.
 */
export function describeWhatsappConfirmation(input: {
  phone: string;
  otpVerified?: boolean;
  confirmationSent?: boolean;
}): WhatsappConfirmationStatus {
  const digits = sanitizeIndianPhone(input.phone);
  const valid = digits.length === 10;
  const displayPhone = formatIndianPhone(digits);

  if (!valid) {
    return {
      state: 'unavailable',
      phone: digits,
      displayPhone,
      label: 'WhatsApp confirmation unavailable',
      detail: 'No valid mobile number on this booking, so a WhatsApp confirmation could not be prepared.',
      tone: 'slate',
      actionPending: false,
    };
  }

  if (input.confirmationSent) {
    return {
      state: 'sent',
      phone: digits,
      displayPhone,
      label: 'WhatsApp confirmation sent',
      detail: `Your booking details were opened in WhatsApp for ${displayPhone}. Keep the reference handy at the salon.`,
      tone: 'emerald',
      actionPending: false,
    };
  }

  if (input.otpVerified) {
    return {
      state: 'verified',
      phone: digits,
      displayPhone,
      label: 'WhatsApp number verified',
      detail: `${displayPhone} is verified, but the confirmation has not been sent yet — tap the WhatsApp button below.`,
      tone: 'amber',
      actionPending: true,
    };
  }

  return {
    state: 'not_sent',
    phone: digits,
    displayPhone,
    label: 'WhatsApp confirmation not sent',
    detail: `Send your booking details to ${displayPhone} on WhatsApp so you have them offline.`,
    tone: 'slate',
    actionPending: true,
  };
}

/**
 * The prefilled WhatsApp message. Kept here (rather than inline in the
 * component) so the exact wording a customer forwards to the salon is covered
 * by tests and always carries the booking reference.
 */
export function buildWhatsappConfirmationMessage(input: {
  summary: BookingConfirmationSummary;
  customerName?: string | null;
  status: DisplayBookingStatus;
  advancePaid?: boolean;
  advanceAmount?: number;
  balanceAmount?: number;
  upgrades?: string[];
  bookingTypeLabel?: string;
}): string {
  const { summary } = input;
  const confirmed = summary ? describeBookingStatus(input.status).id === 'confirmed' : false;
  const submitted = describeBookingStatus(input.status).id !== 'not_submitted';

  const headline = !submitted
    ? `Please confirm this booking request with ${summary.salonName} — it is saved on this device only.`
    : confirmed
      ? `Your booking with ${summary.salonName} is confirmed.`
      : `Your booking request with ${summary.salonName} has been submitted and is awaiting confirmation.`;

  const lines = [
    `Namaste ${String(input.customerName ?? '').trim() || 'there'}! ${headline}`,
    '',
    `🔖 Booking ID: ${summary.bookingId}`,
    `🏬 Salon: ${summary.salonName}`,
    `💇 Service: ${summary.serviceName}${
      input.upgrades && input.upgrades.length ? ` + Add-ons (${input.upgrades.join(', ')})` : ''
    }`,
    `👤 Specialist: ${summary.staffName}`,
    `📅 Date: ${formatBookingDate(summary.date)}`,
    `⏰ Time: ${formatBookingTime(summary.time)} IST`,
    `🏠 Type: ${input.bookingTypeLabel ?? 'In-Salon'}`,
    `📍 ${summary.addressLabel}: ${summary.address}`,
    `💰 Total: ${formatMoney(summary.totalAmount, summary.currency)}`,
  ];

  if (input.advancePaid && Number(input.advanceAmount) > 0) {
    lines.push(
      `💳 Advance paid: ${formatMoney(Number(input.advanceAmount), summary.currency)}` +
        ` (Balance: ${formatMoney(Number(input.balanceAmount ?? 0), summary.currency)})`
    );
  } else {
    lines.push(`💳 Payment: Pay at ${summary.addressKind === 'home' ? 'home' : 'salon'}`);
  }

  lines.push('', submitted ? 'Thank you for booking with us!' : 'Please reply to confirm the slot with the salon.');
  return lines.join('\n');
}
