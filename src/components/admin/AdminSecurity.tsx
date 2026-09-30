// ============================================================================
// Data-protection wrapper for the admin surface.
//
// Two jobs, both about what a non-Super-Admin can take OUT of the panel:
//
//   1. `<RoleGate>` / `<SuperAdminOnly>`: a component renders only when the
//      role allows it. Hiding a button is a convenience — the matching SQL
//      function refuses the action anyway (admin_export_partner_directory
//      raises 42501 for anybody but a super admin) — but a hidden button is
//      also the difference between "asked and refused" and "never offered".
//
//   2. `<SecurePanel>`: on screens that show partner contact details to a
//      manager/sub-admin, it disables text selection and the context menu, and
//      tiles a faint watermark of the viewer's email + timestamp. That is
//      deterrence, not security: the data can still be read. The point is that
//      any screenshot or copy-paste carries who took it and when.
//
// A Super Admin is deliberately exempt: they can export the same data through
// the audited CSV route, so locking their own screen would only slow them down.
// ============================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AdminAccess, AdminRole } from '../../lib/adminApi';
import { adminCapabilities } from '../../lib/adminApi';

export interface RoleGateProps {
  access: AdminAccess;
  /** Roles allowed through. `super_admin` is not implied unless listed. */
  roles?: AdminRole[];
  /** Or ask a capability question instead of listing roles. */
  capability?: keyof ReturnType<typeof adminCapabilities>;
  /** Rendered when the gate is closed. Default: nothing at all. */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function RoleGate({ access, roles, capability, fallback = null, children }: RoleGateProps) {
  const caps = adminCapabilities(access);
  const allowed = roles
    ? Boolean(access.role && roles.includes(access.role))
    : capability
      ? Boolean(caps[capability])
      : access.isAdmin;
  return <>{allowed ? children : fallback}</>;
}

export function SuperAdminOnly({ access, fallback, children }: Omit<RoleGateProps, 'roles'>) {
  return (
    <RoleGate access={access} roles={['super_admin']} fallback={fallback}>
      {children}
    </RoleGate>
  );
}

/**
 * A refusal state that names what is missing instead of silently hiding a
 * section — a manager who deep-links /admin/staff should understand why, and an
 * operator signing in with the wrong account should be told what to do.
 */
export function AdminAccessDenied({ access, what }: { access: AdminAccess; what: string }) {
  const caps = adminCapabilities(access);
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
      <p className="font-semibold">This section is for a Super Admin</p>
      <p className="mt-1">
        {what} needs full access. You are signed in as{' '}
        <span className="font-medium">{access.role ? roleLabel(access.role) : 'an account without admin access'}</span>
        {access.workArea ? ` (${access.workArea})` : ''}.
        {caps.copyProtection
          ? ' Your role can read and update records inside your work area, but not export or delete them.'
          : ''}
      </p>
    </div>
  );
}

export function roleLabel(role: AdminRole | null): string {
  switch (role) {
    case 'super_admin': return 'Super Admin';
    case 'admin': return 'Admin';
    case 'area_manager': return 'Area Manager';
    case 'sub_admin': return 'Sub Admin';
    default: return 'Staff';
  }
}

/**
 * Copy lock + watermark for sensitive screens.
 *
 * `enabled` comes from the caller's role, so the same component is a plain
 * container for a Super Admin (no listeners, no watermark, no CSS change).
 */
export function SecurePanel({
  enabled,
  viewerEmail,
  children,
  className = '',
  label,
}: {
  enabled: boolean;
  viewerEmail: string;
  children: React.ReactNode;
  className?: string;
  /** Short caption for the watermark, e.g. "Partner directory". */
  label?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    const node = ref.current;
    if (!node) return;
    const blockContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    const blockDrag = (event: DragEvent) => {
      event.preventDefault();
    };
    node.addEventListener('contextmenu', blockContextMenu);
    node.addEventListener('dragstart', blockDrag);
    return () => {
      node.removeEventListener('contextmenu', blockContextMenu);
      node.removeEventListener('dragstart', blockDrag);
    };
  }, [enabled]);

  const stamp = useMemo(() => {
    const now = new Date();
    const when = `${now.toLocaleDateString('en-IN')} ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
    return `${viewerEmail || 'signed-in staff'}${label ? ` · ${label}` : ''} · ${when}`;
  }, [viewerEmail, label]);

  return (
    <div
      ref={ref}
      data-copy-protected={enabled ? 'true' : 'false'}
      className={`${enabled ? 'select-none [-webkit-user-select:none] [-webkit-touch-callout:none]' : ''} ${className}`}
      onCopy={enabled ? (event) => event.preventDefault() : undefined}
      onCut={enabled ? (event) => event.preventDefault() : undefined}
    >
      <div className="relative">
        {enabled ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 overflow-hidden opacity-[0.08]"
            style={{
              backgroundImage: `repeating-linear-gradient(-30deg, #0f172a 0 1px, transparent 1px 220px)`,
            }}
          >
            {Array.from({ length: 12 }).map((_, index) => (
              <span
                key={index}
                className="absolute whitespace-nowrap text-[11px] font-semibold uppercase tracking-widest text-slate-900"
                style={{
                  left: `${(index % 3) * 33}%`,
                  top: `${Math.floor(index / 3) * 25}%`,
                }}
              >
                {stamp}
              </span>
            ))}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/** Live clock for the status bar — keeps the watermark's timestamp honest. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
