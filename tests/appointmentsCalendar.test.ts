// ============================================================================
// Calendar appointment form must book ONLY persisted backend catalogue
// records. Regression tests for the ID-mismatch class of bugs: dropdowns and
// payloads carrying editor ids, array indexes, slugs or placeholder ids
// ('srv-1', 'st-default', 'custom') that can never satisfy a database
// foreign key.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppointmentsCalendarView, buildAppointmentDraft } from '../src/components/AppointmentsCalendarView';
import type { Appointment, SalonService, Stylist } from '../src/types';

const SERVICE_DB_ID = '40000000-0000-4000-8000-000000000001';
const STAFF_DB_ID = '50000000-0000-4000-8000-000000000001';

const services: SalonService[] = [
  { id: SERVICE_DB_ID, name: 'Signature Cut', price: 500, durationMinutes: 45, description: '', category: '', icon: 'scissors' },
];
const stylists: Stylist[] = [
  { id: STAFF_DB_ID, name: 'Priya', role: 'Senior Stylist', avatarUrl: '', specialties: [], rating: 4.9 },
];

function renderCalendar(overrides: Partial<{ services: SalonService[]; stylists: Stylist[]; appointments: Appointment[] }> = {}) {
  return renderToStaticMarkup(
    React.createElement(AppointmentsCalendarView, {
      appointments: overrides.appointments ?? [],
      setAppointments: () => {},
      onCreate: async () => {},
      onUpdate: async () => {},
      saving: false,
      services: overrides.services ?? services,
      stylists: overrides.stylists ?? stylists,
    })
  );
}

/** An appointment exactly as the live dashboard endpoint maps a booking row. */
function liveAppointment(): Appointment {
  return {
    id: '9f2a8d54-5181-4fc2-b4ab-08d6c6f6bb7b',
    clientName: 'Backend Verification', clientPhone: '+919999888877', clientEmail: 'uma@example.com',
    serviceId: SERVICE_DB_ID, serviceName: 'Signature Cut', servicePrice: 500,
    stylistId: STAFF_DB_ID, stylistName: 'Priya',
    date: new Date().toISOString().slice(0, 10), time: '10:00',
    status: 'confirmed', paymentStatus: 'pay_at_salon', amountPaid: 0,
    createdAt: new Date().toISOString(),
  };
}

test('the calendar renders a saved backend appointment with its real catalogue data', () => {
  const html = renderCalendar({ appointments: [liveAppointment()] });
  // Display path: the booking's persisted snapshot (client, service, stylist)
  // renders — nothing from src/mockData.ts and no placeholder records.
  assert.ok(html.includes('Backend Verification'), 'client name missing');
  assert.ok(html.includes('Signature Cut'), 'service name missing');
  assert.ok(html.includes('Priya'), 'stylist name missing');
  for (const fingerprint of ['Arts By Uma', 'Master Stylist Precision Cut']) {
    assert.ok(!html.includes(fingerprint), 'calendar rendered mock data');
  }
});

test('the calendar renders an empty salon without inventing appointments', () => {
  const html = renderCalendar({ services: [], stylists: [], appointments: [] });
  assert.ok(!html.includes('Backend Verification'));
  for (const fingerprint of ['Arts By Uma', 'Master Stylist Precision Cut']) {
    assert.ok(!html.includes(fingerprint), 'calendar rendered mock data');
  }
});

test('the appointment draft uses the persisted service and staff database ids', () => {
  const draft = buildAppointmentDraft({
    reference: '9f2a8d54-5181-4fc2-b4ab-08d6c6f6bb7b',
    clientName: 'Backend Verification',
    clientPhone: '+919999888877',
    clientEmail: 'uma@example.com',
    serviceId: SERVICE_DB_ID,
    stylistId: STAFF_DB_ID,
    date: '2026-09-12',
    time: '10:00',
    paymentStatus: 'pay_at_salon',
    services,
    stylists,
  });
  assert.equal(draft.ok, true);
  if (draft.ok === true) {
    assert.equal(draft.appointment.serviceId, SERVICE_DB_ID);
    assert.equal(draft.appointment.stylistId, STAFF_DB_ID);
    assert.equal(draft.appointment.clientName, 'Backend Verification');
    assert.equal(draft.appointment.status, 'confirmed');
    assert.equal(draft.appointment.paymentStatus, 'pay_at_salon');
    assert.equal(draft.appointment.amountPaid, 0);
  }
});

test('a missing catalogue record is an error — never a silent substitution', () => {
  // Selected service id no longer in the saved catalogue (deleted after the
  // form opened): the draft must refuse, not fall back to services[0].
  const staleService = buildAppointmentDraft({
    reference: 'ref', clientName: 'X', clientPhone: '123',
    serviceId: '40000000-0000-4000-8000-0000000000ff', stylistId: STAFF_DB_ID,
    date: '2026-09-12', time: '10:00', paymentStatus: 'pay_at_salon', services, stylists,
  });
  assert.equal(staleService.ok, false);
  if (staleService.ok === false) assert.match(staleService.error, /service is no longer available/);

  const staleStaff = buildAppointmentDraft({
    reference: 'ref', clientName: 'X', clientPhone: '123',
    serviceId: SERVICE_DB_ID, stylistId: 'st-default',
    date: '2026-09-12', time: '10:00', paymentStatus: 'pay_at_salon', services, stylists,
  });
  assert.equal(staleStaff.ok, false);
  if (staleStaff.ok === false) assert.match(staleStaff.error, /specialist is no longer available/);

  const emptyCatalogue = buildAppointmentDraft({
    reference: 'ref', clientName: 'X', clientPhone: '123',
    serviceId: SERVICE_DB_ID, stylistId: STAFF_DB_ID,
    date: '2026-09-12', time: '10:00', paymentStatus: 'pay_at_salon', services: [], stylists: [],
  });
  assert.equal(emptyCatalogue.ok, false);
  if (emptyCatalogue.ok === false) assert.match(emptyCatalogue.error, /Save at least one service and one specialist/);
});
