// ============================================================================
// Booking detail page — routing and rendering.
//
// The routing test that matters: the list lives at `/customer/bookings` and the
// detail page at `/customer/booking/:bookingId`, which differ by one letter. A
// prefix match would read the list page as a detail page for a booking called
// "s" and try to load it.
//
// The rendering tests cover the two conditional buttons in the spec (Cancel if
// upcoming, Review if completed) by rendering the action bar directly — inside
// the page they sit behind a fetch, which a server render never runs.
// ============================================================================

import assert from 'node:assert/strict';
import React from 'react';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  bookingDetailPath,
  matchBookingDetailPath,
  normalizePath,
} from '../src/lib/router';
import { resolveBookingDetailActions, toBookingDetailView } from '../src/lib/bookingDetail';
import {
  BookingDetailActionBar,
  BookingDetailPage,
  BookingDetailSummary,
} from '../src/components/BookingDetailPage';
import { BookingCard } from '../src/components/BookingCard';
import { toCustomerBookingCard } from '../src/lib/bookingTabs';

const BEFORE_SLOT = Date.UTC(2026, 8, 19, 12, 0, 0);
const AFTER_SLOT = Date.UTC(2026, 8, 21, 12, 0, 0);
const BOOKING_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const SALON = {
  name: 'Luxe Salon',
  address: 'Linking Road, Bandra West, Mumbai',
  phone: '+91 98765 43210',
  whatsapp: '+91 98765 43210',
  latitude: 19.1197,
  longitude: 72.8464,
  currency: '₹',
};

const TERMS = {
  programEnabled: true,
  pointsPerVisit: 50,
  pointsPerHundredSpent: 10,
  tierMultiplier: 1,
  tier: 'bronze',
};

function row(overrides: Record<string, any> = {}) {
  return {
    id: BOOKING_ID,
    status: 'confirmed',
    service_name: 'Hair Spa',
    booking_date: '2026-09-20',
    time_slot: '11:30',
    total_amount: 2400,
    advance_paid_amount: 600,
    payment_status: 'paid_deposit',
    payment_id: 'NX-BLR-12345',
    notes: 'Sensitive scalp, please use the mild shampoo',
    metadata: {
      stylist_name: 'Ananya',
      salon_name: 'Luxe Salon',
      service_addons: [{ name: 'Head Massage', price: 300 }],
    },
    ...overrides,
  };
}

