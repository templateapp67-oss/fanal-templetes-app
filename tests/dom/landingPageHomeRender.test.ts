// ============================================================================
// Home page (LandingPage) render smoke test.
//
// Verifies the complete marketing home page mounts with every required
// section: hero (glass card), stats, about, videos, customer benefits,
// rewards ladder + tiers, owner benefits, growth partner, templates,
// testimonials, FAQ and footer — plus the glassmorphism/hover class hooks.
// ============================================================================

import './jsdomSetup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LandingPage } from '../../src/components/LandingPage';

function mount(onBrowseTemplates: (category?: string) => void): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(LandingPage, { onBrowseTemplates }));
  });
  return { container, root };
}

test('home page renders hero, every section and the glass hooks', () => {
  const { container } = mount(() => {});
  const html = container.innerHTML;

  // Hero copy
  assert.match(html, /Your Entire Salon/);
  assert.match(html, /One Beautiful Platform/);
  assert.match(html, /Nexora Live Preview/);

  // Glassmorphism + hover/float hooks (classes backed by index.css)
  assert.match(html, /nx-glass\b/);
  assert.match(html, /nx-glass-chip/);
  assert.match(html, /nx-lift/);
  assert.match(html, /nx-float/);

  // All marketing section anchors exist
  for (const id of ['top', 'about', 'nexora-videos', 'campaign', 'customers', 'rewards', 'owners', 'partner', 'templates', 'stories', 'faq']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing section #${id}`);
  }

  // Campaign poster (black & gold creative)
  assert.match(html, /SALON/);
  assert.match(html, /JA RHE HO\?/);
  assert.match(html, /PAHLE NEXORA/);
  assert.match(html, /PHIR/);
  assert.match(html, /nx-poster-frame/);
  assert.match(html, /nx-gold-text/);

  // Complete-information content blocks
  assert.match(html, /Rewards Ladder/);
  assert.match(html, /GLOW10/);
  assert.match(html, /SAVE300/);
  assert.match(html, /ROYAL20/);
  assert.match(html, /FREESPA/);
  assert.match(html, /VIP1500/);
  assert.match(html, /Platinum/);
  assert.match(html, /Growth Partner Program/);
  assert.match(html, /For shop owners/);
  assert.match(html, /play_arrow/); // video play affordance
  assert.match(html, /© .* Nexora/); // footer

  const buttons = Array.from(container.querySelectorAll('button'));
  assert.ok(buttons.length > 15, 'expected a rich interactive page');
});

test('template CTAs route into the explorer (no category = full catalogue)', () => {
  const calls: (string | undefined)[] = [];
  const { container } = mount((category) => calls.push(category));

  const heroCta = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent || '').includes('Choose Your Template'),
  );
  assert.ok(heroCta, 'hero CTA missing');

  act(() => {
    heroCta!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0], undefined);
});

test('category cards pass their template category to the explorer', () => {
  const calls: (string | undefined)[] = [];
  const { container } = mount((category) => calls.push(category));

  const tattooCard = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent || '').includes('Tattoo Studios'),
  );
  assert.ok(tattooCard, 'tattoo category card missing');

  act(() => {
    tattooCard!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  assert.equal(calls[0], 'tattoo');
});
