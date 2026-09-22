import type { Appointment } from '../types';

export const APPOINTMENT_CSV_HEADERS = [
  'Appointment ID',
  'Client Name',
  'Client Phone',
  'Service Name',
  'Service Price (INR)',
  'Stylist Name',
  'Date',
  'Time',
  'Payment Status',
  'Amount Paid (INR)',
  'Status'
] as const;

export function formatAppointmentsCsv(appointments: Appointment[]): string {
  const rows = appointments.map((apt) => [
    `"${apt.id}"`,
    `"${(apt.clientName || '').replace(/"/g, '""')}"`,
    `"${(apt.clientPhone || '').replace(/"/g, '""')}"`,
    `"${(apt.serviceName || '').replace(/"/g, '""')}"`,
    apt.servicePrice || 0,
    `"${(apt.stylistName || '').replace(/"/g, '""')}"`,
    `"${apt.date || ''}"`,
    `"${apt.time || ''}"`,
    `"${apt.paymentStatus || ''}"`,
    apt.amountPaid || 0,
    `"${apt.status || ''}"`
  ]);

  return [APPOINTMENT_CSV_HEADERS.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export function triggerAppointmentsCsvDownload(filename: string, csvContent: string): void {
  if (typeof document === 'undefined') return;
  try {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } else {
      const encodedUri = encodeURI(`data:text/csv;charset=utf-8,${csvContent}`);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  } catch (err) {
    console.error('Failed to trigger CSV download:', err);
  }
}
