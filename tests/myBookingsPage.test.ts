// ============================================================================
// "My Bookings" UI — rendered output.
//
// bookingTabs.test.ts covers the rules; this renders the actual components with
// react-dom/server (already a dependency) and asserts the customer can read and
// reach everything the page promises: the card fields, the status badge, and
// which actions are offered for which state.
//
// The action-visibility assertions matter more than they look: a Cancel button
// on a completed visit, or a Review button on a cancelled one, is a control the
// API will reject — the page would be offering something that cannot work.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BookingCard, BookingDetailsPanel } from '../src/components/BookingCard';
import {
  MY_BOOKINGS_EMPTY_BODY,
  MY_BOOKINGS_EMPTY_TITLE,
  MY_BOOKINGS_EXPLORE_CTA,
  MyBookingsEmptyState,
  MyBookingsPage,
  tabFromQueryParam,
} from '../src/components/MyBookingsPage';
import { toCustomerBookingCard } from '../src/lib/bookingTabs';
import { isMyBookingsPath, normalizePath, MY_BOOKINGS_PATH } from '../src/lib/router';

const BEFORE_SLOT = Date.UTC(2026, 8, 19, 12, 0, 0);
const AFTER_SLOT = Date.UTC(2026, 8, 21, 12, 0, 0);

function card(row: Record<string, any> = {}, nowMs: number = BEFORE_SLOT) {
  return toCustomerBookingCard(
    {
      id: 'b-1',
      service_name: 'Hair Spa Ritual',
      booking_date: '2026-09-20',
      time_slot: '11:30',
      status: 'confirmed',
      total_amount: 2400,
      advance_paid_amount: 600,
      payment_id: 'NX-BLR-12345',
      metadata: { stylist_name: 'Ananya' },
      salon: { name: 'Luxe Salon', imageUrl: 'https://img/salon.png', city: 'Mumbai', currency: '₹' },
      ...row,
    },
    nowMs
  );
}

function renderCard(row: Record<string, any> = {}, nowMs: number = BEFORE_SLOT): string {
  return renderToStaticMarkup(
    React.createElement(BookingCard, {
      card: card(row, nowMs),
      nowMs,
      onCancel: async () => true,
      onRebook: () => {},
      onSubmitReview: async () => true,
    } as any)
  );
}

/**
 * The details panel is collapsed by default, so a server render of the card
 * never includes it — render it directly to cover its contents.
 */
function renderDetails(row: Record<string, any> = {}, nowMs: number = BEFORE_SLOT): string {
  return renderToStaticMarkup(
    React.createElement(BookingDetailsPanel, { card: card(row, nowMs) } as any)
  );
}

// ---------------------------------------------------------------------------
// Card contents
// ---------------------------------------------------------------------------

test('the card shows every field the page promises', () => {
  const html = renderCard();
  for (const expected of [
    'Luxe Salon', // salon name
    'Hair Spa Ritual', // service
    'Ananya', // staff
    'Sun, 20 Sep 2026', // date
    '11:30 AM', // time
    '₹2,400', // price
    'Confirmed', // status badge
  ]) {
    assert.ok(html.includes(expected), `card is missing "${expected}"`);
  }
});

test('the status badge is rendered as a badge, not raw column text', () => {
  assert.ok(renderCard().includes('data-booking-status="confirmed"'));
  assert.ok(renderCard({ status: 'no_show' }).includes('No-show'));
});

test('the salon image is used when the salon has one', () => {
  const html = renderCard();
  assert.ok(html.includes('src="https://img/salon.png"'));
});

test('a salon with no image falls back to initials rather than a broken icon', () => {
  const html = renderCard({ salon: { name: 'Blush Studio', city: 'Pune' } });
  assert.ok(!html.includes('src="'));
  assert.ok(html.includes('BS'), 'expected the initials of "Blush Studio"');
});

test('View details and Rebook are always available', () => {
  for (const status of ['pending', 'confirmed', 'completed', 'cancelled', 'no_show']) {
    const html = renderCard({ status });
    assert.ok(html.includes('View details'), `${status}: View details`);
    assert.ok(html.includes('Rebook'), `${status}: Rebook`);
  }
});

test('a past-due booking the salon never closed is flagged', () => {
  assert.ok(renderCard({}, AFTER_SLOT).includes('has passed but the salon has not updated it'));
});

// ---------------------------------------------------------------------------
// Action gating
// ---------------------------------------------------------------------------

test('Cancel is offered for an upcoming booking', () => {
  assert.ok(renderCard().includes('Cancel booking'));
  assert.ok(renderCard({ status: 'pending' }).includes('Cancel booking'));
});

test('Cancel is not offered once the booking is terminal', () => {
  for (const status of ['completed', 'cancelled', 'no_show']) {
    assert.ok(!renderCard({ status }).includes('Cancel booking'), `${status} must not offer Cancel`);
  }
});

test('Cancel is not offered once the slot has passed', () => {
  assert.ok(!renderCard({}, AFTER_SLOT).includes('Cancel booking'));
});

