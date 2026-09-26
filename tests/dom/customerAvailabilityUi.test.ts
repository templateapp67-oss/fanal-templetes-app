// ============================================================================
// Customer availability error UX (public booking modal, datetime step).
//
// Regression guard for the end-to-end "This salon is not accepting online
// bookings" bug: onboarded salons are created with salons.verified=false and
// nothing ever flips it, so the availability handler must NOT gate on verified
// (it now mirrors the booking contract). When a salon has *genuinely* switched
// online booking off, the modal must show a "contact the salon" instruction and
// must NOT offer a "Retry availability" button that can never succeed. A
// transient failure still offers the retry.
// ============================================================================

import './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BookingModal } from '../../src/components/BookingModal';
import type { SalonProfile, SalonService, Stylist } from '../../src/types';

after(() => {
  /* jsdomSetup owns the window lifetime */
});

const services: SalonService[] = [
  {
    id: 'hair-1',
    name: 'Precision Haircut',
    category: 'Hair Care',
    durationMinutes: 30,
    price: 500,
    description: 'Precision haircut',
    icon: 'content_cut',
    popular: true,
  },
];

const profile = {
  ownerId: 'owner-1',
  subdomain: 'demo-salon',
  businessName: 'Glam Studio',
  city: 'Mumbai',
  currency: '₹',
  phone: '9876543210',
} as SalonProfile;

const stylists: Stylist[] = [
  { id: 'stylist-1', name: 'Rohan', role: 'Stylist', avatarUrl: '', specialties: [], rating: 4.9 } as Stylist,
];

/** Route the availability endpoint to a controllable responder; anything else succeeds. */
function stubFetch(responder: () => any) {
  const fetch = (input: any) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (String(url).includes('/api/bookings/availability')) return Promise.resolve(responder());
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
  };
  (globalThis as any).fetch = fetch;
  (globalThis.window as any).fetch = fetch;
}

function mountModal() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  return { container, root };
}

async function renderOpen(root: Root) {
  await act(async () => {
    root.render(
      React.createElement(BookingModal, {
        isOpen: true,
        onClose: () => {},
        profile,
        services,
        stylists,
        themeAccentHex: '#0f172a',
        user: { id: 'u', email: 'u@e.in' },
      })
    );
  });
}

function clickByText(container: HTMLElement, text: string) {
  const btn = [...container.querySelectorAll('button')].find((b) => (b.textContent || '').includes(text));
  if (!btn) throw new Error(`button not found: ${text}`);
  return btn as HTMLButtonElement;
}

async function driveToDateTime(container: HTMLElement) {
  await act(async () => {
    clickByText(container, 'Continue to Optional Upgrades').click();
  });
  await act(async () => {
    clickByText(container, 'Continue to Date & Slot').click();
  });
  // Flush the async availability fetch + state settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

test('a salon with online booking OFF shows a contact instruction and never a futile retry', async () => {
  stubFetch(() => ({
    ok: false,
    status: 409,
    json: async () => ({
      success: false,
      error: 'This salon is not accepting online bookings. Contact the salon to book.',
      code: 'online_booking_disabled',
    }),
  }));

  const { container, root } = mountModal();
  await renderOpen(root);
  await driveToDateTime(container);

  const text = container.textContent || '';
  assert.match(text, /isn't accepting online bookings right now/i);
  assert.match(text, /contact the salon directly/i);
  assert.doesNotMatch(text, /Retry availability/);

  act(() => root.unmount());
  container.remove();
});

test('a transient availability failure still offers a working Retry availability button', async () => {
  let calls = 0;
  stubFetch(() => {
    calls += 1;
    return {
      ok: false,
      status: 503,
      json: async () => ({ success: false, error: 'Availability could not be loaded (503). Please retry.' }),
    };
  });

  const { container, root } = mountModal();
  await renderOpen(root);
  await driveToDateTime(container);

  assert.match(container.textContent || '', /Retry availability/);
  assert.doesNotMatch(container.textContent || '', /isn't accepting online bookings right now/i);

  const before = calls;
  await act(async () => {
    clickByText(container, 'Retry availability').click();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  assert.ok(calls > before, 'Retry availability must re-issue the availability request');

  act(() => root.unmount());
  container.remove();
});
