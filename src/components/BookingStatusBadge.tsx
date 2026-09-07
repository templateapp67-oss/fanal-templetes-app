import React from 'react';
import { Clock, CheckCircle2, CircleCheckBig, XCircle, UserX, CalendarClock } from 'lucide-react';
import { describeBookingStatus, type DisplayBookingStatus } from '../lib/bookingStatus';

/**
 * One badge for every booking status, used by the confirmation page, the owner
 * dashboard and the customer portal.
 *
 * Before this existed, BookingManager coloured statuses with an inline ternary
 * whose final branch painted BOTH `completed` and `cancelled` red — a finished
 * job was indistinguishable from a cancellation in the owner's own list. All
 * colouring now comes from the shared registry in `src/lib/bookingStatus.ts`.
 */

const STATUS_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  pending: Clock,
  confirmed: CheckCircle2,
  completed: CircleCheckBig,
  cancelled: XCircle,
  no_show: UserX,
  reschedule_proposed: CalendarClock,
};

export interface BookingStatusBadgeProps {
  status: unknown;
  /** Compact pill without an icon, for dense tables. */
  compact?: boolean;
  /** Show the registry's one-line explanation under the label. */
  withDescription?: boolean;
  className?: string;
}

export const BookingStatusBadge: React.FC<BookingStatusBadgeProps> = ({
  status,
  compact = false,
  withDescription = false,
  className = '',
}) => {
  const descriptor = describeBookingStatus(status);
  const Icon = STATUS_ICONS[descriptor.id] ?? Clock;

  return (
    <span className={`inline-flex flex-col gap-1 ${className}`}>
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${descriptor.badgeClassName}`}
        data-booking-status={descriptor.id}
      >
        {!compact && <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
        {descriptor.label}
      </span>
      {withDescription && (
        <span className="text-[11px] text-slate-600 leading-snug">{descriptor.description}</span>
      )}
    </span>
  );
};

/** Type helper so callers can annotate without importing the registry directly. */
export type { DisplayBookingStatus };
