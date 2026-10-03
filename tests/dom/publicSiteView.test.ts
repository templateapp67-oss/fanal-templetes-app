// ============================================================================
// PUBLIC SALON SITE (`/?site=slug`) — customer-facing rendering contract.
//
// The public site is the only surface a customer ever sees, so it must never
// leak the owner's editing UI. The location card used to render
// `InteractiveMapSetup` for everybody: visitors were shown a
// "Salon Address & Localization Setup" form with address inputs, a
// "Use Current Location" button, and — because that component falls back to a
// hard-coded Mumbai address — a salon address the owner never entered.
//
// These tests mount the REAL preview component and assert what a visitor can
// and cannot see.
// ============================================================================

import './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SalonWebsitePreview } from '../../src/components/SalonWebsitePreview';
import { INITIAL_SALON_PROFILE, INITIAL_SERVICES, INITIAL_STYLISTS } from '../../src/mockData';
import type { SalonProfile } from '../../src/types';

after(() => {
  /* jsdomSetup owns the window lifetime */
});

const jsdomWindow = (globalThis as any).window;
if (jsdomWindow?.Image && typeof (globalThis as any).Image === 'undefined') {
  (globalThis as any).Image = jsdomWindow.Image;
}

function mount(element: React.ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, root };
}

function unmount(container: HTMLElement, root: Root) {
  act(() => root.unmount());
  container.remove();
}

/** A published salon with no map pin — the common case for a fresh site. */
const publicProfile: SalonProfile = {
  ...INITIAL_SALON_PROFILE,
  businessName: 'Star Salon',
  city: 'Jaipur',
  address: '',
  latitude: undefined,
  longitude: undefined,
};

function mountPreview(publicView: boolean) {
  return mount(
    React.createElement(SalonWebsitePreview, {
      profile: publicView ? publicProfile : INITIAL_SALON_PROFILE,
      setProfile: () => {},
      services: INITIAL_SERVICES,
      setServices: () => {},
      stylists: INITIAL_STYLISTS,
      setStylists: () => {},
      onAddAppointment: () => {},
      user: publicView ? null : ({ id: '10000000-0000-4000-8000-000000000001' } as any),
      onRequireAuth: () => {},
      siteUrl: 'https://example.test/salon',
      publicView,
    })
  );
}

test('a visitor never sees the owner address form or an invented salon address', () => {
  const { container, root } = mountPreview(true);
  try {
    const text = container.textContent || '';
    assert.doesNotMatch(text, /Salon Address & Localization Setup/, 'owner setup form must be owner-only');
    assert.doesNotMatch(text, /Use Current Location/);
    assert.doesNotMatch(text, /Google Places Autocomplete/);
    assert.doesNotMatch(text, /Confirm Address & Place Marker Pin/);
    // The old component's hard-coded Mumbai fallback leaked onto public sites.
    assert.doesNotMatch(text, /Linking Road/);
    assert.doesNotMatch(text, /Santa Cruz West/);
    // …and the visitor still gets the way to the salon.
    assert.match(text, /Star Salon/);
    const mapsLinks = Array.from(container.querySelectorAll('a[href*="google.com/maps"]'));
    assert.ok(mapsLinks.length >= 2, 'the public card keeps View on Google Maps + Get Directions');
    for (const link of mapsLinks) {
      assert.equal(link.getAttribute('target'), '_blank');
      assert.match(link.getAttribute('rel') || '', /noreferrer/);
    }
  } finally {
    unmount(container, root);
  }
});

test('the owner editor keeps the editable map setup', () => {
  const { container, root } = mountPreview(false);
  try {
    const edit = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Inline Edit Mode'));
    assert.ok(edit);
    act(() => edit.click());
    assert.match(container.textContent || '', /Salon Address & Localization Setup/, 'editing the owner preview exposes the location form');
  } finally {
    unmount(container, root);
  }
});

test('blank published cover uses the selected template image and does not claim demo verification or ratings', () => {
 const {container,root}=mount(React.createElement(SalonWebsitePreview,{
  profile:{...publicProfile,coverImageUrl:'',isVerified:false},services:INITIAL_SERVICES,stylists:INITIAL_STYLISTS,
  selectedTemplateId:'luxury_hair_salon',onAddAppointment:()=>{},onRequireAuth:()=>{},publicView:true,
 }));
 try {
  const text=container.textContent || '';
  assert.doesNotMatch(text,/Verified Indian Salon|980\+/);
  assert.ok([...container.querySelectorAll('img')].every(img=>img.getAttribute('src')?.trim()),'every image has a usable source');
  assert.match(text,/No reviews yet/);
 } finally {unmount(container,root);}
});
