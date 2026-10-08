import './jsdomSetup';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useReferralTracker, NEXORA_REFERRAL_KEY } from '../../src/lib/useReferralTracker';
import { UserProfileSettingsModal } from '../../src/components/UserProfileSettingsModal';
import { INITIAL_SALON_PROFILE } from '../../src/mockData';

test('inline tracker options do not reopen signup on unrelated renders; navigation still detects a referral', async () => {
  window.sessionStorage.clear(); window.localStorage.clear();
  window.history.replaceState({}, '', '/signup?ref=NEXORA-123456789ABC');
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  let detections = 0;
  const onReferralDetected = () => { detections += 1; };
  function Tracker({ revision }: { revision: number }) {
    const { referralCode, clearReferralCode } = useReferralTracker({ onReferralDetected });
    return <button onClick={clearReferralCode}>{revision}: {referralCode}</button>;
  }
  try {
    await act(async () => root.render(<Tracker revision={1} />));
    assert.equal(detections, 1);
    assert.equal(window.localStorage.getItem(NEXORA_REFERRAL_KEY), 'NEXORA-123456789ABC');
    await act(async () => root.render(<Tracker revision={2} />));
    assert.equal(detections, 1, 'closing a modal or changing unrelated state must not trigger signup again');
    window.history.replaceState({}, '', '/signup?ref=NEXORA-ABCDEF123456');
    await act(async () => window.dispatchEvent(new Event('popstate')));
    assert.equal(detections, 2);
    assert.match(host.textContent || '', /NEXORA-ABCDEF123456/);
    await act(async () => host.querySelector('button')!.click());
    assert.equal(window.localStorage.getItem(NEXORA_REFERRAL_KEY), null);
  } finally {
    await act(async () => root.unmount()); host.remove();
    window.history.replaceState({}, '', '/');
    window.sessionStorage.clear(); window.localStorage.clear();
  }
});

test('malformed optional WhatsApp shows its field error and never starts a profile save', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  let saves = 0;
  const toasts: string[] = [];
  try {
    await act(async () => root.render(<UserProfileSettingsModal isOpen onClose={() => {}}
      profile={{ ...INITIAL_SALON_PROFILE, ownerName: 'Saved Owner', whatsapp: '+91<script>9845077654' }}
      setProfile={() => {}} showToast={message => toasts.push(message)} onSave={() => { saves += 1; }} />));
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.match(host.textContent || '', /Enter a valid WhatsApp number/);
    assert.equal(saves, 0);
    assert.ok(toasts.includes('Please check the required fields.'));
    assert.doesNotMatch(host.textContent || '', /Saving\.\.\./);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
