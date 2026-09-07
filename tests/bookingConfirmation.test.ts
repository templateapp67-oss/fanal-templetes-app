// ============================================================================
// Booking confirmation page helpers (src/lib/bookingConfirmation.ts).
//
// These functions produce artefacts the customer keeps: an .ics file, a Google
// Calendar link, a Google Maps link, and the WhatsApp message they forward to
// the salon. A malformed .ics opens as a corrupt or missing event in Google
// Calendar and Outlook, and nothing in the UI would reveal that until the
// customer misses their appointment — so the format details are pinned here.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SALON_UTC_OFFSET_MINUTES,
  buildConfirmationSummary,
  buildDirectionsUrl,
  buildGoogleCalendarUrl,
  buildIcsFile,
  buildIcsFilename,
  buildWhatsappConfirmationMessage,
  confirmationHeadline,
  describeWhatsappConfirmation,
  escapeIcsText,
  foldIcsLine,
  formatBookingDate,
  formatBookingDateTime,
  formatBookingTime,
  formatIndianNumber,
  formatIndianPhone,
  formatMoney,
  formatSalonAddress,
  formatUtcZ,
  resolveConfirmationStatus,
  sanitizeIndianPhone,
  toUtcTimestamp,
} from '../src/lib/bookingConfirmation';

// ---------------------------------------------------------------------------
// Money — Indian digit grouping
// ---------------------------------------------------------------------------

test('numbers use Indian digit grouping, not Western', () => {
  assert.equal(formatIndianNumber(0), '0');
  assert.equal(formatIndianNumber(999), '999');
  assert.equal(formatIndianNumber(1500), '1,500');
  assert.equal(formatIndianNumber(12000), '12,000');
  assert.equal(formatIndianNumber(125000), '1,25,000');
  assert.equal(formatIndianNumber(1250000), '12,50,000');
  assert.equal(formatIndianNumber(-1500), '-1,500');
});

test('formatMoney prefixes the salon currency', () => {
  assert.equal(formatMoney(1500), '₹1,500');
  assert.equal(formatMoney(1500, '$'), '$1,500');
});

test('formatMoney survives a non-numeric total instead of printing NaN', () => {
  assert.equal(formatMoney(NaN), '₹0');
  assert.equal(formatMoney(undefined as any), '₹0');
});

// ---------------------------------------------------------------------------
// Date / time formatting
// ---------------------------------------------------------------------------

test('dates render with the weekday, not as a raw ISO string', () => {
  // 2026-09-20 is a Sunday.
  assert.equal(formatBookingDate('2026-09-20'), 'Sun, 20 Sep 2026');
  assert.equal(formatBookingDate('2026-09-21'), 'Mon, 21 Sep 2026');
});

test('an unparseable date is passed through rather than crashing the page', () => {
  assert.equal(formatBookingDate('not-a-date'), 'not-a-date');
  assert.equal(formatBookingDate(''), '');
  assert.equal(formatBookingDate('2026-13-01'), '2026-13-01');
});

test('24h slots render as 12h with AM/PM', () => {
  assert.equal(formatBookingTime('11:30'), '11:30 AM');
  assert.equal(formatBookingTime('00:30'), '12:30 AM');
  assert.equal(formatBookingTime('12:00'), '12:00 PM');
  assert.equal(formatBookingTime('13:00'), '01:00 PM');
  assert.equal(formatBookingTime('20:00'), '08:00 PM');
});

test('an impossible time is passed through unchanged', () => {
  assert.equal(formatBookingTime('25:00'), '25:00');
  assert.equal(formatBookingTime('11:75'), '11:75');
});

test('the combined line carries the timezone the salon actually uses', () => {
  assert.equal(formatBookingDateTime('2026-09-20', '11:30'), 'Sun, 20 Sep 2026 · 11:30 AM IST');
});

// ---------------------------------------------------------------------------
// Address
// ---------------------------------------------------------------------------

test('the salon address is assembled from the profile fields in order', () => {
  const address = formatSalonAddress({
    shopFlatNo: 'Shop No. 12',
    areaLocality: 'Linking Road',
    address: 'Linking Road',
    landmark: 'Opposite Metro',
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400050',
  });
  assert.equal(
    address,
    'Shop No. 12, Linking Road, Opposite Metro, Mumbai, Maharashtra, 400050'
  );
});

