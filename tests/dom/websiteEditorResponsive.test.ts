// ============================================================================
// Responsive layout contract for the Website Editor and the Live Preview.
//
// A real browser cannot be installed in this sandbox, so these tests assert
// the layout INVARIANTS that made the mobile screenshot break, straight off
// the rendered DOM + className strings:
//
//   • nothing in the owner toolbar or the editor shell declares a fixed pixel
//     width (the old `w-80`/`w-96` side rail and the unconstrained canvases
//     forced horizontal scrolling on a phone),
//   • the control toolbars wrap (`flex-wrap`) instead of overrunning,
//   • the horizontal-overflow guards (`max-w-full`, `overflow-x-clip`,
//     `overflow-x-hidden`) are present on both shells and the preview canvas,
//   • desktop-only chrome (the side customizer rail, the customizer label)
//     collapses below `md`,
//   • every dialog stays inside the viewport (a min(…, 95vw) width cap,
//     `mx-auto`, and a `dvh` height cap).
//
// They mount the REAL components with react-dom/client into jsdom; a Tailwind
// class is only meaningful if the element actually renders with it.
// ============================================================================

import './jsdomSetup';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFile } from 'node:fs/promises';

// The preview derives its hero styling from the cover image and preloads it
// with `new Image()`. jsdom exposes the class on the window; the bare global is
// not defined by the shared setup, and leaving it undefined turns a late image
// preload into an unhandled rejection after the test ends.
const jsdomWindow = (globalThis as any).window;
if (jsdomWindow?.Image && typeof (globalThis as any).Image === 'undefined') {
  (globalThis as any).Image = jsdomWindow.Image;
}

// jsdom does not implement the <dialog> top-layer API. The component calls it
// on open; the stubs keep the REAL element (and its classes) in the DOM.
const dialogProto = (globalThis as any).window?.HTMLDialogElement?.prototype;
if (dialogProto && typeof dialogProto.showModal !== 'function') {
  dialogProto.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  dialogProto.close = function close() {
    this.removeAttribute('open');
  };
}

import { WebsiteEditor } from '../../src/components/WebsiteEditor';
import { SalonWebsitePreview } from '../../src/components/SalonWebsitePreview';
import { SidePanelCustomizer } from '../../src/components/SidePanelCustomizer';
import { WebsiteSavedModal } from '../../src/components/WebsiteSavedModal';
import { AIBioModal } from '../../src/components/AIBioModal';
import { INITIAL_SALON_PROFILE, INITIAL_SERVICES, INITIAL_STYLISTS } from '../../src/mockData';

after(() => {
  /* jsdomSetup owns the window lifetime */
});

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

/** Every class token of an element, as a Set. */
function classes(el: Element): Set<string> {
  return new Set((el.getAttribute('class') || '').split(/\s+/).filter(Boolean));
}

/**
 * A fixed pixel width wider than a phone viewport, e.g. `w-[1200px]`,
 * `min-w-[860px]`. Responsive `max-w-[…]` clamps and small icon sizes are not
 * matches — only widths that can outgrow a 360–430px screen.
 */
function fixedWideWidths(el: Element): string[] {
  const found: string[] = [];
  for (const token of classes(el)) {
    // `w-[…]` / `min-w-[…]` only. `max-w-[…]` is a clamp: it can never make an
    // element wider than its parent, so it is exactly the fix, not a defect.
    const match = /^(?:min-)?w-\[(\d+)px\]$/.exec(token);
    if (match && Number(match[1]) > 430) found.push(token);
  }
  return found;
}

function assertNoFixedWideWidths(root: Element, label: string) {
  const offenders: string[] = [];
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const token of fixedWideWidths(el)) {
      offenders.push(`${el.tagName.toLowerCase()}.${token}`);
    }
  }
  assert.deepEqual(offenders, [], `${label} must not declare a phone-overflowing fixed width`);
}

function mountEditor() {
  return mount(
    React.createElement(WebsiteEditor, {
      profile: INITIAL_SALON_PROFILE,
      setProfile: () => {},
      services: INITIAL_SERVICES,
      setServices: () => {},
      saveStatus: 'idle' as any,
      lastSavedAt: null,
      onComplete: () => {},
      siteUrl: 'https://example.test/salon',
      onSave: async () => true,
      onBackToDashboard: () => {},
      showToast: () => {},
      isAuthenticated: true,
      onRequireAuth: () => {},
    })
  );
}

