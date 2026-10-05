import './jsdomSetup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { CancellationPolicyModal } from '../../src/components/CancellationPolicyModal';

function salonLocalDateTime(ms: number) {
  const d = new Date(ms + 330 * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}
function bookingAt(msFromNow: number, advancePaid = 500) {
  const { date, time } = salonLocalDateTime(Date.now() + msFromNow);
  return { id: 'b1', salonId: 's1', salonName: 'Test Salon', currency: '₹', serviceName: 'Haircut', date, time, status: 'confirmed', advancePaid, totalAmount: 2000 };
}
async function mount(booking: any, cancelCalls: any[]) {
  const api: any = {
    getBooking: async () => ({ ok: true, data: booking, mode: 'live' }),
    cancelBooking: async (id: string, reason?: string) => {
      cancelCalls.push({ id, reason });
      return { ok: true, data: { ...booking, status: 'cancelled' }, mode: 'live' };
    },
  };
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const events = { closed: 0, cancelled: 0 };
  await act(async () => root.render(<CancellationPolicyModal open bookingId="b1" api={api} onClose={() => events.closed++} onCancelled={() => events.cancelled++} />));
  return { container, root, events, restore: async () => { await act(async () => root.unmount()); container.remove(); } };
}
function findButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes(label));
  assert.ok(button, `expected button: ${label}`);
  return button as HTMLButtonElement;
}

test('modal loads fresh booking, shows both rules and calculates the early refund', async () => {
  const m = await mount(bookingAt(48 * 3_600_000), []);
  try {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    const text = m.container.textContent || '';
    assert.match(text, /80% refund eligibility/);
    assert.match(text, /0% refund eligibility/);
    assert.match(text, /Keep Booking/);
    assert.match(text, /Cancel & Refund/);
    assert.equal(m.container.querySelector('[data-rule="early"]')?.getAttribute('data-active'), 'true');
    assert.match(m.container.querySelector('[data-testid="refund-amount"]')?.textContent || '', /400/);
    assert.match(text, /must process any eligible refund/);
  } finally { await m.restore(); }
});

test('inside 24 hours the zero-refund rule applies', async () => {
  const m = await mount(bookingAt(3 * 3_600_000), []);
  try {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    assert.equal(m.container.querySelector('[data-rule="late"]')?.getAttribute('data-active'), 'true');
    assert.match(m.container.querySelector('[data-testid="refund-amount"]')?.textContent || '', /^₹0$/);
  } finally { await m.restore(); }
});

test('Keep Booking does not cancel; confirmation posts cancellation and reports refund eligibility', async () => {
  const calls: any[] = [];
  const m = await mount(bookingAt(48 * 3_600_000), calls);
  try {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    await act(async () => { findButton(m.container, 'Keep Booking').click(); });
    assert.equal(m.events.closed, 1);
    assert.equal(calls.length, 0);
    await act(async () => { findButton(m.container, 'Cancel & Refund').click(); await new Promise(resolve => setTimeout(resolve, 10)); });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, 'b1');
    assert.equal(m.events.cancelled, 1);
  } finally { await m.restore(); }
});
