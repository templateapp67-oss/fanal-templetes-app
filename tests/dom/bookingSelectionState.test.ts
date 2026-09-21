// ============================================================================
// Booking modal selection state & calculation integrity DOM tests.
//
// Tests:
// 1. Clear All helper resets all selected services, upgrades, and totals to zero.
// 2. Category filter tabs switch visible services and respect category scope.
// 3. Step 1 -> 1.5 -> add upgrades -> deselect primary service clears unlinked upgrades.
// 4. Changing primary service purges unlinked upgrades while keeping active service totals strictly derived.
// 5. Multi-service selection and bottom bar dynamic updates (item count, duration, totalPrice).
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

const sampleServices: SalonService[] = [
  {
    id: 'hair-1',
    name: 'Precision Haircut',
    category: 'Hair Care',
    durationMinutes: 30,
    price: 500,
    description: 'Precision haircut',
    icon: 'content_cut',
  },
  {
    id: 'hair-addon-1',
    name: 'Deep Conditioning Treatment',
    category: 'Hair Care',
    durationMinutes: 20,
    price: 300,
    description: 'Deep conditioning',
    icon: 'spa',
  },
  {
    id: 'hair-addon-2',
    name: 'Beard Trim & Sculpt',
    category: 'Hair Care',
    durationMinutes: 15,
    price: 200,
    description: 'Beard trim',
    icon: 'face',
  },
  {
    id: 'nail-1',
    name: 'Luxury Gel Manicure',
    category: 'Nail Care',
    durationMinutes: 45,
    price: 1200,
    description: 'Gel manicure',
    icon: 'pan_tool',
  },
  {
    id: 'nail-addon-1',
    name: 'Nail Art Accent',
    category: 'Nail Care',
    durationMinutes: 15,
    price: 400,
    description: 'Custom nail art',
    icon: 'brush',
  },
];

const sampleProfile: SalonProfile = {
  ownerId: 'owner-1',
  subdomain: 'demo-salon',
  businessName: 'Glam Studio',
  city: 'Mumbai',
  currency: '₹',
  phone: '9876543210',
} as SalonProfile;

const sampleStylists: Stylist[] = [
  {
    id: 'stylist-1',
    name: 'Rohan Sharma',
    role: 'Senior Stylist',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200',
    specialties: ['Hair Care'],
    rating: 4.9,
  },
];

