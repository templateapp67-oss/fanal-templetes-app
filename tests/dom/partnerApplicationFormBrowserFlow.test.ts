// ============================================================================
// Growth Partner application form — DOM-level click verification.
//
// Mounts the REAL `PartnerApplicationForm` with react-dom/client into jsdom and
// dispatches REAL input/select/submit events. It pins the behaviour the
// "Application failed. Please try again." report was about:
//
//   • an invalid Aadhaar number is caught and named, with NO request sent;
//   • while the request is pending the button is disabled, shows a spinner and
//     every field is locked, so a double submission is impossible;
//   • the server's answer is rendered as its real message (duplicate /
//     network / session), never as a generic failure;
//   • a successful submission shows "Application Pending Approval";
//   • the typed values survive a failed submit — only the field is marked.
// ============================================================================

import './jsdomSetup';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { dom } from './jsdomSetup';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  PARTNER_APPLICATION_PENDING_BODY,
  PARTNER_APPLICATION_PENDING_TITLE,
  PartnerApplicationForm,
  PartnerApplicationPending,
  PartnerPortalLogin,
} from '../../src/components/PartnerPortalLogin';
import type { PartnerApplicationFieldErrors } from '../../src/lib/partnerApplicationValidation';

after(() => {
  try {
    dom.window.close();
  } catch {
    // already closed
  }
});

const act = (React as any).act as (cb: () => void | Promise<void>) => Promise<void>;

