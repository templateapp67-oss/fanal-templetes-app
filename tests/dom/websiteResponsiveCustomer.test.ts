import './jsdomSetup';
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TemplateCustomerHub } from '../../src/components/TemplateCustomerHub';
import { useTemplateCustomerNavigation, readTemplateCustomerRequest, templateCustomerPath } from '../../src/lib/templateCustomerNavigation';
import { INITIAL_SALON_PROFILE, INITIAL_SERVICES } from '../../src/mockData';

window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
const profile = { ...INITIAL_SALON_PROFILE, subdomain: 'real-studio' };
const width = (value: number) => { Object.defineProperty(window, 'innerWidth', { configurable: true, value }); window.dispatchEvent(new Event('resize')); };

test('all customer links preserve tenant URL and back/forward restore full-page sections', async () => {
  width(1440); window.history.replaceState({}, '', '/?site=real-studio');
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  function Site() { const nav = useTemplateCustomerNavigation(); return React.createElement(React.Fragment, {}, React.createElement('header', {}, 'Salon header'), React.createElement('button', { onClick: () => nav.open('packages') }, 'Open packages'), React.createElement(TemplateCustomerHub, { request: nav.request, onClose: nav.close, onOpen: nav.open, onNavigate: nav.navigate, profile, services: INITIAL_SERVICES, previewMode: true, accentHex: '#0f172a', dark: false }), React.createElement('footer', {}, 'Salon footer')); }
  try {
    await act(async () => root.render(React.createElement(Site)));
    await act(async () => { node.querySelector('button')!.click(); await import('../../src/components/TemplateCustomerDemo'); });
    assert.ok(node.querySelector('[data-template-customer-page]')); assert.equal(document.querySelector('dialog[open]'), null);
    assert.equal(document.body.style.overflow, ''); assert.match(window.location.search, /site=real-studio/); assert.match(window.location.search, /customer=packages/);
    for (const label of ['My appointments','Favorites','My profile','Rewards','All services']) {
      const button = [...node.querySelectorAll<HTMLButtonElement>('aside button')].find(el => el.textContent === label)!;
      await act(async () => button.click()); assert.ok(node.querySelector('[data-template-customer-page]')); assert.ok(node.querySelector('footer'));
    }
    await act(async () => { window.history.replaceState({}, '', '/?site=real-studio&customer=wallet'); window.dispatchEvent(new window.PopStateEvent('popstate')); });
    assert.equal(node.querySelector('aside [aria-current="page"]')?.textContent, 'Rewards');
    await act(async () => { window.history.replaceState({}, '', '/?site=real-studio'); window.dispatchEvent(new window.PopStateEvent('popstate')); });
    assert.equal(node.querySelector('[data-template-customer-page]'), null);
  } finally { await act(async () => root.unmount()); node.remove(); window.history.replaceState({}, '', '/'); width(1024); }
});

test('mobile keeps modal, resize removes scroll lock and selects desktop page at 1024px', async () => {
  width(390); const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  const props = { request: { section: 'packages' as const }, onClose: () => {}, profile, services: INITIAL_SERVICES, previewMode: true, accentHex: '#0f172a', dark: false };
  try {
    await act(async () => root.render(React.createElement(TemplateCustomerHub, props)));
    assert.ok(document.querySelector('dialog[open]')); assert.equal(document.body.style.overflow, 'hidden');
    await act(async () => root.render(React.createElement(TemplateCustomerHub, { ...props, request: { section: 'wallet' as const } })));
    assert.ok(document.querySelector('dialog[open]'), 'changing mobile sections keeps the dialog open');
    await act(async () => width(1024)); assert.equal(document.querySelector('dialog[open]'), null); assert.ok(node.querySelector('[data-template-customer-page]')); assert.equal(document.body.style.overflow, '');
    await act(async () => width(1023)); assert.ok(document.querySelector('dialog[open]'));
  } finally { await act(async () => root.unmount()); node.remove(); width(1024); }
});

test('customer deep links distinguish services/packages and reject off-site paths', () => {
  assert.equal(readTemplateCustomerRequest('?customer=https://evil.example'), null);
  assert.equal(readTemplateCustomerRequest('?customer=/app/salon/real-studio/packages')?.section, 'packages');
  assert.equal(readTemplateCustomerRequest('?customer=/app/salon/real-studio/services')?.section, 'services');
  assert.equal(templateCustomerPath({ section: 'services' }, 'my studio'), '/app/salon/my%20studio/services');
  assert.deepEqual(readTemplateCustomerRequest('?customer=book&customerServices=one,two,one')?.serviceIds, ['one','two']);
});
