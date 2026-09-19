import './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WebsiteEditor } from '../../src/components/WebsiteEditor';
import { INITIAL_SALON_PROFILE, INITIAL_SERVICES } from '../../src/mockData';

after(() => {
  /* jsdomSetup owns the window lifetime */
});

/**
 * "Save & Update Website" with an unusable cloud session.
 *
 * The old behaviour was a red toast reading "Save failed: Database permission
 * problem — please sign in again. If it persists, confirm the Supabase schema,
 * RLS policies and grants …", which looks like a broken database and offers no
 * way forward inside the editor. The editor now renders an explicit notice
 * with the two actions that fix it — sign in again, or retry the save once the
 * session is usable — while the local draft keeps every edit.
 */

function mountEditor(sessionExpired: boolean) {
  const calls: { signIn: string[]; saves: number } = { signIn: [], saves: 0 };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(WebsiteEditor, {
        profile: INITIAL_SALON_PROFILE,
        setProfile: () => {},
        services: INITIAL_SERVICES,
        setServices: () => {},
        saveStatus: 'error' as any,
        lastSavedAt: null,
        onComplete: () => {},
        siteUrl: 'https://example.test/salon',
        onSave: async () => {
          calls.saves++;
          return false;
        },
        onBackToDashboard: () => {},
        showToast: () => {},
        isAuthenticated: true,
        onRequireAuth: (mode?: 'login' | 'signup') => calls.signIn.push(mode || 'login'),
        sessionExpired,
      })
    );
  });
  return { container, root, calls };
}

function unmount(container: HTMLElement, root: Root) {
  act(() => root.unmount());
  container.remove();
}

test('an unusable session shows the in-editor notice with both recovery actions', async () => {
  const { container, root, calls } = mountEditor(true);
  try {
    const notice = container.querySelector('[data-testid="save-session-expired-notice"]');
    assert.ok(notice, 'the session notice must render');
    assert.match(notice!.textContent || '', /session expired/i);
    assert.match(notice!.textContent || '', /saved on this device/i);

    const buttons = Array.from(notice!.querySelectorAll('button'));
    const signIn = buttons.find((b) => /sign in again/i.test(b.textContent || ''));
    const retry = buttons.find((b) => /retry save/i.test(b.textContent || ''));
    assert.ok(signIn, 'a "Sign in again" action must be offered');
    assert.ok(retry, 'a "Retry Save" action must be offered');

    await act(async () => {
      signIn!.click();
    });
    assert.deepEqual(calls.signIn, ['login'], 'Sign in again must open the login modal');

    await act(async () => {
      retry!.click();
    });
    assert.equal(calls.saves, 1, 'Retry Save must run the manual save');

    // The bottom bar repeats the state in plain language.
    assert.match(container.textContent || '', /sign in again to publish to the cloud/i);
  } finally {
    unmount(container, root);
  }
});

test('a healthy editor shows no session notice', () => {
  const { container, root } = mountEditor(false);
  try {
    assert.equal(container.querySelector('[data-testid="save-session-expired-notice"]'), null);
  } finally {
    unmount(container, root);
  }
});