test('the reason Cancel is unavailable is explained in the details', () => {
  const html = renderDetails({ status: 'completed' });
  assert.ok(html.includes('Cancelling'));
  assert.ok(html.includes('already been completed'));
});

test('Review is offered only for a completed, unreviewed visit', () => {
  assert.ok(renderCard({ status: 'completed' }).includes('Write a review'));
  for (const status of ['pending', 'confirmed', 'cancelled', 'no_show']) {
    assert.ok(!renderCard({ status }).includes('Write a review'), `${status} must not offer a review`);
  }
});

test('an already-reviewed visit shows the rating instead of asking again', () => {
  const html = renderCard({ status: 'completed', metadata: { review_rating: 4 } });
  assert.ok(html.includes('4/5 reviewed'));
  assert.ok(!html.includes('Write a review'));
});

test('an advance payment is broken out from the total in the details', () => {
  const html = renderDetails();
  assert.ok(html.includes('Advance ₹600 paid'));
  assert.ok(html.includes('Balance ₹1,800'));
});

test('the booking reference is shown in the details', () => {
  assert.ok(renderDetails().includes('NX-BLR-12345'));
});

// ---------------------------------------------------------------------------
// Empty state — exact copy
// ---------------------------------------------------------------------------

test('the empty state uses the specified copy and CTA', () => {
  assert.equal(MY_BOOKINGS_EMPTY_TITLE, 'No bookings yet.');
  assert.equal(MY_BOOKINGS_EMPTY_BODY, 'Find your next salon visit.');
  assert.equal(MY_BOOKINGS_EXPLORE_CTA, 'Explore Salons');

  const html = renderToStaticMarkup(
    React.createElement(MyBookingsEmptyState, { onExploreSalons: () => {} } as any)
  );
  assert.ok(html.includes('No bookings yet.'));
  assert.ok(html.includes('Find your next salon visit.'));
  assert.ok(html.includes('Explore Salons'));
});

// ---------------------------------------------------------------------------
// Signed-out page
// ---------------------------------------------------------------------------

test('a signed-out visitor is asked to sign in rather than shown an empty list', () => {
  const html = renderToStaticMarkup(
    React.createElement(MyBookingsPage, {
      user: null,
      onExploreSalons: () => {},
      onRebook: () => {},
    } as any)
  );
  assert.ok(html.includes('Sign in to see your bookings'));
  assert.ok(html.includes('Sign in'));
  assert.ok(!html.includes('No bookings yet.'), 'must not claim the account has no bookings');
});

// ---------------------------------------------------------------------------
// Route matching
// ---------------------------------------------------------------------------

test('the page lives at /customer/bookings', () => {
  assert.equal(MY_BOOKINGS_PATH, '/customer/bookings');
  assert.equal(isMyBookingsPath('/customer/bookings'), true);
  assert.equal(isMyBookingsPath('/customer/bookings/'), true);
  assert.equal(isMyBookingsPath('/CUSTOMER/BOOKINGS'), true);
});

test('other paths do not match the bookings route', () => {
  for (const path of ['/', '/dashboard', '/customer', '/customer/bookings/extra', '']) {
    assert.equal(isMyBookingsPath(path), false, path);
  }
});

test('normalizePath strips trailing slashes but keeps the root', () => {
  assert.equal(normalizePath('/customer/bookings/'), '/customer/bookings');
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath(''), '/');
});

// ---------------------------------------------------------------------------
// ?tab= deep link
// ---------------------------------------------------------------------------

test('?tab= selects a tab and an unknown value falls back to Upcoming', () => {
  assert.equal(tabFromQueryParam('completed'), 'completed');
  assert.equal(tabFromQueryParam('cancelled'), 'cancelled');
  assert.equal(tabFromQueryParam('upcoming'), 'upcoming');
  // A bad value must not leave the page with no tab selected at all.
  assert.equal(tabFromQueryParam('all'), 'upcoming');
  assert.equal(tabFromQueryParam(null), 'upcoming');
  assert.equal(tabFromQueryParam(''), 'upcoming');
});

test('a signed-in visitor gets the three tabs before any data arrives', () => {
  // The tab bar renders outside the loading branch, so a server render reaches
  // it and the tab set can be asserted without a fetch.
  const html = renderToStaticMarkup(
    React.createElement(MyBookingsPage, {
      user: { id: 'customer-1', email: 'riya@example.com' },
      onExploreSalons: () => {},
      onRebook: () => {},
    } as any)
  );
  assert.ok(html.includes('My Bookings'));
  assert.ok(html.includes('role="tablist"'));
  for (const label of ['Upcoming', 'Completed', 'Cancelled']) {
    assert.ok(html.includes(label), `tab "${label}" is missing`);
  }
  assert.ok(html.includes('Loading your bookings'));
  assert.ok(!html.includes('No bookings yet.'), 'must not show the empty state while loading');
});

test('a signed-out visitor never sees the tabs', () => {
  const html = renderToStaticMarkup(
    React.createElement(MyBookingsPage, { user: null, onExploreSalons: () => {}, onRebook: () => {} } as any)
  );
  assert.ok(!html.includes('role="tablist"'));
});
