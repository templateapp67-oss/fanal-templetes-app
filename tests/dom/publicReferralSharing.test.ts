import './jsdomSetup';
import { dom } from './jsdomSetup';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { PartnerReferralCodeSection } from '../../src/components/PartnerPortalSections';

after(() => dom.window.close());

test('copy and sharing actions use the real code and signup URL, with safe fallbacks', async () => {
  const copied: string[] = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied.push(text); } } });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const url = 'https://example.com/onboarding/signup?ref=NEXORA-RAHUL25';
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find(b => b.textContent === label);
    assert.ok(button, label);
    await act(async () => { button.click(); });
  };
  try {
    window.history.replaceState(null, '', '/?site=mysalon');
    window.localStorage.setItem('nexora_active_site', 'mysalon');
    await act(async () => root.render(React.createElement(PartnerReferralCodeSection, { code: 'NEXORA-RAHUL25', origin: 'https://example.com' })));
    await click('Copy Code');
    await click('Copy Referral Link');
    assert.deepEqual(copied, ['NEXORA-RAHUL25', url]);
    assert.doesNotMatch(copied[1], /[?&]site=/, 'a salon tenant never leaks into a partner onboarding link');
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    await click('Share');
    assert.equal(copied.at(-1), url);
    let shared: ShareData | undefined;
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => { shared = data; } });
    await click('Share');
    assert.equal(shared?.url, url);
    const count = copied.length;
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw { name: 'AbortError' }; } });
    await click('Share');
    assert.equal(copied.length, count);
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new Error('Unavailable'); } });
    await click('Share');
    assert.equal(copied.length, count + 1);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Denied'); } } });
    await click('Share');
    assert.match(container.textContent!, /Select and copy/);
    assert.ok(container.querySelector('a[href^="https://wa.me/"]'));
    assert.ok(container.querySelector('a[href^="mailto:"]'));
  } finally {
    window.localStorage.removeItem('nexora_active_site');
    await act(async () => root.unmount());
    container.remove();
  }
});