test('duplicate address parts are dropped case-insensitively, first one wins', () => {
  // areaLocality precedes address in the assembled line, so it wins the tie.
  assert.equal(
    formatSalonAddress({ areaLocality: 'Linking Road', address: 'LINKING ROAD' }),
    'Linking Road'
  );
});

test('blank address parts are skipped entirely', () => {
  assert.equal(
    formatSalonAddress({
      address: 'Linking Road',
      city: '',
      state: null,
      postalCode: undefined,
      landmark: '   ',
    }),
    'Linking Road'
  );
  assert.equal(formatSalonAddress({}), '');
});

// ---------------------------------------------------------------------------
// Summary normalisation
// ---------------------------------------------------------------------------

test('buildConfirmationSummary fills every row so no label renders empty', () => {
  const summary = buildConfirmationSummary({});
  assert.equal(summary.bookingId, '—');
  assert.equal(summary.salonName, 'the salon');
  assert.equal(summary.serviceName, 'Selected service');
  assert.equal(summary.staffName, 'Any available specialist');
  assert.equal(summary.address, 'Address not set');
  assert.equal(summary.addressLabel, 'Salon Address');
  assert.equal(summary.currency, '₹');
  assert.equal(summary.durationMinutes, 60);
  assert.equal(summary.totalAmount, 0);
});

test('a home visit is labelled as the service address, not the salon', () => {
  const summary = buildConfirmationSummary({ address: 'Flat 4, Bandra', addressKind: 'home' });
  assert.equal(summary.addressKind, 'home');
  assert.equal(summary.addressLabel, 'Service Address');
});

test('a zero total is preserved but a NaN total is not', () => {
  assert.equal(buildConfirmationSummary({ totalAmount: 0 }).totalAmount, 0);
  assert.equal(buildConfirmationSummary({ totalAmount: NaN }).totalAmount, 0);
  assert.equal(buildConfirmationSummary({ totalAmount: 2400 }).totalAmount, 2400);
});

// ---------------------------------------------------------------------------
// Status resolution
// ---------------------------------------------------------------------------

test('the status shown comes from what the salon stored, not what we sent', () => {
  assert.equal(resolveConfirmationStatus({ savedToCloud: true, storedStatus: 'confirmed' }), 'confirmed');
  assert.equal(resolveConfirmationStatus({ savedToCloud: true, storedStatus: 'pending' }), 'pending');
  assert.equal(resolveConfirmationStatus({ savedToCloud: true, storedStatus: 'no_show' }), 'no_show');
});

test('a booking that never reached the salon is not_submitted, whatever it claims', () => {
  assert.equal(resolveConfirmationStatus({ savedToCloud: false, storedStatus: 'confirmed' }), 'not_submitted');
});

test('a missing or junk stored status falls back to pending', () => {
  assert.equal(resolveConfirmationStatus({ savedToCloud: true }), 'pending');
  assert.equal(resolveConfirmationStatus({ savedToCloud: true, storedStatus: 'teleported' }), 'pending');
  assert.equal(resolveConfirmationStatus({ savedToCloud: true, storedStatus: 'not_submitted' }), 'pending');
});

test('the confirmation headline follows the resolved status', () => {
  assert.equal(confirmationHeadline(resolveConfirmationStatus({ savedToCloud: true, storedStatus: 'confirmed' })),
    'Your booking is confirmed.');
  assert.equal(confirmationHeadline(resolveConfirmationStatus({ savedToCloud: true, storedStatus: 'pending' })),
    'Your booking is submitted.');
});

// ---------------------------------------------------------------------------
// Timezone conversion — the slot the customer booked must be the slot saved
// ---------------------------------------------------------------------------

test('the salon timezone is Asia/Kolkata (no daylight saving)', () => {
  assert.equal(SALON_UTC_OFFSET_MINUTES, 330);
});

test('a salon-local slot converts to the right UTC instant', () => {
  // 11:30 IST minus 5:30 is 06:00 UTC the same day.
  assert.equal(formatUtcZ(toUtcTimestamp('2026-09-20', '11:30')!), '20260920T060000Z');
});

test('an early-morning slot rolls back to the previous UTC day', () => {
  // 04:00 IST minus 5:30 is 22:30 UTC the day before.
  assert.equal(formatUtcZ(toUtcTimestamp('2026-09-20', '04:00')!), '20260919T223000Z');
});

test('a year boundary is handled', () => {
  assert.equal(formatUtcZ(toUtcTimestamp('2027-01-01', '02:00')!), '20261231T203000Z');
});

