// ============================================================================
// Booking confirmation page — rendered output (src/components/BookingConfirmation.tsx).
//
// The helper functions are covered in bookingConfirmation.test.ts; this file
// renders the actual component with react-dom/server (already a dependency, no
// test DOM needed) and asserts the customer can read every fact they need:
// booking id, salon, service, staff, date, time, address, total, the WhatsApp
// status, and working calendar / directions / rebook controls.
//
// Rendering the real component is what catches the failure a pure-function test
// cannot: a row that exists in the summary but was never wired into the JSX.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BookingConfirmation } from '../src/components/BookingConfirmation';
import {
  buildConfirmationSummary,
  describeWhatsappConfirmation,
} from '../src/lib/bookingConfirmation';

function render(overrides: Record<string, any> = {}): string {
  const summary = buildConfirmationSummary({
    bookingId: 'NX-BLR-12345',
    salonName: 'Luxe Salon',
    serviceName: 'Hair Spa Ritual',
    staffName: 'Ananya',
    date: '2026-09-20',
    time: '11:30',
    address: 'Shop 12, Linking Road, Mumbai 400050',
    totalAmount: 2400,
    currency: '₹',
    durationMinutes: 90,
    latitude: 19.076,
    longitude: 72.8777,
  });

  return renderToStaticMarkup(
    React.createElement(BookingConfirmation, {
      summary,
      status: 'confirmed',
      customerName: 'Riya',
      salonPhone: '9876543210',
      payment: { advancePaid: true, advanceAmount: 600, balanceAmount: 1800, receiptId: 'pay_123' },
      upgrades: ['Head Massage'],
      whatsapp: describeWhatsappConfirmation({ phone: '9876543210', otpVerified: true, confirmationSent: true }),
      onSendWhatsapp: () => {},
      onBookAnother: () => {},
      onClose: () => {},
      ...overrides,
    } as any)
  );
}

/** Headline text only, without the markup around it. */
function headlineOf(html: string): string {
  const match = /data-testid="booking-confirmation-headline"[^>]*>([^<]*)</.exec(html);
  return match ? match[1] : '';
}

// ---------------------------------------------------------------------------
// Every field the customer must be able to read
// ---------------------------------------------------------------------------

test('a confirmed booking states plainly that it is confirmed', () => {
  assert.equal(headlineOf(render()), 'Your booking is confirmed.');
});

test('the page shows the booking id, salon, service, staff, date, time, address and total', () => {
  const html = render();
  for (const expected of [
    'Booking ID',
    'NX-BLR-12345',
    'Luxe Salon',
    'Hair Spa Ritual',
    'Ananya',
    'Sun, 20 Sep 2026',
    '11:30 AM IST',
    'Salon Address',
    'Shop 12, Linking Road, Mumbai 400050',
    'Total Price',
    '₹2,400',
  ]) {
    assert.ok(html.includes(expected), `confirmation page is missing "${expected}"`);
  }
});

test('the address row is present — it was absent from the old confirmation card', () => {
  const html = render();
  assert.ok(html.includes('Shop 12, Linking Road, Mumbai 400050'));
  // A home visit must not be labelled as the salon's address.
  const home = render({
    summary: buildConfirmationSummary({
      bookingId: 'NX-1',
      address: 'Flat 4, Bandra West',
      addressKind: 'home',
      date: '2026-09-20',
      time: '11:30',
    }),
  });
  assert.ok(home.includes('Service Address'));
  assert.ok(home.includes('Flat 4, Bandra West'));
});

test('the total is shown in Indian digit grouping with the salon currency', () => {
  assert.ok(
    render({
      summary: buildConfirmationSummary({ totalAmount: 125000, currency: '₹', date: '2026-09-20', time: '11:30' }),
    }).includes('₹1,25,000')
  );
});

test('add-ons are listed under the service', () => {
  assert.ok(render().includes('Head Massage'));
});

// ---------------------------------------------------------------------------
// Headline follows the real status
// ---------------------------------------------------------------------------

test('a pending booking says "submitted" and never claims confirmation', () => {
  const html = render({ status: 'pending' });
  assert.equal(headlineOf(html), 'Your booking is submitted.');
  assert.ok(!html.includes('Your booking is confirmed.'));
  assert.ok(html.includes('data-booking-status="pending"'));
});

