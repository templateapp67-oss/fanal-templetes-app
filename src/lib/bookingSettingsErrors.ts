// ============================================================================
// Turning a `salon_booking_settings` rejection into something an owner can act
// on.
//
// The raw Postgres text used to reach the screen verbatim:
//
//   Error saving profile settings: Profile save failed (23514): new row for
//   relation "salon_booking_settings" violates check constraint
//   "salon_booking_settings_deposit_25_check"
//
// That is a schema artefact, not an instruction. This module owns the single
// sentence the owner should see, and the predicate every save surface uses to
// recognise the failure. The raw code/message still goes to the console — see
// the call sites — so the detail is never lost, only kept off the toast.
//
// Leaf module on purpose: no imports, so both the browser bundles and the
// Express server can use it without a cycle.
// ============================================================================

import { REQUIRED_ADVANCE_PERCENT } from './advanceDeposit.js';

/** SQLSTATE for a CHECK violation. */
export const CHECK_VIOLATION_SQLSTATE = '23514';

/** The one sentence shown when a save was rejected by the booking-settings check. */
export const BOOKING_SETTINGS_REJECTION_MESSAGE =
  `Your booking settings could not be saved because the advance payment must be ` +
  `${REQUIRED_ADVANCE_PERCENT}%. It has been reset to ${REQUIRED_ADVANCE_PERCENT}% — save again and your other ` +
  'changes will go through.';

/** Matches the check-constraint rejection, whichever column name the live project uses. */
const BOOKING_SETTINGS_REJECTION =
  /salon_booking_settings(?:_[a-z0-9_]*)?_check|deposit_25_check|nexora_normalize_booking_settings/i;

/**
 * True when a database/API error string is the booking-settings advance check.
 * Deliberately requires BOTH a check violation and the table/constraint name,
 * so an unrelated 23514 (a partner KYC status, a booking status) is not
 * mislabelled as an advance-payment problem.
 */
export function isBookingSettingsRejection(detail: unknown): boolean {
  const text = String(detail ?? '');
  if (!BOOKING_SETTINGS_REJECTION.test(text)) return false;
  return /23514|check constraint|check_violation|violates check/i.test(text);
}

/** The owner-facing text for a profile save failure, with the detail kept for the console. */
export function describeProfileSaveFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const text = String(raw || '');
  const lower = text.toLowerCase();

  if (isBookingSettingsRejection(text)) return BOOKING_SETTINGS_REJECTION_MESSAGE;

  if (
    lower.includes('row-level security') ||
    lower.includes('permission denied') ||
    lower.includes('42501') ||
    lower.includes('jwt expired') ||
    lower.includes('invalid claim')
  ) {
    return 'Your session no longer has permission to save. Sign out and sign in again, then save your details once more.';
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('timeout')) {
    return 'We could not reach the database. Check your connection and save again — nothing was changed.';
  }
  if (lower.includes('duplicate key') || lower.includes('23505')) {
    return 'Another account already uses one of these details. Check the contact number and try again.';
  }
  if (lower.includes('did not confirm the saved profile')) {
    return 'The database did not confirm your profile was saved. Please try again.';
  }
  return 'Your profile details could not be saved. Please try again — the exact reason is in the browser console.';
}

/** The owner-facing text for a failed profile READ (the modal's load path). */
export function describeProfileLoadFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const lower = String(raw || '').toLowerCase();
  if (lower.includes('row-level security') || lower.includes('permission denied') || lower.includes('42501')) {
    return 'Your session does not have permission to read your saved details. Sign out and sign in again.';
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('timeout')) {
    return 'We could not reach the database to load your saved details. Check your connection and reopen this panel.';
  }
  return 'Could not load your saved profile details. Please reopen this panel — the exact reason is in the browser console.';
}
