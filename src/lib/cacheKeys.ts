/**
 * Scoped cache key factories for tenant-specific and user-specific state.
 * Prevents cross-account cache poisoning and ensures React Query or custom
 * in-memory cache layers scope their queries by both userId and salonId.
 */
export const queryKeys = {
  salonProfile: (userId?: string | null, salonId?: string | null) =>
    ['salon-profile', userId || 'anonymous', salonId || 'default'] as const,
  salonServices: (userId?: string | null, salonId?: string | null) =>
    ['salon-services', userId || 'anonymous', salonId || 'default'] as const,
  salonStylists: (userId?: string | null, salonId?: string | null) =>
    ['salon-stylists', userId || 'anonymous', salonId || 'default'] as const,
  salonAppointments: (userId?: string | null, salonId?: string | null) =>
    ['salon-appointments', userId || 'anonymous', salonId || 'default'] as const,
  salonClients: (userId?: string | null, salonId?: string | null) =>
    ['salon-clients', userId || 'anonymous', salonId || 'default'] as const,
  partnerProfile: (userId?: string | null) =>
    ['partner-profile', userId || 'anonymous'] as const,
  ownerWorkspace: (userId?: string | null) =>
    ['owner-workspace', userId || 'anonymous'] as const,
};
