// ============================================================================
// Booking modal (public website) — multi-service selection contract.
//
// The service step used to behave like a radio group (one `selectedService`),
// which made it impossible to book several treatments together or to clear the
// default pick. These tests render the modal server-side and lock the markup
// contract of the multi-select: every menu item gets a checkbox card with an
// explicit Add/Remove toggle, and the bottom summary bar shows the running
// count, Total (₹) and duration (mins) of the whole basket.
//
// Interaction behaviour itself (toggling cards, stepping through 1→4) cannot
// run without a DOM test runner, but the initial-selection + totals contract —
// the state every click builds on — is asserted here.
// ============================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { BookingModal } from '../src/components/BookingModal';
import type { SalonProfile, SalonService } from '../src/types';

const services: SalonService[] = [
  {
    id: 'cut-1',
    name: 'Master Stylist Precision Cut & Blowdry',
    category: 'Hair Artistry',
    durationMinutes: 45,
    price: 750,
    description: 'Cut + blowdry',
    icon: 'content_cut',
    popular: true,
  },
  {
    id: 'gel-4',
    name: 'Full Set Gel-X Sculpted Extensions & Nail Art',
    category: 'Nail Couture',
    durationMinutes: 90,
    price: 2400,
    description: 'Gel-X set',
    icon: 'pan_tool_alt',
  },
  {
    id: 'balay-3',
    name: 'Signature Caramel Balayage & Olaplex Glaze',
    category: 'Color Alchemy',
    durationMinutes: 150,
    price: 5200,
    description: 'Balayage',
    icon: 'palette',
  },
];

const profile: SalonProfile = {
  ownerId: 'owner-test',
  subdomain: 'test-salon',
  businessName: 'Test Salon Studio',
  city: 'Bengaluru',
  currency: '₹',
  phone: '9999999999',
} as SalonProfile;

function renderModal(options: { initialServiceId?: string } = {}): string {
  const initialService =
    services.find((s) => s.id === options.initialServiceId) || undefined;
  return renderToStaticMarkup(
    React.createElement(BookingModal, {
      isOpen: true,
      onClose: () => {},
      profile,
      services,
      stylists: [],
      initialService,
      themeAccentHex: '#0f172a',
      user: { id: 'customer-test', email: 'customer@test.in' },
    })
  );
}

test('the service step renders every menu item with an Add to Booking toggle', () => {
  const html = renderModal();
  for (const srv of services) {
    // React escapes & into &amp; in static markup.
    const encodedName = srv.name.replace(/&/g, '&amp;');
    assert.equal(html.includes(encodedName), true, `menu should show ${srv.name}`);
  }
  // Two unselected cards offer "Add to Booking", the default pick offers Remove.
  const addButtons = html.match(/Add to Booking/g) || [];
  const removeButtons = html.match(/Remove /g) || [];
  assert.equal(addButtons.length, services.length - 1, 'every unselected card must offer Add to Booking');
  assert.equal(removeButtons.length, 1, 'the default selected card must offer Remove');
});

test('default selection follows the first menu item and drives the summary bar', () => {
  const html = renderModal();
  // Exactly the default card is checked.
  const checkedCards = html.match(/role="checkbox" aria-checked="true"/g) || [];
  assert.equal(checkedCards.length, 1, 'exactly one service starts selected');
  // Totals = the default service alone: ₹750 • 45 mins.
  assert.match(html, /1 Service Selected/);
  assert.match(html, /Total: <strong[^>]*>₹750<\/strong>/);
  assert.match(html, /<strong[^>]*>45<\/strong> mins/);
});

test('a pre-selected service (menu card / rebook) seeds the basket and totals', () => {
  const html = renderModal({ initialServiceId: 'gel-4' });
  const checkedCards = html.match(/role="checkbox" aria-checked="true"/g) || [];
  assert.equal(checkedCards.length, 1, 'exactly the retargeted service starts selected');
  assert.match(html, /1 Service Selected/);
  assert.match(html, /Total: <strong[^>]*>₹2,400<\/strong>/);
  assert.match(html, /<strong[^>]*>90<\/strong> mins/);
});

test('the summary bar and Continue button agree that booking needs a service', () => {
  const html = renderModal();
  // Loading/empty menu guard exists and the zero-state copy is present for when
  // the customer removes every selection (render with no services at all).
  const emptyHtml = renderToStaticMarkup(
    React.createElement(BookingModal, {
      isOpen: true,
      onClose: () => {},
      profile,
      services: [],
      stylists: [],
      user: { id: 'customer-test', email: 'customer@test.in' },
    })
  );
  assert.match(emptyHtml, /0 Services Selected/);
  assert.match(emptyHtml, /Select at least one service to continue booking/);
  assert.match(emptyHtml, /The service menu is still loading/);
  assert.match(html, /data-testid="booking-summary-bar"/);
});
