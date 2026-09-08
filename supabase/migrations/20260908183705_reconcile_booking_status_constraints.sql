-- Unify the normalized booking lifecycle and the older reschedule workflow.
-- Existing rows are preserved; every open state continues to reserve its staff slot.
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS status_check;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check CHECK (
  status IN ('payment_pending', 'pending', 'confirmed', 'reschedule_proposed',
    'reschedule_requested', 'checked_in', 'in_progress', 'completed',
    'cancelled', 'no_show', 'disputed')
);
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_staff_active_slot_no_overlap;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_staff_active_slot_no_overlap
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(appointment_start, appointment_end, '[)') WITH &&
  ) WHERE (staff_id IS NOT NULL AND status IN (
    'payment_pending', 'pending', 'confirmed', 'reschedule_proposed',
    'reschedule_requested', 'checked_in', 'in_progress'
  ));
