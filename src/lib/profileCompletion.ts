import type { SalonProfile } from '../types';

/** The user-level contact data required before a site can be configured. */
export const PROFILE_COMPLETION_FIELDS = ['phone', 'whatsapp', 'city', 'postalCode'] as const;
export type RequiredProfileField = (typeof PROFILE_COMPLETION_FIELDS)[number];

const LABELS: Record<RequiredProfileField, string> = {
  phone: 'Phone',
  whatsapp: 'WhatsApp',
  city: 'City',
  postalCode: 'PIN code',
};

export function missingProfileFields(profile: Pick<SalonProfile, RequiredProfileField> | null | undefined): RequiredProfileField[] {
  if (!profile) return [...PROFILE_COMPLETION_FIELDS];
  return PROFILE_COMPLETION_FIELDS.filter((field) => !String(profile[field] ?? '').trim());
}

export function isOwnerProfileComplete(profile: Pick<SalonProfile, RequiredProfileField> | null | undefined): boolean {
  return missingProfileFields(profile).length === 0;
}

export function describeMissingProfileFields(profile: Pick<SalonProfile, RequiredProfileField> | null | undefined): string {
  return missingProfileFields(profile).map((field) => LABELS[field]).join(', ');
}

/**
 * Never trust a redirect value from a query string. Only same-origin SPA paths
 * are accepted and the profile route cannot redirect back to itself.
 */
export function safeOwnerReturnPath(value: string | null | undefined, fallback = '/editor'): string {
  const candidate = String(value ?? '').trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/settings/profile')) {
    return fallback;
  }
  return candidate;
}

export function ownerLocationWithQuery(): string {
  if (typeof window === 'undefined') return '/editor';
  return `${window.location.pathname}${window.location.search}`;
}

export function profileSettingsPath(returnTo: string): string {
  return `/settings/profile?next=${encodeURIComponent(safeOwnerReturnPath(returnTo))}`;
}

export function isPartnerProfileComplete(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return ['name', 'whatsapp', 'postal', 'city', 'area', 'avatar', 'dob'].every(
    key => typeof p[key] === 'string' && (p[key] as string).trim().length > 0
  );
}