test('impossible dates are rejected instead of silently rolling over', () => {
  assert.equal(toUtcTimestamp('2026-02-31', '11:30'), null);
  assert.equal(toUtcTimestamp('2026-13-01', '11:30'), null);
  assert.equal(toUtcTimestamp('2026-09-20', '25:00'), null);
  assert.equal(toUtcTimestamp('garbage', '11:30'), null);
  assert.equal(toUtcTimestamp('2026-09-20', 'garbage'), null);
});

// ---------------------------------------------------------------------------
// iCalendar
// ---------------------------------------------------------------------------

test('iCalendar TEXT escaping covers backslash, semicolon, comma and newlines', () => {
  assert.equal(escapeIcsText('a\\b'), 'a\\\\b');
  assert.equal(escapeIcsText('Cut; Blow dry'), 'Cut\\; Blow dry');
  assert.equal(escapeIcsText('Cut, Style'), 'Cut\\, Style');
  assert.equal(escapeIcsText('line1\nline2'), 'line1\\nline2');
  assert.equal(escapeIcsText('line1\r\nline2'), 'line1\\nline2');
});

test('long lines fold at octet boundaries with a leading space', () => {
  const long = `SUMMARY:${'x'.repeat(200)}`;
  const folded = foldIcsLine(long);
  const segments = folded.split('\r\n');
  assert.ok(segments.length > 1);
  for (const segment of segments) {
    assert.ok(new TextEncoder().encode(segment).length <= 75, `segment too long: ${segment.length}`);
  }
  for (const segment of segments.slice(1)) {
    assert.ok(segment.startsWith(' '), 'continuation lines must start with a space');
  }
  // Unfolding must reproduce the original line exactly.
  assert.equal(segments.map((s, i) => (i === 0 ? s : s.slice(1))).join(''), long);
});

test('multi-byte characters are never split by folding', () => {
  const long = `SUMMARY:${'₹'.repeat(120)}`;
  const folded = foldIcsLine(long);
  for (const segment of folded.split('\r\n')) {
    assert.ok(new TextEncoder().encode(segment).length <= 75);
  }
  assert.equal(
    folded.split('\r\n').map((s, i) => (i === 0 ? s : s.slice(1))).join(''),
    long
  );
});

const ICS_INPUT = {
  uid: 'NX-BLR-12345@fanal.booking',
  title: 'Hair Spa — Luxe Salon',
  description: 'Booking ID: NX-BLR-12345\nSalon: Luxe Salon',
  location: 'Luxe Salon, Linking Road, Mumbai',
  date: '2026-09-20',
  time: '11:30',
  durationMinutes: 90,
  nowIso: '2026-09-07T09:00:00.000Z',
  alarmMinutesBefore: 120,
};

test('the .ics file has the structure a calendar app requires', () => {
  const ics = buildIcsFile(ICS_INPUT);
  assert.ok(ics);
  const lines = ics!.split('\r\n');

  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.ok(lines.includes('VERSION:2.0'));
  assert.ok(lines.includes('BEGIN:VEVENT'));
  assert.ok(lines.includes('END:VEVENT'));
  assert.equal(lines[lines.length - 2], 'END:VCALENDAR');
  assert.equal(lines[lines.length - 1], '', 'the file must end with a CRLF');
});

test('the .ics file uses CRLF line endings throughout', () => {
  const ics = buildIcsFile(ICS_INPUT)!;
  const bareLf = ics.replace(/\r\n/g, '').includes('\n');
  assert.equal(bareLf, false, 'a bare LF breaks Outlook and some mobile clients');
});

test('the .ics event carries the slot in UTC and the right duration', () => {
  const ics = buildIcsFile(ICS_INPUT)!;
  assert.ok(ics.includes('DTSTART:20260920T060000Z'));
  // 11:30 IST + 90 minutes = 13:00 IST = 07:30 UTC.
  assert.ok(ics.includes('DTEND:20260920T073000Z'));
  assert.ok(ics.includes('DTSTAMP:20260907T090000Z'));
  assert.ok(ics.includes('UID:NX-BLR-12345@fanal.booking'));
  assert.ok(ics.includes('TRIGGER:-PT120M'));
});