function view(overrides: Record<string, any> = {}, salon: any = SALON) {
  return toBookingDetailView({ row: row(overrides), salon, loyalty: TERMS });
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

test('the booking id is read out of /customer/booking/:bookingId', () => {
  assert.equal(matchBookingDetailPath('/customer/booking/abc-123'), 'abc-123');
  assert.equal(matchBookingDetailPath(`/customer/booking/${BOOKING_ID}`), BOOKING_ID);
  assert.equal(matchBookingDetailPath('/customer/booking/abc-123/'), 'abc-123');
  assert.equal(matchBookingDetailPath('/CUSTOMER/BOOKING/abc-123'), 'abc-123');
});

test('the bookings list is not mistaken for a booking detail page', () => {
  // `/customer/bookings` starts with `/customer/booking`, so a prefix match
  // would return a booking id of "s".
  assert.equal(matchBookingDetailPath('/customer/bookings'), null);
  assert.equal(matchBookingDetailPath('/customer/bookings/'), null);
  assert.equal(matchBookingDetailPath('/customer/bookings?tab=completed'), null);
  assert.equal(matchBookingDetailPath('/customer/bookings/mine'), null);
});

test('paths that are not a booking detail page do not match', () => {
  assert.equal(matchBookingDetailPath('/'), null);
  assert.equal(matchBookingDetailPath('/customer'), null);
  assert.equal(matchBookingDetailPath('/customer/booking'), null);
  assert.equal(matchBookingDetailPath('/customer/booking/'), null);
  assert.equal(matchBookingDetailPath('/customer/booking/a/b'), null);
  assert.equal(matchBookingDetailPath('/owner/booking/abc'), null);
  assert.equal(matchBookingDetailPath(''), null);
});

test('an encoded booking id round-trips', () => {
  const id = 'a b/c?d';
  const url = bookingDetailPath(id);
  assert.equal(url, '/customer/booking/a%20b%2Fc%3Fd');
  assert.equal(matchBookingDetailPath(url), id);
});

test('the detail path is built from the id', () => {
  assert.equal(bookingDetailPath(BOOKING_ID), `/customer/booking/${BOOKING_ID}`);
  assert.equal(normalizePath(bookingDetailPath(BOOKING_ID)), `/customer/booking/${BOOKING_ID}`);
});

// ---------------------------------------------------------------------------
// The details grid
// ---------------------------------------------------------------------------

function renderSummary(overrides: Record<string, any> = {}, salon: any = SALON): string {
  return renderToStaticMarkup(
    React.createElement(BookingDetailSummary, { view: view(overrides, salon) } as any)
  );
}

test('the page shows every field the spec asks for', () => {
  const html = renderSummary();
  assert.ok(html.includes('Hair Spa'), 'service');
  assert.ok(html.includes('Ananya'), 'staff');
  assert.ok(html.includes('20 Sep 2026'), 'date');
  assert.ok(html.includes('11:30 AM'), 'time');
  assert.ok(html.includes('₹2,400'), 'price');
  assert.ok(html.includes('Advance paid'), 'payment status');
  assert.ok(html.includes('Sensitive scalp'), 'customer note');
  assert.ok(html.includes('points'), 'reward');
});

test('add-ons are listed alongside the primary service', () => {
  const html = renderSummary();
  assert.ok(html.includes('Hair Spa'));
  assert.ok(html.includes('Head Massage'));
});

test('the advance and the balance due are both shown', () => {
  const html = renderSummary();
  assert.ok(html.includes('₹600'));
  assert.ok(html.includes('₹1,800'));
  assert.ok(html.includes('Balance'));
});

test('a booking with no advance says the whole amount is due at the salon', () => {
  const html = renderSummary({ advance_paid_amount: 0, payment_status: 'pending' });
  assert.ok(html.includes('No advance paid'));
  assert.ok(html.includes('₹2,400 due at the salon'));
  assert.ok(html.includes('Not paid yet'));
});

test('a booking with no note says so instead of showing a blank row', () => {
  assert.ok(renderSummary({ notes: '' }).includes('No note was left.'));
  assert.ok(renderSummary({ notes: null }).includes('No note was left.'));
  assert.ok(!renderSummary().includes('No note was left.'), 'a real note replaces the placeholder');
});

test('a completed booking reports the points already earned', () => {
  assert.ok(renderSummary({ status: 'completed' }).includes('290 points earned'));
});

test('an upcoming booking promises points without claiming they are in the account', () => {
  const html = renderSummary({ status: 'confirmed' });
  assert.ok(html.includes('290 points on completion'));
  assert.ok(html.includes('once the salon marks your visit complete'));
});

test('a salon with no loyalty programme is not shown a points number', () => {
  const html = renderToStaticMarkup(
    React.createElement(BookingDetailSummary, {
      view: toBookingDetailView({
        row: row({ status: 'completed' }),
        salon: SALON,
        loyalty: { programEnabled: false },
      }),
    } as any)
  );
  assert.ok(html.includes('No rewards at this salon'));
  assert.ok(!html.includes('290 points'));
});

test('an unassigned staff member is not rendered as a blank row', () => {
  assert.ok(
    renderSummary({ metadata: { salon_name: 'Luxe Salon' } }).includes('Assigned by the salon')
  );
});

// ---------------------------------------------------------------------------
// The action bar: Cancel if upcoming, Review if completed
// ---------------------------------------------------------------------------

function renderActions(overrides: Record<string, any> = {}, nowMs = BEFORE_SLOT, salon: any = SALON) {
  const v = view(overrides, salon);
  return renderToStaticMarkup(
    React.createElement(BookingDetailActionBar, {
      view: v,
      actions: resolveBookingDetailActions(v, nowMs),
      onCancel: () => {},
      onStartReview: () => {},
    } as any)
  );
}

test('an upcoming booking offers Cancel and not Review', () => {
  const html = renderActions();
  assert.ok(html.includes('Cancel booking'));
  assert.ok(!html.includes('Write a review'));
});

test('a completed booking offers Review and not Cancel', () => {
  const html = renderActions({ status: 'completed' }, AFTER_SLOT);
  assert.ok(html.includes('Write a review'));
  assert.ok(!html.includes('Cancel booking'));
});

test('a cancelled booking offers neither', () => {
  const html = renderActions({ status: 'cancelled' });
  assert.ok(!html.includes('Cancel booking'));
  assert.ok(!html.includes('Write a review'));
});

test('a no-show booking offers neither', () => {
  const html = renderActions({ status: 'no_show' }, AFTER_SLOT);
  assert.ok(!html.includes('Cancel booking'));
  assert.ok(!html.includes('Write a review'));
});

test('a booking whose slot has passed can no longer be cancelled, and says why', () => {
  const html = renderActions({}, AFTER_SLOT);
  assert.ok(!html.includes('Cancel booking'));
  assert.ok(html.length > 0);
});

test('a visited salon already reviewed thanks the customer instead of asking again', () => {
  const html = renderActions(
    { status: 'completed', metadata: { review_rating: 4, salon_name: 'Luxe Salon' } },
    AFTER_SLOT
  );
  assert.ok(html.includes('You rated this visit 4 out of 5'));
  assert.ok(!html.includes('Write a review'));
});

test('Direction and Contact salon link out when the salon has published them', () => {
  const html = renderActions();
  assert.ok(html.includes('Direction'));
  assert.ok(html.includes('Contact salon'));
  assert.ok(html.includes('google.com/maps/dir'));
  assert.ok(html.includes('wa.me/919876543210'));
});

test('Direction is disabled rather than hidden when there is no location', () => {
  const html = renderActions({}, BEFORE_SLOT, { name: 'Luxe Salon' });
  assert.ok(html.includes('Direction'));
  assert.ok(html.includes('disabled'));
  assert.ok(!html.includes('google.com/maps/dir'));
});

test('an action error is shown above the buttons', () => {
  const v = view();
  const html = renderToStaticMarkup(
    React.createElement(BookingDetailActionBar, {
      view: v,
      actions: resolveBookingDetailActions(v, BEFORE_SLOT),
      actionError: 'This booking is already cancelled.',
    } as any)
  );
  assert.ok(html.includes('This booking is already cancelled.'));
});

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

test('a signed-out visitor is asked to sign in rather than shown an empty page', () => {
  const html = renderToStaticMarkup(
    React.createElement(BookingDetailPage, {
      bookingId: BOOKING_ID,
      user: null,
      onBack: () => {},
    } as any)
  );
  assert.ok(html.includes('Sign in to view this booking'));
  assert.ok(html.includes('Back to My Bookings'));
  assert.ok(!html.includes('Loading your booking'));
});

test('a signed-in visitor sees a loading state, not an error', () => {
  const html = renderToStaticMarkup(
    React.createElement(BookingDetailPage, {
      bookingId: BOOKING_ID,
      user: { id: 'customer-1', email: 'a@b.c' },
      onBack: () => {},
    } as any)
  );
  assert.ok(html.includes('Loading your booking'));
});

// ---------------------------------------------------------------------------
// The card links to the detail page
// ---------------------------------------------------------------------------

function renderCard(overrides: Record<string, any> = {}, props: Record<string, any> = {}) {
  return renderToStaticMarkup(
    React.createElement(BookingCard, {
      card: toCustomerBookingCard(row(overrides), BEFORE_SLOT),
      nowMs: BEFORE_SLOT,
      onCancel: async () => true,
      onRebook: () => {},
      onSubmitReview: async () => true,
      ...props,
    } as any)
  );
}

test('the card keeps its View details affordance when given a detail handler', () => {
  const html = renderCard({}, { onViewDetails: () => {} });
  assert.ok(html.includes('View details'));
  assert.ok(html.includes('Rebook'));
});

test('the card still works standalone with no detail handler', () => {
  const html = renderCard();
  assert.ok(html.includes('View details'));
  assert.ok(html.includes('aria-expanded="false"'), 'expands inline when there is no page to go to');
});
