// src/services/growthPartner.ts

import type { ApiResponse, GrowthPartner, Referral, EarningsData } from '../types/growthPartner';

// ─── Type Definitions ────────────────────────────────────────────────────────

export interface PartnerStats {
  totalReferrals: number;
  activeReferrals: number;
  totalEarnings: number;
  pendingEarnings: number;
  conversionRate: number;
}

export interface TransformedReferral {
  id: string;
  name: string;
  email: string;
  status: 'active' | 'pending' | 'inactive';
  joinedAt: string;
  earnings: number;
}

export interface TransformedEarnings {
  total: number;
  pending: number;
  paid: number;
  currency: string;
  breakdown: EarningsBreakdown[];
}

export interface EarningsBreakdown {
  month: string;
  amount: number;
  referralCount: number;
}

// ─── Safe Transformation Utilities ───────────────────────────────────────────

/**
 * Safely transforms a raw referral object into a normalized shape.
 * Returns null if the input is falsy or malformed.
 */
function transformReferral(raw: unknown): TransformedReferral | null {
  if (!raw || typeof raw !== 'object') return null;

  try {
    const r = raw as Record<string, unknown>;

    return {
      id:       typeof r.id === 'string'    ? r.id    : String(r.id ?? ''),
      name:     typeof r.name === 'string'  ? r.name  : 'Unknown',
      email:    typeof r.email === 'string' ? r.email : '',
      status:   (['active', 'pending', 'inactive'] as const).includes(r.status as any)
                  ? (r.status as TransformedReferral['status'])
                  : 'pending',
      joinedAt: typeof r.joinedAt === 'string' || typeof r.joinedAt === 'number'
                  ? new Date(r.joinedAt as string | number).toISOString()
                  : new Date().toISOString(),
      earnings: typeof r.earnings === 'number' ? r.earnings : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Safely transforms raw earnings data.
 * Returns a zero-value object if input is missing or malformed.
 */
function transformEarnings(raw: unknown): TransformedEarnings {
  const fallback: TransformedEarnings = {
    total:     0,
    pending:   0,
    paid:      0,
    currency:  'USD',
    breakdown: [],
  };

  if (!raw || typeof raw !== 'object') return fallback;

  try {
    const e = raw as Record<string, unknown>;

    const breakdown: EarningsBreakdown[] = Array.isArray(e.breakdown)
      ? (e.breakdown as unknown[]).reduce<EarningsBreakdown[]>((acc, item) => {
          if (!item || typeof item !== 'object') return acc;
          const b = item as Record<string, unknown>;
          acc.push({
            month:         typeof b.month === 'string' ? b.month : '',
            amount:        typeof b.amount === 'number' ? b.amount : 0,
            referralCount: typeof b.referralCount === 'number' ? b.referralCount : 0,
          });
          return acc;
        }, [])
      : [];

    return {
      total:    typeof e.total   === 'number' ? e.total   : 0,
      pending:  typeof e.pending === 'number' ? e.pending : 0,
      paid:     typeof e.paid    === 'number' ? e.paid    : 0,
      currency: typeof e.currency === 'string' ? e.currency : 'USD',
      breakdown,
    };
  } catch {
    return fallback;
  }
}

/**
 * Safely transforms raw partner data.
 */
function transformPartner(raw: unknown): GrowthPartner | null {
  if (!raw || typeof raw !== 'object') return null;

  try {
    const p = raw as Record<string, unknown>;

    return {
      id:           typeof p.id === 'string'          ? p.id          : String(p.id ?? ''),
      name:         typeof p.name === 'string'        ? p.name        : 'Unknown Partner',
      email:        typeof p.email === 'string'       ? p.email       : '',
      referralCode: typeof p.referralCode === 'string' ? p.referralCode : '',
      tier:         typeof p.tier === 'string'        ? p.tier        : 'basic',
      joinedAt:     typeof p.joinedAt === 'string'    ? p.joinedAt    : new Date().toISOString(),
      isActive:     typeof p.isActive === 'boolean'   ? p.isActive    : false,
    } as GrowthPartner;
  } catch {
    return null;
  }
}

// ─── API Helper ──────────────────────────────────────────────────────────────

async function safeFetch<T>(
  url: string,
  options?: RequestInit,
): Promise<{ data: T | null; error: string | null }> {
  try {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });

    if (!response.ok) {
      return {
        data:  null,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const json = await response.json();
    return { data: json as T, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown fetch error';
    console.warn('[GrowthPartner] safeFetch failed:', message);
    return { data: null, error: message };
  }
}

// ─── Service Functions (lines 510–525 equivalents, fully guarded) ─────────────

/**
 * Fetch and transform the list of referrals for a given partner.
 * ALWAYS returns an array – never throws.
 */
export async function fetchReferrals(partnerId: string): Promise<TransformedReferral[]> {
  if (!partnerId) {
    console.warn('[GrowthPartner] fetchReferrals called without partnerId');
    return [];
  }

  try {
    const { data, error } = await safeFetch<unknown[]>(
      `/api/partners/${partnerId}/referrals`,
    );

    if (error) {
      console.warn('[GrowthPartner] fetchReferrals error:', error);
      return [];
    }

    if (!Array.isArray(data)) {
      console.warn('[GrowthPartner] fetchReferrals: unexpected response shape', data);
      return [];
    }

    const transformed = data
      .map(transformReferral)
      .filter((r): r is TransformedReferral => r !== null);

    return transformed;
  } catch (err) {
    console.error('[GrowthPartner] fetchReferrals unhandled exception:', err);
    return [];
  }
}

/**
 * Fetch and transform earnings data.
 * ALWAYS returns a valid TransformedEarnings object – never throws.
 */
export async function fetchEarnings(partnerId: string): Promise<TransformedEarnings> {
  const fallback = transformEarnings(null);

  if (!partnerId) {
    console.warn('[GrowthPartner] fetchEarnings called without partnerId');
    return fallback;
  }

  try {
    const { data, error } = await safeFetch<unknown>(
      `/api/partners/${partnerId}/earnings`,
    );

    if (error) {
      console.warn('[GrowthPartner] fetchEarnings error:', error);
      return fallback;
    }

    return transformEarnings(data);
  } catch (err) {
    console.error('[GrowthPartner] fetchEarnings unhandled exception:', err);
    return fallback;
  }
}

/**
 * Fetch partner profile.
 * Returns null on any failure – never throws.
 */
export async function fetchPartner(partnerId: string): Promise<GrowthPartner | null> {
  if (!partnerId) {
    console.warn('[GrowthPartner] fetchPartner called without partnerId');
    return null;
  }

  try {
    const { data, error } = await safeFetch<unknown>(
      `/api/partners/${partnerId}`,
    );

    if (error) {
      console.warn('[GrowthPartner] fetchPartner error:', error);
      return null;
    }

    return transformPartner(data);
  } catch (err) {
    console.error('[GrowthPartner] fetchPartner unhandled exception:', err);
    return null;
  }
}

/**
 * Derive summary stats from referrals + earnings.
 * Pure function – never throws.
 */
export function computePartnerStats(
  referrals: TransformedReferral[],
  earnings:  TransformedEarnings,
): PartnerStats {
  try {
    const safeReferrals = Array.isArray(referrals) ? referrals : [];
    const safeEarnings  = earnings ?? transformEarnings(null);

    const activeReferrals = safeReferrals.filter(r => r?.status === 'active').length;
    const totalReferrals  = safeReferrals.length;
    const conversionRate  = totalReferrals > 0
      ? Math.round((activeReferrals / totalReferrals) * 100)
      : 0;

    return {
      totalReferrals,
      activeReferrals,
      totalEarnings:   safeEarnings.total,
      pendingEarnings: safeEarnings.pending,
      conversionRate,
    };
  } catch (err) {
    console.error('[GrowthPartner] computePartnerStats error:', err);
    return {
      totalReferrals:  0,
      activeReferrals: 0,
      totalEarnings:   0,
      pendingEarnings: 0,
      conversionRate:  0,
    };
  }
}