test('commas and newlines in the summary and description are escaped', () => {
  const ics = buildIcsFile({
    ...ICS_INPUT,
    title: 'Cut, Blow dry & Style',
    description: 'Bring your reference\nBooking ID: NX-1',
  })!;
  assert.ok(ics.includes('SUMMARY:Cut\\, Blow dry & Style'));
  assert.ok(ics.includes('DESCRIPTION:Bring your reference\\nBooking ID: NX-1'));
});

test('every line of the generated file is within the 75-octet limit', () => {
  const ics = buildIcsFile({
    ...ICS_INPUT,
    location: `Luxe Salon, ${'a very long street name '.repeat(12)}Mumbai, Maharashtra 400050`,
    description: 'x'.repeat(400),
  })!;
  for (const line of ics.split('\r\n')) {
    assert.ok(
      new TextEncoder().encode(line).length <= 75,
      `line exceeds 75 octets: ${line.slice(0, 40)}…`
    );
  }
});

test('a confirmed booking is CONFIRMED in iCalendar terms, a pending one TENTATIVE', () => {
  assert.ok(buildIcsFile({ ...ICS_INPUT, status: 'CONFIRMED' })!.includes('STATUS:CONFIRMED'));
  assert.ok(buildIcsFile({ ...ICS_INPUT, status: 'TENTATIVE' })!.includes('STATUS:TENTATIVE'));
});

test('an unparseable slot yields no file rather than a corrupt one', () => {
  assert.equal(buildIcsFile({ ...ICS_INPUT, date: '2026-02-31' }), null);
  assert.equal(buildIcsFile({ ...ICS_INPUT, time: 'nope' }), null);
});

test('the .ics filename is safe for every filesystem', () => {
  assert.equal(buildIcsFilename('NX-BLR-12345'), 'booking-NX-BLR-12345.ics');
  assert.equal(buildIcsFilename('../../etc/passwd'), 'booking-etc-passwd.ics');
  assert.equal(buildIcsFilename(''), 'booking.ics');
});

// ---------------------------------------------------------------------------
// Google Calendar link
// ---------------------------------------------------------------------------