test('every lifecycle state renders its own badge', () => {
  for (const status of ['pending', 'confirmed', 'completed', 'cancelled', 'no_show']) {
    assert.ok(
      render({ status }).includes(`data-booking-status="${status}"`),
      `no badge rendered for ${status}`
    );
  }
});

test('a booking that never reached the salon warns instead of looking confirmed', () => {
  const html = render({ status: 'not_submitted' });
  assert.equal(headlineOf(html), 'Your booking is saved on this device.');
  assert.ok(html.includes('saved on this device only'));
  // The reason is stated, and the customer is given a number to call instead of
  // being left with a dead end.
  assert.ok(html.includes('booking service'));
  assert.ok(html.includes('9876543210'));
});

// ---------------------------------------------------------------------------
// WhatsApp confirmation status
// ---------------------------------------------------------------------------

test('the WhatsApp row reports what actually happened', () => {
  assert.ok(render().includes('WhatsApp confirmation sent'));

  const unsent = render({
    whatsapp: describeWhatsappConfirmation({ phone: '9876543210' }),
  });
  assert.ok(unsent.includes('WhatsApp confirmation not sent'));
  // The old screen printed "WhatsApp verification sent" unconditionally.
  assert.ok(!unsent.includes('WhatsApp confirmation sent<'));
});

test('the WhatsApp button label matches whether it was already sent', () => {
  assert.ok(render().includes('Resend on WhatsApp'));
  assert.ok(
    render({ whatsapp: describeWhatsappConfirmation({ phone: '9876543210' }) }).includes(
      'Send on WhatsApp'
    )
  );
});

// ---------------------------------------------------------------------------
// Add to calendar
// ---------------------------------------------------------------------------

test('the Add to Calendar control is present and enabled for a valid slot', () => {
  const html = render();
  assert.ok(html.includes('Add to Calendar'));
  assert.ok(!html.includes('disabled=""'), 'the calendar button should not be disabled');
});

test('the Google Calendar link carries the booked slot in UTC', () => {
  const html = render();
  assert.ok(html.includes('calendar.google.com/calendar/render'));
  // 11:30 IST -> 06:00 UTC; +90 minutes -> 07:30 UTC. (HTML escapes & as &amp;)
  assert.ok(html.includes('20260920T060000Z%2F20260920T073000Z'));
});

test('an unparseable slot disables the calendar controls instead of linking nowhere', () => {
  const html = render({
    summary: buildConfirmationSummary({
      bookingId: 'NX-1',
      date: '2026-02-31',
      time: '11:30',
      address: 'Mumbai',
    }),
  });
  assert.ok(html.includes('disabled=""'), 'the download button should be disabled');
  assert.ok(html.includes('This slot could not be added to a calendar'));
});

// ---------------------------------------------------------------------------
// Directions
// ---------------------------------------------------------------------------

test('the directions button routes to the salon pin', () => {
  const html = render();
  assert.ok(html.includes('Get Directions'));
  assert.ok(html.includes('google.com/maps/dir/?api=1'));
  assert.ok(html.includes('19.076%2C72.8777'));
});

test('directions fall back to the address when the salon has no pin', () => {
  const html = render({
    summary: buildConfirmationSummary({
      bookingId: 'NX-1',
      date: '2026-09-20',
      time: '11:30',
      address: 'Linking Road, Mumbai',
    }),
  });
  assert.ok(html.includes('Get Directions'));
  assert.ok(html.includes('Linking+Road%2C+Mumbai'));
});

// ---------------------------------------------------------------------------
// Rebook CTA — only from history
// ---------------------------------------------------------------------------

test('the rebook CTA appears only when the customer came from history', () => {
  assert.ok(!render().includes('Book this service again'));
  assert.ok(render({ fromHistory: true, onRebook: () => {} }).includes('Book this service again'));
});

test('from history the rebook CTA replaces the generic "Book Another Service"', () => {
  // Two near-identical primary buttons invite the wrong tap.
  const html = render({ fromHistory: true, onRebook: () => {} });
  assert.ok(html.includes('Book this service again'));
  assert.ok(!html.includes('Book Another Service'));
});

test('from history without a rebook handler the generic CTA stays', () => {
  const html = render({ fromHistory: true });
  assert.ok(html.includes('Book Another Service'));
  assert.ok(!html.includes('Book this service again'));
});