function mountPreview(publicView: boolean) {
  return mount(
    React.createElement(SalonWebsitePreview, {
      profile: INITIAL_SALON_PROFILE,
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

test('the editor shell and its sticky save bar are width-safe on a phone', () => {
  const { container, root } = mountEditor();
  try {
    const shell = container.firstElementChild as HTMLElement;
    assert.ok(shell, 'the editor must render a root element');
    const shellClasses = classes(shell);
    assert.ok(shellClasses.has('w-full'), 'the editor shell must stretch to the viewport');
    assert.ok(shellClasses.has('max-w-full'), 'the editor shell must cap at the viewport');
    assert.ok(
      shellClasses.has('overflow-x-clip') || shellClasses.has('overflow-x-hidden'),
      'the editor shell must clip horizontal overflow'
    );

    const grid = shell.firstElementChild as HTMLElement;
    const gridClasses = classes(grid);
    assert.ok(gridClasses.has('w-full') && gridClasses.has('max-w-full'), 'content column must be fluid');
    assert.ok(gridClasses.has('px-4') && gridClasses.has('md:px-6'), 'content column needs responsive padding');

    // The save bar wraps its status pill + actions rather than squeezing them.
    const actionsRow = Array.from(shell.querySelectorAll('div')).find((el) =>
      classes(el).has('flex-wrap') && classes(el).has('gap-2') && el.querySelector('[role="status"]')
    );
    assert.ok(actionsRow, 'the save-bar actions row must wrap (flex-wrap)');

    assertNoFixedWideWidths(shell, 'WebsiteEditor');
  } finally {
    unmount(container, root);
  }
});

test('the live preview toolbar wraps its controls and clips the canvas', () => {
  const { container, root } = mountPreview(false);
  try {
    const shell = container.firstElementChild as HTMLElement;
    const shellClasses = classes(shell);
    assert.ok(shellClasses.has('w-full') && shellClasses.has('max-w-full'), 'preview shell must be fluid');
    assert.ok(
      shellClasses.has('overflow-x-clip') || shellClasses.has('overflow-x-hidden'),
      'the preview shell must clip horizontal overflow'
    );

    // Owner toolbar: sticky only from md up, and full width below it.
    const toolbar = shell.querySelector('.md\\:sticky') as HTMLElement | null;
    assert.ok(toolbar, 'the owner toolbar must be sticky only from md up');
    assert.ok(classes(toolbar!).has('w-full') && classes(toolbar!).has('max-w-full'));

    // Every control cluster in the toolbar wraps.
    const clusters = Array.from(toolbar!.querySelectorAll('div')).filter((el) =>
      classes(el).has('flex-wrap')
    );
    assert.ok(clusters.length >= 2, 'toolbar control clusters must use flex-wrap');

    // Canvas: full width, clipped, never wider than the viewport.
    const canvas = shell.querySelector('#salon-website-canvas') as HTMLElement | null;
    assert.ok(canvas, 'the preview canvas must render');
    const canvasClasses = classes(canvas!);
    for (const expected of ['w-full', 'max-w-full', 'overflow-x-hidden', 'min-w-0']) {
      assert.ok(canvasClasses.has(expected), `canvas is missing ${expected}`);
    }

    assertNoFixedWideWidths(shell, 'SalonWebsitePreview');
  } finally {
    unmount(container, root);
  }
});

test('the side customizer collapses from a right rail into a bottom sheet below md', () => {
  const { container, root } = mount(
    React.createElement(SidePanelCustomizer, {
      isOpen: true,
      onToggle: () => {},
      profile: INITIAL_SALON_PROFILE,
      setProfile: () => {},
      selectedCategoryKey: 'default' as any,
      selectedAccentKey: 'rose' as any,
      setSelectedAccentKey: () => {},
      primaryAccentColor: '#C20E5A',
      isDarkCanvas: false,
      setIsDarkCanvas: () => {},
      sectionVisibility: {} as any,
      setSectionVisibility: () => {},
      services: INITIAL_SERVICES,
      setServices: () => {},
    } as any)
  );
  try {
    const panel = container.querySelector('#side-panel-customizer') as HTMLElement | null;
    assert.ok(panel, 'the customizer panel must render when open');
    const panelClasses = classes(panel!);
    assert.ok(panelClasses.has('inset-x-0') && panelClasses.has('bottom-0'), 'mobile: pinned to the bottom edge');
    assert.ok(panelClasses.has('w-full'), 'mobile: full viewport width');
    assert.ok(panelClasses.has('max-h-[85dvh]'), 'mobile: capped to the viewport height');
    assert.ok(panelClasses.has('rounded-t-2xl'), 'mobile: bottom-sheet affordance');
    // Desktop restores the rail.
    for (const expected of ['md:w-96', 'md:right-0', 'md:top-20', 'md:bottom-0']) {
      assert.ok(panelClasses.has(expected), `desktop rail is missing ${expected}`);
    }
    // Not a fixed 320px rail on phones any more.
    assert.ok(!panelClasses.has('w-80'), 'the panel must not force a 320px width on phones');

    // Desktop-only labels inside the panel collapse on narrow screens.
    const tabLabels = Array.from(panel!.querySelectorAll('span')).filter((el) =>
      /text-\[9px\]/.test(el.getAttribute('class') || '')
    );
    assert.ok(tabLabels.length >= 7, 'the seven customizer tabs must render');
    for (const label of tabLabels) {
      assert.ok(classes(label).has('min-[380px]:inline'), 'tab labels must be hidden on the narrowest phones');
    }
  } finally {
    unmount(container, root);
  }
});

test('the save notification, profile settings and AI dialogs fit inside 95vw', async () => {
  // WebsiteSavedModal renders in the top layer via <dialog>; assert its class
  // contract directly from the rendered element.
  const saved = mount(
    React.createElement(WebsiteSavedModal, {
      isOpen: true,
      onClose: () => {},
      siteUrl: 'https://example.test/salon',
    } as any)
  );
  try {
    const dialog = saved.container.querySelector('dialog') as HTMLElement | null;
    assert.ok(dialog, 'the saved-notification dialog must render');
    const dialogClasses = classes(dialog!);
    assert.ok(dialogClasses.has('max-w-[min(32rem,95vw)]'), 'the dialog must cap at 95vw');
    assert.ok(dialogClasses.has('max-h-[calc(100dvh-2rem)]'), 'the dialog must cap at the viewport height');
  } finally {
    unmount(saved.container, saved.root);
  }

  const bio = mount(
    React.createElement(AIBioModal, {
      isOpen: true,
      onClose: () => {},
      initialText: '',
      onApply: () => {},
    } as any)
  );
  try {
    const dialog = bio.container.querySelector('[role="dialog"], div') as HTMLElement | null;
    const card = Array.from(bio.container.querySelectorAll('div')).find((el) =>
      classes(el).has('max-w-[min(600px,95vw)]')
    );
    assert.ok(card, 'the AI dialog must cap at 95vw');
    assert.ok(classes(card!).has('mx-auto'), 'the AI dialog must stay centred');
    assert.ok(dialog, 'the AI dialog must render');
  } finally {
    unmount(bio.container, bio.root);
  }

  // Profile Settings is mounted from App.tsx; its sizing contract is asserted
  // from source (mounting App would boot the whole auth/save stack).
  const source = await readFile(new URL('../../src/components/UserProfileSettingsModal.tsx', import.meta.url), 'utf8');
  assert.match(source, /max-w-\[min\(36rem,95vw\)\]/, 'Profile Settings must cap at 95vw');
  assert.match(source, /mx-auto/, 'Profile Settings must stay centred');
  assert.match(source, /max-h-\[90dvh\]/, 'Profile Settings must cap at the viewport height');
  assert.match(source, /overflow-y-auto/, 'the Profile Settings backdrop must scroll on short screens');

  // The global save/error toast (App.tsx) must wrap inside the viewport: its
  // session-expired message is long enough to push a phone sideways when it is
  // laid out at its natural width.
  const app = await readFile(new URL('../../src/App.tsx', import.meta.url), 'utf8');
  const toastShell = app.match(/className="pointer-events-none fixed inset-x-0[^"]*"/)?.[0] || '';
  assert.match(toastShell, /fixed inset-x-0 bottom-6/, 'the toast must be pinned across the viewport');
  assert.match(toastShell, /flex justify-center px-4/, 'the toast must be centred inside a padded gutter');
  assert.match(app, /<span className="min-w-0 break-words">\{toast\.message\}<\/span>/, 'toast copy must wrap');
});

test('no editor or preview source file declares a desktop-fixed container', async () => {
  for (const relative of [
    '../../src/components/WebsiteEditor.tsx',
    '../../src/components/SalonWebsitePreview.tsx',
    '../../src/components/SidePanelCustomizer.tsx',
  ]) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    // Class token by class token, so the responsive `max-w-[…]` clamps that
    // ARE the fix are never mistaken for the fixed widths they replace.
    const offenders = (source.match(/[^\s"'{:;]*w-\[\d+px\]/g) || []).filter(
      (token) => /^(?:min-)?w-\[\d+px\]$/.test(token) && Number(/\d+/.exec(token)![0]) > 430
    );
    assert.deepEqual(offenders, [], `${relative} must not declare fixed wide containers`);
  }
});

test('the public salon layout reserves dynamic content and uses stable viewport primitives', async () => {
  const preview = await readFile(new URL('../../src/components/SalonWebsitePreview.tsx', import.meta.url), 'utf8');
  const globalCss = await readFile(new URL('../../src/index.css', import.meta.url), 'utf8');

  assert.match(globalCss, /overflow-y:\s*scroll/, 'the vertical scrollbar gutter must always be reserved');
  assert.match(globalCss, /scrollbar-gutter:\s*stable/, 'supported browsers should use a stable scrollbar gutter');
  assert.match(globalCss, /html[\s\S]*body,[\s\S]*#root[\s\S]*overflow-x:\s*hidden/, 'document roots must prevent horizontal overflow');
  assert.doesNotMatch(preview, /min-h-screen|max-h-\[[0-9]+vh\]/, 'the salon preview must use dynamic viewport units');
  assert.match(preview, /data-layout-stable-location/, 'the changing location strip must reserve a stable footprint');
  assert.match(preview, /min-h-\[4\.75rem\]/, 'the location strip must fit both short and wrapped addresses');
  assert.match(preview, /data-layout-stable-media/, 'the videos and reels section must reserve space while media loads');
  assert.match(preview, /min-h-\[320px\][^"\n]*aspect-\[9\/16\]/, 'Shorts cards must keep a fixed 9:16 footprint');
  assert.match(preview, /layout-stable-fixed fixed bottom-6 right-6/, 'the floating WhatsApp action must be layout-contained');
});