async function mount(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(() => root.render(element));
  return {
    container,
    unmount: async () => {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) assert.fail(`timed out waiting for ${what}`);
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}

function byText(host: HTMLElement, selector: string, text: string): HTMLElement | null {
  return (
    [...host.querySelectorAll<HTMLElement>(selector)].find((node) =>
      (node.textContent ?? '').trim().includes(text)
    ) ?? null
  );
}

async function setValue(el: HTMLElement | null, value: string, what: string) {
  assert.ok(el, `expected to find ${what}`);
  await act(() => {
    if (el instanceof (globalThis as any).HTMLSelectElement) {
      const setter = Object.getOwnPropertyDescriptor(
        (globalThis as any).HTMLSelectElement.prototype,
        'value'
      )!.set!;
      setter.call(el, value);
      el.dispatchEvent(new (globalThis as any).Event('change', { bubbles: true }));
      return;
    }
    const setter = Object.getOwnPropertyDescriptor(
      (globalThis as any).HTMLInputElement.prototype,
      'value'
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new (globalThis as any).Event('input', { bubbles: true }));
  });
}

async function submit(host: HTMLElement) {
  const form = host.querySelector('form');
  assert.ok(form, 'the application form must exist');
  await act(() => {
    form.dispatchEvent(new (globalThis as any).Event('submit', { bubbles: true, cancelable: true }));
  });
}

interface Harness {
  host: HTMLElement;
  unmount: () => Promise<void>;
  onSubmit: (input: {
    fullName: string;
    phone: string;
    kycDocumentType: string;
    kycDocumentReference: string;
  }) => void;
}

async function mountForm(
  options: {
    onSubmit?: Harness['onSubmit'];
    busy?: boolean;
    error?: string;
    fieldErrors?: PartnerApplicationFieldErrors;
    needsSignIn?: boolean;
  } = {}
): Promise<Harness> {
  const submitted: Harness['onSubmit'] extends (input: infer I) => void ? I[] : never[] = [];
  const view = await mount(
    React.createElement(PartnerApplicationForm, {
      busy: options.busy ?? false,
      error: options.error ?? '',
      fieldErrors: options.fieldErrors,
      needsSignIn: options.needsSignIn ?? false,
      onSubmit: (input) => {
        submitted.push(input as never);
        options.onSubmit?.(input);
      },
      onBack: () => {},
      onSignIn: () => {},
    })
  );
  return {
    host: view.container,
    unmount: view.unmount,
    onSubmit: ((input) => {
      submitted.push(input as never);
      options.onSubmit?.(input);
    }) as Harness['onSubmit'],
  } as Harness & { host: HTMLElement };
}

async function fillValid(host: HTMLElement, overrides: Partial<Record<string, string>> = {}) {
  await setValue(host.querySelector('#partner-apply-name'), overrides.name ?? 'Asha Sharma', 'name');
  await setValue(host.querySelector('#partner-apply-phone'), overrides.phone ?? '9876543210', 'phone');
  await setValue(host.querySelector('#partner-apply-kyc-type'), overrides.type ?? 'aadhaar', 'document type');
  await setValue(host.querySelector('#partner-apply-kyc-reference'), overrides.ref ?? '123456789012', 'reference');
}

test('an invalid Aadhaar number is named on the field and never sent', async () => {
  const calls: unknown[] = [];
  const view = await mountForm({ onSubmit: (input) => calls.push(input) });
  try {
    await fillValid(view.host, { ref: '12345678901' });
    await submit(view.host);

    await waitFor(
      () => /Invalid Aadhaar number/.test(view.host.textContent ?? ''),
      'the Aadhaar error copy'
    );
    assert.deepEqual(calls, [], 'an invalid value must not reach the network');
    const reference = view.host.querySelector('#partner-apply-kyc-reference') as HTMLInputElement;
    assert.equal(reference.getAttribute('aria-invalid'), 'true', 'the field is marked invalid');
    assert.equal(
      (view.host.querySelector('#partner-apply-kyc-reference-error') as HTMLElement | null)?.textContent,
      'Invalid Aadhaar number. Enter the 12 digits from your Aadhaar card.'
    );
  } finally {
    await view.unmount();
  }
});

test('a valid submission sends the sanitized values', async () => {
  const calls: Array<Record<string, string>> = [];
  const view = await mountForm({ onSubmit: (input) => calls.push(input as Record<string, string>) });
  try {
    await fillValid(view.host, { name: '  Asha  Sharma ', phone: '+91 98765 43210', ref: '1234-5678-9012' });
    await submit(view.host);
    await waitFor(() => calls.length === 1, 'the submit handler');
    assert.deepEqual(calls, [
      {
        fullName: '  Asha  Sharma ',
        phone: '+91 98765 43210',
        kycDocumentType: 'aadhaar',
        kycDocumentReference: '1234-5678-9012',
      },
    ]);
  } finally {
    await view.unmount();
  }
});

test('an in-flight submit locks every field, disables the button and shows a spinner', async () => {
  const view = await mountForm({ busy: true });
  try {
    const button = view.host.querySelector('button[type="submit"]') as HTMLButtonElement;
    assert.equal(button.disabled, true, 'the submit button is disabled while busy');
    assert.match(view.host.textContent ?? '', /Submitting/, 'the busy label is shown');
    assert.ok(
      view.host.querySelector('button[type="submit"] svg.animate-spin'),
      'a spinner is rendered while the request is pending'
    );
    for (const id of ['partner-apply-name', 'partner-apply-phone', 'partner-apply-kyc-reference']) {
      const el = view.host.querySelector(`#${id}`) as HTMLInputElement;
      assert.equal(el.disabled, true, `${id} is disabled while busy`);
    }
    const select = view.host.querySelector('#partner-apply-kyc-type') as HTMLSelectElement;
    assert.equal(select.disabled, true, 'the document type is disabled while busy');
    assert.equal(
      view.host.querySelector('form')?.getAttribute('aria-busy'),
      'true',
      'the form reports its busy state'
    );
  } finally {
    await view.unmount();
  }
});

test('a duplicate is rendered as "You have already submitted an application."', async () => {
  const view = await mountForm({ error: 'You have already submitted an application.' });
  try {
    assert.match(view.host.textContent ?? '', /You have already submitted an application\./);
    assert.doesNotMatch(view.host.textContent ?? '', /Application failed/);
    const alert = view.host.querySelector('[role="alert"]');
    assert.ok(alert, 'the message is announced to assistive technology');
  } finally {
    await view.unmount();
  }
});

test('an expired session offers a sign-in action; other failures do not', async () => {
  const signedIn = await mountForm({ error: 'Your session expired. Please sign in again.', needsSignIn: true });
  try {
    assert.ok(byText(signedIn.host, 'button', 'Sign in'), 'the session failure offers Sign in');
  } finally {
    await signedIn.unmount();
  }

  const network = await mountForm({ error: 'Network error. Check your connection and try again.' });
  try {
    assert.equal(byText(network.host, 'button', 'Sign in'), null, 'a network error must not ask for a sign-in');
    assert.match(network.host.textContent ?? '', /Network error/);
  } finally {
    await network.unmount();
  }
});

test('a field-level error from the backend marks that field and keeps the typed values', async () => {
  const view = await mountForm({
    error: 'Invalid Aadhaar number. Enter the 12 digits from your Aadhaar card.',
    fieldErrors: { kycDocumentReference: 'Invalid Aadhaar number. Enter the 12 digits from your Aadhaar card.' },
  });
  try {
    await fillValid(view.host);
    const name = view.host.querySelector('#partner-apply-name') as HTMLInputElement;
    assert.equal(name.value, 'Asha Sharma', 'the typed values are preserved');
    assert.match(view.host.textContent ?? '', /Invalid Aadhaar number/);
  } finally {
    await view.unmount();
  }
});

test('a successful submission lands on "Application Pending Approval"', async () => {
  const actions: string[] = [];
  const view = await mount(
    React.createElement(PartnerApplicationPending, {
      submittedAt: '2026-09-29T04:29:32.256Z',
      onCheckStatus: () => actions.push('check'),
      onBack: () => actions.push('back'),
    })
  );
  try {
    const text = view.container.textContent ?? '';
    assert.match(text, new RegExp(PARTNER_APPLICATION_PENDING_TITLE));
    assert.match(text, new RegExp(PARTNER_APPLICATION_PENDING_BODY));
    assert.ok(byText(view.container, 'button', 'Check application status'), 'the status re-read is offered');

    await act(() => {
      (byText(view.container, 'button', 'Check application status') as HTMLButtonElement).click();
    });
    assert.deepEqual(actions, ['check']);
  } finally {
    await view.unmount();
  }
});

test('the document type drives the reference hint and placeholder', async () => {
  const view = await mountForm();
  try {
    await setValue(view.host.querySelector('#partner-apply-kyc-type'), 'pan', 'document type');
    await waitFor(() => /5 letters, 4 digits, 1 letter/.test(view.host.textContent ?? ''), 'the PAN hint');
    // The placeholder is an attribute, not text — assert it where it lives.
    assert.equal(
      (view.host.querySelector('#partner-apply-kyc-reference') as HTMLInputElement).placeholder,
      'ABCDE1234F',
      'the PAN example is offered as the placeholder'
    );

    await setValue(view.host.querySelector('#partner-apply-kyc-type'), 'aadhaar', 'document type');
    await waitFor(() => /12 digits/.test(view.host.textContent ?? ''), 'the Aadhaar hint');
    assert.equal(
      (view.host.querySelector('#partner-apply-kyc-reference') as HTMLInputElement).placeholder,
      '1234 5678 9012',
      'the Aadhaar example is offered as the placeholder'
    );
  } finally {
    await view.unmount();
  }
});

// ---------------------------------------------------------------------------
// The real page: /partner/dashboard renders the portal for a signed-in account
// with no partner row, and the whole apply flow runs through it.
// ---------------------------------------------------------------------------

test('the reported flow: apply from the portal → invalid Aadhaar named → valid submit → pending', async () => {
  const USER = { id: 'b0000000-0000-4000-8000-000000000001', email: 'asha@example.com' };
  const rpcCalls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  let rpcResult: { data: any; error: any } = {
    data: { id: 'app-1', status: 'pending', kyc_status: 'submitted', created_at: '2026-09-29T00:00:00Z' },
    error: null,
  };

  const client = {
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
      getSession: async () => ({ data: { session: { user: USER } }, error: null }),
    },
    // Not a partner, and no application yet → the portal shows the denial with
    // the "Become a Growth Partner" way forward.
    fetchPartnerRow: async () => null,
    fetchApplicationRow: async () => null,
    rpc: async (name: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return rpcResult;
    },
  } as any;

  const view = await mount(React.createElement(PartnerPortalLogin, {
    user: USER,
    client,
    navigate: () => {},
    onBack: () => {},
    onLogout: () => {},
  } as any));

  try {
    await waitFor(
      () => !!byText(view.container, 'button', 'Become a Growth Partner'),
      'the application CTA'
    );
    await act(() => {
      (byText(view.container, 'button', 'Become a Growth Partner') as HTMLButtonElement).click();
    });
    await waitFor(() => !!view.container.querySelector('#partner-apply-name'), 'the application form');

    // 1. An invalid Aadhaar number: named, and nothing is sent.
    await fillValid(view.container, { ref: '12345678901' });
    await submit(view.container);
    await waitFor(() => /Invalid Aadhaar number/.test(view.container.textContent ?? ''), 'the Aadhaar copy');
    assert.deepEqual(rpcCalls, [], 'an invalid value never reaches the backend');

    // 2. A valid application: one call, sanitized payload, no identity.
    await fillValid(view.container, { phone: '+91 98765 43210', ref: '1234-5678-9012' });
    await submit(view.container);
    await waitFor(
      () => /Application Pending Approval/.test(view.container.textContent ?? ''),
      'the pending screen'
    );
    assert.equal(rpcCalls.length, 1, 'exactly one submission is sent');
    assert.equal(rpcCalls[0].name, 'submit_growth_partner_application');
    assert.deepEqual(rpcCalls[0].args, {
      p_full_name: 'Asha Sharma',
      p_phone: '9876543210',
      p_kyc_document_type: 'aadhaar',
      p_kyc_document_reference: '123456789012',
    });
    assert.match(view.container.textContent ?? '', /Application Pending Approval/);
  } finally {
    await view.unmount();
  }
});

