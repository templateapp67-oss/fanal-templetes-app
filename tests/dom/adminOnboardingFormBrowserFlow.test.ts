// ============================================================================
// The PUBLIC manager onboarding form — DOM-level click verification.
//
// A real Chromium cannot be installed in this sandbox, so this file mounts the
// REAL AdminManagerOnboardingForm with react-dom/client into jsdom and
// dispatches REAL input/submit events. It proves the wiring the shared link
// depends on:
//
//   • a dead link (not found / expired / revoked / used) renders the refusal
//     copy and NEVER the form — a candidate must not fill in 20 fields only to
//     be refused at the end;
//   • the area and role shown come from the LINK, not from the URL;
//   • field-level validation: submitting an empty form puts the message under
//     the offending input, and the formats SQL also checks agree with the
//     client (Aadhaar 12 digits, PAN, IFSC);
//   • a refusal the SERVER raises on a specific field is placed under that
//     field, not just as a banner;
//   • a successful submission shows the "with the Super Admin for verification"
//     state and the form is gone, so it cannot be sent twice.
// ============================================================================

import './jsdomSetup';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { dom } from './jsdomSetup';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  AdminManagerOnboardingForm,
  validateManagerApplication,
} from '../../src/components/admin/AdminManagerOnboardingForm';

after(() => {
  try {
    dom.window.close();
  } catch {
    // already closed
  }
});

const TOKEN = 'tok_'.padEnd(40, 'x');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type FetchCall = { url: string; method: string; body: any };

/**
 * Install a fetch stub for the endpoints the public form uses and record every
 * request, so the assertions cover what the browser would actually send. The
 * component calls the global `fetch`, so both scopes are replaced.
 */
function stubFetch(handlers: {
  link?: () => Response | Promise<Response>;
  submit?: (body: any) => Response | Promise<Response>;
}) {
  const calls: FetchCall[] = [];
  const originalGlobal = globalThis.fetch;
  const originalWindow = (dom.window as any).fetch;
  const stub = (async (input: any, init: any = {}) => {
    const url = String(input);
    const method = init.method || 'GET';
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : null });
    if (url.includes('/api/public/manager-onboarding/')) {
      if (method === 'POST') {
        return handlers.submit
          ? handlers.submit(calls[calls.length - 1].body)
          : jsonResponse({ data: { id: 'app-1', status: 'pending', work_area: 'Malviya Nagar' } }, 201);
      }
      return handlers.link
        ? handlers.link()
        : jsonResponse({ data: { valid: true, work_area: 'Malviya Nagar', role: 'area_manager' } });
    }
    return jsonResponse({ data: {} });
  }) as any;
  globalThis.fetch = stub;
  (dom.window as any).fetch = stub;
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalGlobal;
      (dom.window as any).fetch = originalWindow;
    },
  };
}

async function mountForm(): Promise<{ container: HTMLElement; unmount: () => void }> {
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(AdminManagerOnboardingForm, { token: TOKEN }));
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function fieldLabel(container: HTMLElement, labelText: string): HTMLLabelElement {
  const label = Array.from(container.querySelectorAll('label')).find((node) =>
    ((node.querySelector('span')?.textContent as string) || node.textContent || '').includes(labelText)
  );
  assert.ok(label, `expected a field labelled “${labelText}”`);
  return label as HTMLLabelElement;
}

function setInput(container: HTMLElement, labelText: string, value: string) {
  const label = fieldLabel(container, labelText);
  const input = label.querySelector('input') as HTMLInputElement;
  assert.ok(input, `expected an input inside “${labelText}”`);
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  return input;
}

async function submit(container: HTMLElement) {
  const form = container.querySelector('form');
  assert.ok(form, 'expected the application form');
  await act(async () => {
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });
}

test('a valid link renders the form with the area and role FROM THE LINK', async () => {
  const stub = stubFetch({});
  const { container, unmount } = await mountForm();
  try {
    const text = container.textContent || '';
    assert.match(text, /Manager onboarding/);
    assert.match(text, /Malviya Nagar/, 'the territory comes from the link row');
    assert.match(text, /Area Manager/, 'so does the role');
    assert.ok(container.querySelector('form'), 'the candidate can apply');
    assert.ok(stub.calls[0].url.includes(TOKEN), 'the token is what was checked');
  } finally {
    stub.restore();
    unmount();
  }
});

test('a sub_admin link says Sub Admin, not Area Manager', async () => {
  const stub = stubFetch({
    link: () => jsonResponse({ data: { valid: true, work_area: 'Vaishali Nagar', role: 'sub_admin' } }),
  });
  const { container, unmount } = await mountForm();
  try {
    const text = container.textContent || '';
    assert.match(text, /Vaishali Nagar/);
    assert.match(text, /Sub Admin/);
    assert.equal(/Area Manager/.test(text), false, 'the wrong role name must not be shown');
  } finally {
    stub.restore();
    unmount();
  }
});

test('a dead link explains itself and never shows the form', async () => {
  const deadLinks: Array<[string, RegExp]> = [
    ['not_found', /does not exist/],
    ['expired', /expired/],
    ['revoked', /revoked/],
    ['already_used', /already been used/],
  ];
  for (const [reason, expected] of deadLinks) {
    const stub = stubFetch({ link: () => jsonResponse({ data: { valid: false, reason } }) });
    const { container, unmount } = await mountForm();
    try {
      const text = container.textContent || '';
      assert.match(text, /cannot be used/, `${reason} renders the refusal state`);
      assert.match(text, expected, `${reason} explains why`);
      assert.equal(container.querySelector('form'), null, `${reason} must not render the form`);
    } finally {
      stub.restore();
      unmount();
    }
  }
});