function mountModal(props: Partial<React.ComponentProps<typeof BookingModal>> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  return {
    container,
    root,
    async render(overrideProps: Partial<React.ComponentProps<typeof BookingModal>> = {}) {
      await act(async () => {
        root.render(
          React.createElement(BookingModal, {
            isOpen: true,
            onClose: () => {},
            profile: sampleProfile,
            services: sampleServices,
            stylists: sampleStylists,
            themeAccentHex: '#0f172a',
            user: { id: 'test-user', email: 'test@example.com' },
            ...props,
            ...overrideProps,
          })
        );
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

test('Clear All helper resets all selected services, upgrades, and totals to zero', async () => {
  const env = mountModal();
  await env.render();

  // Initially, first service ('hair-1', ₹500, 30 mins) starts selected
  const summaryBar = env.container.querySelector('[data-testid="booking-summary-bar"]');
  assert.ok(summaryBar, 'summary bar should exist');
  assert.match(summaryBar.textContent || '', /1 Service Selected/);
  assert.match(summaryBar.textContent || '', /₹500/);
  assert.match(summaryBar.textContent || '', /30 mins/);

  // Click the "Clear All" button
  const clearAllBtn = env.container.querySelector('[data-testid="clear-all-services-button"]') as HTMLButtonElement | null;
  assert.ok(clearAllBtn, 'Clear All button should be rendered');

  await act(async () => {
    clearAllBtn.click();
  });

  // Summary bar should immediately reflect 0 services, ₹0 total, 0 mins
  assert.match(summaryBar.textContent || '', /0 Services Selected/);
  assert.match(summaryBar.textContent || '', /₹0/);
  assert.match(summaryBar.textContent || '', /0 mins/);

  // Clear all button should disappear when 0 services are selected
  assert.equal(env.container.querySelector('[data-testid="clear-all-services-button"]'), null);

  env.unmount();
});

test('Category filter tabs switch visible services and respect category scope', async () => {
  const env = mountModal();
  await env.render();

  // All services should be visible initially (5 services)
  const serviceCards = env.container.querySelectorAll('[role="checkbox"]');
  assert.equal(serviceCards.length, 5, 'all 5 services should initially be displayed');

  // Click Nail Care category tab
  const nailTab = env.container.querySelector('[data-testid="category-tab-nail-care"]') as HTMLButtonElement | null;
  assert.ok(nailTab, 'Nail Care category tab should exist');

  await act(async () => {
    nailTab.click();
  });

  // Only Nail Care services (2 services) should now be displayed
  const filteredCards = env.container.querySelectorAll('[role="checkbox"]');
  assert.equal(filteredCards.length, 2, 'only 2 Nail Care services should be displayed');

  // Switch back to All
  const allTab = env.container.querySelector('[data-testid="category-tab-all"]') as HTMLButtonElement | null;
  assert.ok(allTab, 'All tab should exist');

  await act(async () => {
    allTab.click();
  });

  assert.equal(env.container.querySelectorAll('[role="checkbox"]').length, 5);

  env.unmount();
});

test('Step 1 -> 1.5 -> add upgrades -> deselect primary service cleans unlinked upgrades', async () => {
  const env = mountModal();
  await env.render();

  // Continue to upgrades step
  const continueBtn = env.container.querySelector('button[style*="background-color"]') as HTMLButtonElement | null;
  assert.ok(continueBtn, 'Continue to upgrades button should exist');

  await act(async () => {
    continueBtn.click();
  });

  // In upgrades step, addonCandidates for 'Hair Care' are displayed: 'hair-addon-1' (₹300, 20m) & 'hair-addon-2' (₹200, 15m)
  const upgradeCards = env.container.querySelectorAll('[role="checkbox"]');
  assert.ok(upgradeCards.length >= 2, 'should display upgrade candidates');

  // Select the first upgrade ('Deep Conditioning Treatment', ₹300, 20 mins)
  await act(async () => {
    (upgradeCards[0] as HTMLElement).click();
  });

  // Summary bar now reflects 1 Service + 1 Add-on: ₹500 + ₹300 = ₹800, 30 + 20 = 50 mins
  const summaryBar = env.container.querySelector('[data-testid="booking-summary-bar"]');
  assert.ok(summaryBar);
  assert.match(summaryBar.textContent || '', /1 Service Selected/);
  assert.match(summaryBar.textContent || '', /\+1 Add-on/);
  assert.match(summaryBar.textContent || '', /₹800/);
  assert.match(summaryBar.textContent || '', /50 mins/);

  // Navigate back to Step 1 (service selection)
  const backBtn = Array.from(env.container.querySelectorAll('button')).find((b) => b.textContent?.includes('Back'));
  assert.ok(backBtn, 'Back button should exist');

  await act(async () => {
    backBtn.click();
  });

  // Remove the primary service ('hair-1')
  const removeBtn = Array.from(env.container.querySelectorAll('button')).find((b) => b.textContent?.includes('Remove'));
  assert.ok(removeBtn, 'Remove button should exist for selected service');

  await act(async () => {
    removeBtn.click();
  });

  // Now that the primary service is deselected, upgrades MUST be automatically cleared!
  // Summary bar should show 0 Services Selected, no add-ons, ₹0, 0 mins
  assert.match(summaryBar.textContent || '', /0 Services Selected/);
  assert.ok(!summaryBar.textContent?.includes('Add-on'), 'Add-ons must be cleared when no service is selected');
  assert.match(summaryBar.textContent || '', /₹0/);
  assert.match(summaryBar.textContent || '', /0 mins/);

  env.unmount();
});

test('Changing primary service purges unlinked upgrades while keeping new primary totals', async () => {
  const env = mountModal();
  await env.render();

  // First service ('hair-1', ₹500, 30m) is selected.
  // Add second service ('nail-1', ₹1200, 45m).
  const addButtons = Array.from(env.container.querySelectorAll('button')).filter((b) => b.textContent?.includes('Add to Booking'));
  assert.ok(addButtons.length >= 1);

  // Find the Nail-1 add button
  const nailAddBtn = Array.from(env.container.querySelectorAll('[role="checkbox"]')).find((card) =>
    card.textContent?.includes('Luxury Gel Manicure')
  )?.querySelector('button');
  assert.ok(nailAddBtn, 'Add button for Luxury Gel Manicure should exist');

  await act(async () => {
    nailAddBtn.click();
  });

  // Now selectedServices has ['hair-1', 'nail-1']. Totals: ₹1,700, 75 mins.
  const summaryBar = env.container.querySelector('[data-testid="booking-summary-bar"]');
  assert.ok(summaryBar);
  assert.match(summaryBar.textContent || '', /2 Services Selected/);
  assert.match(summaryBar.textContent || '', /₹1,700/);
  assert.match(summaryBar.textContent || '', /75 mins/);

  // Navigate to upgrades step: primary is 'hair-1', so add-on candidates are for Hair Care
  const continueBtn = env.container.querySelector('button[style*="background-color"]') as HTMLButtonElement | null;
  await act(async () => {
    continueBtn?.click();
  });

  const upgradeCards = env.container.querySelectorAll('[role="checkbox"]');
  assert.ok(upgradeCards.length >= 1);
  // Pick Deep Conditioning Treatment (₹300, 20m, linked to hair-1)
  await act(async () => {
    (upgradeCards[0] as HTMLElement).click();
  });

  // Total should now be 2 Services + 1 Add-on = ₹2,000, 95 mins
  assert.match(summaryBar.textContent || '', /2 Services Selected/);
  assert.match(summaryBar.textContent || '', /\+1 Add-on/);
  assert.match(summaryBar.textContent || '', /₹2,000/);
  assert.match(summaryBar.textContent || '', /95 mins/);

  // Back to step 1
  const backBtn = Array.from(env.container.querySelectorAll('button')).find((b) => b.textContent?.includes('Back'));
  await act(async () => {
    backBtn?.click();
  });

  // Deselect the primary service ('hair-1')
  const hairRemoveBtn = Array.from(env.container.querySelectorAll('[role="checkbox"]')).find((card) =>
    card.textContent?.includes('Precision Haircut')
  )?.querySelector('button');
  assert.ok(hairRemoveBtn);

  await act(async () => {
    hairRemoveBtn.click();
  });

  // Now primary service changed to 'nail-1' (Nail Care).
  // The upgrade linked to 'hair-1' must be pruned!
  // Remaining: 1 Service ('nail-1', ₹1,200, 45 mins), 0 Add-ons!
  assert.match(summaryBar.textContent || '', /1 Service Selected/);
  assert.ok(!summaryBar.textContent?.includes('Add-on'), 'Hair add-on must be pruned when hair-1 is deselected');
  assert.match(summaryBar.textContent || '', /₹1,200/);
  assert.match(summaryBar.textContent || '', /45 mins/);

  env.unmount();
});