test('the Google Calendar link carries the slot, title, location and details', () => {
  const url = buildGoogleCalendarUrl({
    title: 'Hair Spa — Luxe Salon',
    description: 'Booking ID: NX-BLR-12345',
    location: 'Luxe Salon, Mumbai',
    date: '2026-09-20',
    time: '11:30',
    durationMinutes: 90,
  });
  assert.ok(url);
  const parsed = new URL(url!);
  assert.equal(parsed.origin + parsed.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(parsed.searchParams.get('action'), 'TEMPLATE');
  assert.equal(parsed.searchParams.get('dates'), '20260920T060000Z/20260920T073000Z');
  assert.equal(parsed.searchParams.get('text'), 'Hair Spa — Luxe Salon');
  assert.equal(parsed.searchParams.get('location'), 'Luxe Salon, Mumbai');
  assert.equal(parsed.searchParams.get('details'), 'Booking ID: NX-BLR-12345');
});

test('an unparseable slot produces no calendar link', () => {
  assert.equal(buildGoogleCalendarUrl({ title: 'x', date: '2026-02-31', time: '11:30' }), null);
});

// ---------------------------------------------------------------------------
// Directions
// ---------------------------------------------------------------------------

test('directions use the exact pin when the salon has coordinates', () => {
  const url = buildDirectionsUrl({ latitude: 19.076, longitude: 72.8777, address: 'Luxe Salon, Mumbai' });
  assert.equal(url, 'https://www.google.com/maps/dir/?api=1&destination=19.076%2C72.8777');
});

test('directions fall back to the address when there are no coordinates', () => {
  const url = buildDirectionsUrl({ address: 'Luxe Salon, Linking Road, Mumbai' });
  assert.ok(url!.startsWith('https://www.google.com/maps/dir/?api=1&destination='));
  assert.equal(
    decodeURIComponent(url!.split('destination=')[1]),
    'Luxe Salon, Linking Road, Mumbai'
  );
});

test('a 0,0 pin from an unset map widget falls back to the address, not the ocean', () => {
  // Routing a customer to the Gulf of Guinea is worse than using the address.
  const url = buildDirectionsUrl({ latitude: 0, longitude: 0, address: 'Luxe Salon, Mumbai' });
  assert.equal(decodeURIComponent(url!.split('destination=')[1]), 'Luxe Salon, Mumbai');
});

test('directions are unavailable rather than blank when nothing is known', () => {
  assert.equal(buildDirectionsUrl({}), null);
  assert.equal(buildDirectionsUrl({ address: '   ' }), null);
  assert.equal(buildDirectionsUrl({ latitude: NaN, longitude: NaN, address: '' }), null);
});

// ---------------------------------------------------------------------------
// WhatsApp confirmation status
// ---------------------------------------------------------------------------

test('phones are sanitised to the 10-digit subscriber number', () => {
  assert.equal(sanitizeIndianPhone('+91 98765 43210'), '9876543210');
  assert.equal(sanitizeIndianPhone('09876543210'), '9876543210');
  assert.equal(sanitizeIndianPhone('919876543210'), '9876543210');
  assert.equal(formatIndianPhone('9876543210'), '+91 98765 43210');
});

test('a sent confirmation is reported as sent', () => {
  const status = describeWhatsappConfirmation({
    phone: '9876543210',
    otpVerified: true,
    confirmationSent: true,
  });
  assert.equal(status.state, 'sent');
  assert.equal(status.label, 'WhatsApp confirmation sent');
  assert.equal(status.tone, 'emerald');
  assert.equal(status.actionPending, false);
});

test('a verified-but-unsent confirmation asks the customer to send it', () => {
  const status = describeWhatsappConfirmation({ phone: '9876543210', otpVerified: true });
  assert.equal(status.state, 'verified');
  assert.equal(status.label, 'WhatsApp number verified');
  assert.equal(status.actionPending, true);
  assert.ok(status.detail.includes('has not been sent yet'));
});

test('the page never claims a WhatsApp confirmation that was not sent', () => {
  // The defect this replaces: an unconditional "WhatsApp verification sent to
  // +91 …" printed even when the customer had sent nothing.
  const status = describeWhatsappConfirmation({ phone: '9876543210' });
  assert.equal(status.state, 'not_sent');
  assert.equal(status.label, 'WhatsApp confirmation not sent');
  assert.ok(!status.label.toLowerCase().includes('sent to'));
});

test('an invalid number is reported as unavailable', () => {
  const status = describeWhatsappConfirmation({ phone: '123' });
  assert.equal(status.state, 'unavailable');
  assert.equal(status.actionPending, false);
});

// ---------------------------------------------------------------------------
// WhatsApp message body
// ---------------------------------------------------------------------------

const SUMMARY = buildConfirmationSummary({
  bookingId: 'NX-BLR-12345',
  salonName: 'Luxe Salon',
  serviceName: 'Hair Spa',
  staffName: 'Ananya',
  date: '2026-09-20',
  time: '11:30',
  address: 'Linking Road, Mumbai 400050',
  totalAmount: 2400,
  currency: '₹',
  durationMinutes: 90,
});

test('the WhatsApp message carries the booking id, address and total', () => {
  const message = buildWhatsappConfirmationMessage({
    summary: SUMMARY,
    customerName: 'Riya',
    status: 'confirmed',
    advancePaid: true,
    advanceAmount: 600,
    balanceAmount: 1800,
  });
  assert.ok(message.includes('Booking ID: NX-BLR-12345'));
  assert.ok(message.includes('Salon: Luxe Salon'));
  assert.ok(message.includes('Specialist: Ananya'));
  assert.ok(message.includes('Sun, 20 Sep 2026'));
  assert.ok(message.includes('11:30 AM IST'));
  assert.ok(message.includes('Salon Address: Linking Road, Mumbai 400050'));
  assert.ok(message.includes('Total: ₹2,400'));
  assert.ok(message.includes('Advance paid: ₹600'));
  assert.ok(message.includes('Balance: ₹1,800'));
});

test('a confirmed booking is announced as confirmed in the WhatsApp message', () => {
  const message = buildWhatsappConfirmationMessage({ summary: SUMMARY, status: 'confirmed' });
  assert.ok(message.includes('is confirmed.'));
});

test('a pending booking is announced as awaiting confirmation, not confirmed', () => {
  const message = buildWhatsappConfirmationMessage({ summary: SUMMARY, status: 'pending' });
  assert.ok(message.includes('awaiting confirmation'));
  assert.ok(!message.includes('is confirmed.'));
});

test('an unsubmitted booking tells the customer to confirm it manually', () => {
  const message = buildWhatsappConfirmationMessage({ summary: SUMMARY, status: 'not_submitted' });
  assert.ok(message.includes('saved on this device only'));
  assert.ok(message.includes('Please reply to confirm the slot with the salon.'));
});