test('a refused link check (server error) also hides the form', async () => {
  const stub = stubFetch({ link: () => jsonResponse({ error: { code: 'not_found', message: 'This onboarding link does not exist.' } }, 404) });
  const { container, unmount } = await mountForm();
  try {
    const text = container.textContent || '';
    assert.match(text, /cannot be used/);
    assert.equal(container.querySelector('form'), null);
  } finally {
    stub.restore();
    unmount();
  }
});

test('submitting an empty form puts each message under its own field', async () => {
  const stub = stubFetch({});
  const { container, unmount } = await mountForm();
  try {
    await submit(container);
    const text = container.textContent || '';
    assert.match(text, /Full name is required/);
    assert.match(text, /Enter a valid email address/);
    assert.match(text, /Enter a valid 10-digit phone number/);
    assert.equal(stub.calls.some((call) => call.method === 'POST'), false, 'nothing was submitted');

    // Malformed-but-present values are caught client-side too, under their fields.
    setInput(container, 'Aadhaar number', '1234');
    setInput(container, 'PAN card number', 'ABCDE12');
    setInput(container, 'IFSC', 'HDFC123');
    await submit(container);
    assert.match(fieldLabel(container, 'Aadhaar number').textContent || '', /must be exactly 12 digits/);
    assert.match(fieldLabel(container, 'PAN card number').textContent || '', /must look like ABCDE1234F/);
    assert.match(fieldLabel(container, 'IFSC').textContent || '', /must look like HDFC0001234/);
    assert.equal(stub.calls.some((call) => call.method === 'POST'), false, 'still nothing submitted');

    // Correct values clear the errors.
    setInput(container, 'Aadhaar number', '1234 5678 9012');
    setInput(container, 'PAN card number', 'abcde1234f');
    setInput(container, 'IFSC', 'hdfc0001234');
    await submit(container);
    assert.equal(/must be exactly 12 digits/.test(container.textContent || ''), false);
    assert.equal(/must look like ABCDE1234F/.test(container.textContent || ''), false);
  } finally {
    stub.restore();
    unmount();
  }
});

test('a valid form submits the normalised payload and shows the verification state', async () => {
  let submitted: any = null;
  const stub = stubFetch({
    submit: (body) => {
      submitted = body;
      return jsonResponse({ data: { id: 'app-42', status: 'pending', work_area: 'Malviya Nagar' } }, 201);
    },
  });
  const { container, unmount } = await mountForm();
  try {
    setInput(container, 'Full name', 'Anil Kumar');
    setInput(container, 'Email address', 'ANIL@Example.com');
    setInput(container, 'Phone number', '98765 43210');
    setInput(container, 'Aadhaar number', '1234 5678 9012');
    setInput(container, 'PAN card number', 'abcde1234f');
    setInput(container, 'IFSC', 'hdfc0001234');
    await submit(container);

    assert.deepEqual(
      {
        full_name: submitted.full_name,
        email: submitted.email,
        phone: submitted.phone,
        aadhaar_number: submitted.aadhaar_number,
        pan_number: submitted.pan_number,
        bank_ifsc: submitted.bank_ifsc,
      },
      {
        full_name: 'Anil Kumar',
        email: 'anil@example.com',
        phone: '9876543210',
        aadhaar_number: '123456789012',
        pan_number: 'ABCDE1234F',
        bank_ifsc: 'HDFC0001234',
      },
      'the browser normalises before sending, exactly like the SQL does'
    );
    assert.equal(stub.calls.filter((call) => call.method === 'POST').length, 1, 'sent exactly once');
    assert.match(container.textContent || '', /Application submitted/);
    assert.match(container.textContent || '', /with the Super Admin for verification/);
    assert.equal(container.querySelector('form'), null, 'the form is replaced, so it cannot be sent twice');
  } finally {
    stub.restore();
    unmount();
  }
});

test('a server refusal naming a field is placed under that field', async () => {
  const stub = stubFetch({
    submit: () =>
      jsonResponse({ error: { code: '22023', message: 'PAN must look like ABCDE1234F' } }, 400),
  });
  const { container, unmount } = await mountForm();
  try {
    setInput(container, 'Full name', 'Anil Kumar');
    setInput(container, 'Email address', 'anil@example.com');
    setInput(container, 'Phone number', '9876543210');
    await submit(container);
    assert.match(fieldLabel(container, 'PAN card number').textContent || '', /PAN must look like ABCDE1234F/);
  } finally {
    stub.restore();
    unmount();
  }
});

test('validateManagerApplication mirrors the SQL rules', () => {
  const base = {
    full_name: 'Anil Kumar',
    email: 'anil@example.com',
    phone: '9876543210',
    whatsapp: '',
    aadhaar_number: '',
    pan_number: '',
    bank_account_name: '',
    bank_account_number: '',
    bank_ifsc: '',
    upi_id: '',
  };
  assert.deepEqual(validateManagerApplication(base), {}, 'a clean form has no errors');
  assert.equal(validateManagerApplication({ ...base, email: 'nope' }).email, 'Enter a valid email address.');
  assert.equal(validateManagerApplication({ ...base, aadhaar_number: '123' }).aadhaar_number, 'Aadhaar number must be exactly 12 digits.');
  assert.equal(validateManagerApplication({ ...base, pan_number: 'abcdefghij' }).pan_number, 'PAN must look like ABCDE1234F.');
  assert.equal(validateManagerApplication({ ...base, bank_ifsc: 'HDFC0001' }).bank_ifsc, 'IFSC must look like HDFC0001234.');
  assert.equal(validateManagerApplication({ ...base, whatsapp: '12' }).whatsapp, 'Enter a valid WhatsApp number.');
  assert.equal(validateManagerApplication({ ...base, bank_account_number: '123' }).bank_account_number, 'Account number must be at least 6 digits.');
});
