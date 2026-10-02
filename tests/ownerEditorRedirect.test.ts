import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  resolveLoggedInOwnerDestination,
  resolvePostAuthDestination,
  sanitizeOwnerNextPath,
  shouldRedirectEditorToWebsiteOnboarding,
} from '../src/lib/ownerRouteGuard';

test('next=/editor is accepted and public landing/template preview URLs are not', () => {
  assert.equal(sanitizeOwnerNextPath('/editor'), '/editor');
  assert.equal(sanitizeOwnerNextPath('/editor?site=abc'), '/editor?site=abc');
  assert.equal(sanitizeOwnerNextPath('/settings/profile'), '/settings/profile');
  assert.equal(sanitizeOwnerNextPath('/templates/hair_salon/preview'), null);
  assert.equal(sanitizeOwnerNextPath('/'), null);
  assert.equal(sanitizeOwnerNextPath('https://evil.example/editor'), null);
  assert.equal(sanitizeOwnerNextPath('//templates/hair_salon/preview'), null);
});

test('a logged-in visit to Profile / Settings stays there instead of template preview', () => {
  const stay = resolveLoggedInOwnerDestination({
    path: '/settings/profile',
    search: '',
    profileComplete: true,
  });
  assert.equal(stay.action, 'stay');
  assert.equal(stay.openProfile, true);
  assert.equal(stay.to, '/settings/profile');
});

test('next=/editor session validation continues to the editor after a complete profile', () => {
  const next = resolveLoggedInOwnerDestination({
    path: '/settings/profile',
    search: '?next=%2Feditor',
    profileComplete: true,
  });
  assert.equal(next.action, 'redirect');
  assert.equal(next.to, '/editor');
  assert.equal(next.openProfile, false);

  const incomplete = resolveLoggedInOwnerDestination({
    path: '/editor',
    search: '',
    profileComplete: false,
  });
  assert.equal(incomplete.action, 'redirect');
  assert.match(incomplete.to, /^\/settings\/profile\?next=/);
  assert.equal(incomplete.openProfile, true);

  const editor = resolveLoggedInOwnerDestination({
    path: '/editor',
    search: '?site=salon-1',
    profileComplete: true,
  });
  assert.equal(editor.action, 'stay');
  assert.equal(editor.to, '/editor?site=salon-1');
});

test('post-auth destination honours next=/editor and never falls back to landing', () => {
  assert.equal(resolvePostAuthDestination('/settings/profile', '?next=/editor'), '/editor');
  assert.equal(resolvePostAuthDestination('/editor', '?templateId=barber'), '/editor?templateId=barber');
  assert.equal(resolvePostAuthDestination('/templates/hair_salon/preview', ''), '/editor');
  assert.equal(resolvePostAuthDestination('/', ''), '/editor');
});

test('a completed profile never leaves the editor for website onboarding / template preview', () => {
  assert.equal(shouldRedirectEditorToWebsiteOnboarding('/editor', 0, false, true), false);
  assert.equal(shouldRedirectEditorToWebsiteOnboarding('/editor?template=barber', 0, true, false), false);
  assert.equal(shouldRedirectEditorToWebsiteOnboarding('/editor', 0, false, false), true);
  assert.equal(shouldRedirectEditorToWebsiteOnboarding('/', 0, false, false), false);
});

test('App auth success keeps next=/editor on the editor instead of onboarding templates', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /resolvePostAuthDestination/);
  assert.match(source, /resolveLoggedInOwnerDestination/);
  assert.match(source, /setCurrentViewState\(\(view\) => \(view === 'templates' \|\| view === 'landing' \? 'wizard' : view\)\)/);
});
