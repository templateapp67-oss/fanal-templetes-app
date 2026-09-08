// ============================================================================
// Authentication gate for customer bookings.
//
// Public salon pages may be visible to everyone, but a booking is an account
// action. The browser sends the Supabase access token and this server verifies
// it with Supabase Auth before any payment claim or database write is handled.
// Mock mode uses an explicit mock token only for local previews/tests; Vercel
// never accepts that path and must have real Supabase credentials.
// ============================================================================

import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from '../src/lib/supabaseClient.js';

export interface BookingAuthUser {
  id: string;
  email?: string;
}

export type BookingAuthResult =
  | { ok: true; user: BookingAuthUser }
  | { ok: false; status: 401 | 503; code: 'auth_required' | 'auth_unavailable' | 'supabase_not_configured'; error: string };

function authorizationToken(req: any): string {
  const value = req?.headers?.authorization;
  const header = Array.isArray(value) ? value[0] : value;
  return typeof header === 'string' ? header.replace(/^Bearer\s+/i, '').trim() : '';
}

/**
 * Verify the booking caller. `allowMock` must be false in Vercel/production.
 * The Supabase service-role key is used only from this server-side function to
 * ask GoTrue for the user represented by the bearer token; it is never sent to
 * the browser.
 */
export async function authenticateBookingRequest(
  req: any,
  deadlineAt?: number,
  allowMock = false
): Promise<BookingAuthResult> {
  const token = authorizationToken(req);
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: 'auth_required',
      error: 'Please sign in or create an account before booking an appointment.',
    };
  }

  if (allowMock) {
    if (!token.startsWith('mock:') || token.length <= 'mock:'.length) {
      return {
        ok: false,
        status: 401,
        code: 'auth_required',
        error: 'Please sign in or create an account before booking an appointment.',
      };
    }
    return { ok: true, user: { id: token.slice('mock:'.length) } };
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: false,
      status: 503,
      code: 'supabase_not_configured',
      error: 'Booking accounts are not connected to the database yet. Nothing was charged — please try again later.',
    };
  }

  const remaining = typeof deadlineAt === 'number' ? deadlineAt - Date.now() : 4000;
  if (remaining <= 0) {
    return {
      ok: false,
      status: 503,
      code: 'auth_unavailable',
      error: 'The sign-in service took too long to respond. Please try again.',
    };
  }

  try {
    const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(Math.max(1, Math.min(4000, remaining))),
    });

    if (response.status === 400 || response.status === 401 || response.status === 403) {
      return {
        ok: false,
        status: 401,
        code: 'auth_required',
        error: 'Your session has expired. Please sign in again before booking.',
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        status: 503,
        code: 'auth_unavailable',
        error: 'The sign-in service is temporarily unavailable. Please try again.',
      };
    }

    const user = await response.json().catch(() => null);
    if (!user || typeof user.id !== 'string' || !user.id.trim()) {
      return {
        ok: false,
        status: 401,
        code: 'auth_required',
        error: 'Please sign in or create an account before booking an appointment.',
      };
    }
    return {
      ok: true,
      user: {
        id: user.id,
        email: typeof user.email === 'string' ? user.email : undefined,
      },
    };
  } catch (error: any) {
    console.warn('[Bookings] Supabase Auth verification request failed:', error?.message || error);
    return {
      ok: false,
      status: 503,
      code: 'auth_unavailable',
      error: 'The sign-in service could not be reached. Please try again shortly.',
    };
  }
}
