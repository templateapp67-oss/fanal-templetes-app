import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAppointmentsCsv, APPOINTMENT_CSV_HEADERS } from '../src/lib/appointmentCsv';
import type { Appointment } from '../src/types';

function sampleAppointment(id: string, name: string, status: Appointment['status'] = 'confirmed'): Appointment {
  return {
    id,
    clientName: name,
    clientPhone: '+919876543210',
    clientEmail: 'test@example.com',
    serviceId: 'srv-1',
    serviceName: 'Hair Styling & Cut, Deluxe',
    servicePrice: 750,
    stylistId: 'st-1',
    stylistName: 'Priya "Senior" Sharma',
    date: '2026-09-22',
    time: '14:30',
    status,
    paymentStatus: 'paid_full',
    amountPaid: 750,
    createdAt: '2026-09-22T08:00:00Z',
  };
}

test('formatAppointmentsCsv outputs correct headers matching required schema', () => {
  const csv = formatAppointmentsCsv([]);
  assert.equal(csv, APPOINTMENT_CSV_HEADERS.join(','));
  assert.ok(csv.includes('Appointment ID'));
  assert.ok(csv.includes('Client Name'));
  assert.ok(csv.includes('Service Name'));
  assert.ok(csv.includes('Status'));
});

test('formatAppointmentsCsv correctly formats rows and escapes double quotes and commas', () => {
  const apt1 = sampleAppointment('apt-101', 'Rahul "Ace" Verma', 'confirmed');
  const apt2 = sampleAppointment('apt-102', 'Anita Roy', 'pending');
  const csv = formatAppointmentsCsv([apt1, apt2]);

  const lines = csv.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], APPOINTMENT_CSV_HEADERS.join(','));

  // Double quotes inside client name are properly escaped
  assert.ok(lines[1].includes('"Rahul ""Ace"" Verma"'));
  assert.ok(lines[1].includes('"Priya ""Senior"" Sharma"'));
  assert.ok(lines[1].includes('750'));
  assert.ok(lines[1].includes('"confirmed"'));

  assert.ok(lines[2].includes('"Anita Roy"'));
  assert.ok(lines[2].includes('"pending"'));
});

test('formatAppointmentsCsv only includes selected appointments when subset is filtered', () => {
  const apt1 = sampleAppointment('apt-1', 'Client One');
  const apt2 = sampleAppointment('apt-2', 'Client Two');
  const apt3 = sampleAppointment('apt-3', 'Client Three');
  const allAppointments = [apt1, apt2, apt3];

  const selectedIds = ['apt-1', 'apt-3'];
  const selectedSubset = allAppointments.filter((a) => selectedIds.includes(a.id));
  const csv = formatAppointmentsCsv(selectedSubset);

  const lines = csv.split('\n');
  assert.equal(lines.length, 3); // Header + 2 selected appointments
  assert.ok(csv.includes('"Client One"'));
  assert.ok(csv.includes('"Client Three"'));
  assert.ok(!csv.includes('"Client Two"'));
});
