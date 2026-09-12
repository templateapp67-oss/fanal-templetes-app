// ============================================================================
// jsdom bootstrap for DOM-level (click) tests.
//
// A real Chromium cannot be installed in this sandbox (the browser CDNs and the
// apt mirrors are unreachable), so these tests mount the REAL components with
// react-dom/client into jsdom and dispatch REAL click/input events. That covers
// what a browser would do for wiring — handlers firing, state updating, the
// right navigation callback being called — without pretending to be a pixel
// check. Imported for its side effects, and it must be the FIRST import in a
// test file so the globals exist before React and the components load.
// ============================================================================

import { JSDOM } from 'jsdom';

// Creating a Supabase client immediately tries to recover a session over the
// network. Against the placeholder host that DNS lookup never resolves, and the
// in-flight socket keeps the test process alive for minutes. Point it at a port
// that refuses instantly instead, so any stray request fails fast.
process.env.VITE_SUPABASE_URL = 'http://127.0.0.1:1';
process.env.VITE_SUPABASE_ANON_KEY = 'dom-test-anon-key';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:3000/',
  // No pretendToBeVisual: its requestAnimationFrame loop keeps the Node event
  // loop alive after the tests finish. The stubs below are enough for React.
});

const target = globalThis as Record<string, unknown>;

function define(name: string, value: unknown) {
  Object.defineProperty(target, name, { value, writable: true, configurable: true });
}

define('window', dom.window);
define('document', dom.window.document);
define('navigator', dom.window.navigator);
define('HTMLElement', dom.window.HTMLElement);
define('HTMLInputElement', dom.window.HTMLInputElement);
define('HTMLSelectElement', dom.window.HTMLSelectElement);
define('HTMLButtonElement', dom.window.HTMLButtonElement);
define('Element', dom.window.Element);
define('Node', dom.window.Node);
define('Event', dom.window.Event);
define('MouseEvent', dom.window.MouseEvent);
define('KeyboardEvent', dom.window.KeyboardEvent);
define('CustomEvent', dom.window.CustomEvent);
define('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
// A no-op rAF on purpose: the animation libs schedule rAF recursively, and a
// firing stub keeps the Node event loop alive after the tests finish (the run
// would never exit). Styles are the only thing animations change here.
define('requestAnimationFrame', () => 0);
define('cancelAnimationFrame', () => {});
// React 19 warns (and act() misbehaves) without this.
define('IS_REACT_ACT_ENVIRONMENT', true);

// Browser APIs the UI libs reach for; jsdom does not implement them.
const noop = () => {};
define('matchMedia', () => ({
  matches: false,
  media: '',
  onchange: null,
  addListener: noop,
  removeListener: noop,
  addEventListener: noop,
  removeEventListener: noop,
  dispatchEvent: () => false,
}));
define('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
define('IntersectionObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
});
(dom.window as any).Element.prototype.scrollIntoView = noop;

// No DOM test may reach the network: the mock Supabase client would otherwise
// open a real socket to the placeholder host and keep the event loop alive.
const noNetwork = () => Promise.reject(new Error('network disabled in DOM tests'));
define('fetch', noNetwork);
(dom.window as any).fetch = noNetwork;

export { dom };