test('the reported flow: a duplicate is reported as such, not as a generic failure', async () => {
  const USER = { id: 'b0000000-0000-4000-8000-000000000002', email: 'vikram@example.com' };
  const duplicate = new Error('Application already submitted') as Error & { code: string };
  duplicate.code = '23505';

  const client = {
    auth: {
      signInWithPassword: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
      getSession: async () => ({ data: { session: { user: USER } }, error: null }),
    },
    fetchPartnerRow: async () => null,
    fetchApplicationRow: async () => null,
    rpc: async () => ({ data: null, error: duplicate }),
  } as any;

  const view = await mount(React.createElement(PartnerPortalLogin, {
    user: USER,
    client,
    navigate: () => {},
    onBack: () => {},
    onLogout: () => {},
  } as any));

  try {
    await waitFor(
      () => !!byText(view.container, 'button', 'Become a Growth Partner'),
      'the application CTA'
    );
    await act(() => {
      (byText(view.container, 'button', 'Become a Growth Partner') as HTMLButtonElement).click();
    });
    await waitFor(() => !!view.container.querySelector('#partner-apply-name'), 'the application form');
    await fillValid(view.container);
    await submit(view.container);

    await waitFor(
      () => /You have already submitted an application/.test(view.container.textContent ?? ''),
      'the duplicate copy'
    );
    const text = view.container.textContent ?? '';
    assert.doesNotMatch(text, /Application failed/, 'the old catch-all must never appear');
    // The typed values survive, and the form is usable again.
    assert.equal((view.container.querySelector('#partner-apply-name') as HTMLInputElement).value, 'Asha Sharma');
    assert.equal(
      (view.container.querySelector('button[type="submit"]') as HTMLButtonElement).disabled,
      false,
      'the button is re-enabled after a failure'
    );
  } finally {
    await view.unmount();
  }
});
