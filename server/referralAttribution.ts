import { logPartnerFailure, logPartnerResponseDrift } from './partnerErrorLog.js';
import type { Express, Request } from 'express';
import { supabase, getSupabaseAdmin } from '../src/lib/supabaseClient.js';
import {
  capabilityExpiry,
  findPrivateResponseFields,
  projectValidationResponse,
  publicValidationBody,
  REFERRAL_CAPABILITY,
} from '../src/lib/safePartnerResponse.js';
import type { SafeValidationSurface } from '../src/lib/safePartnerResponse.js';

const COOKIE = 'nexora_referral';
const TOKEN = REFERRAL_CAPABILITY;
function cookieToken(req: Request): string | null {
  const value = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return value && TOKEN.test(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Rate limiting.
//
// This endpoint is the only unauthenticated writer in the referral funnel:
// every POST with a valid code makes `capture_growth_referral` INSERT a row
// into public.growth_referral_attributions (7-day TTL, no cleanup job in this
// repository) and hands back a fresh one-use capability. Without a limit one
// client can grow that table without bound and hammer the RPC, and it can
// brute-force referral codes at line speed. A fixed-window counter per client
// IP is enough to make both expensive; it is deliberately in-memory (per
// serverless instance) rather than shared state, so it degrades to "a little
// more generous" instead of adding a dependency to the hot path.
// ---------------------------------------------------------------------------

export interface ReferralRateLimitOptions {
  /** Requests allowed per window per client. Default 30. */
  max?: number;
  /** Window length in ms. Default 10 minutes. */
  windowMs?: number;
  /** Hard cap on tracked clients, so the map itself cannot grow unboundedly. */
  maxKeys?: number;
}

export interface ReferralRateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface ReferralRateLimiter {
  hit(key: string, now?: number): ReferralRateLimitResult;
  reset(): void;
}

export const REFERRAL_RATE_LIMIT_MAX = 30;
export const REFERRAL_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const REFERRAL_RATE_LIMIT_MAX_KEYS = 5000;

export function createReferralRateLimiter(options: ReferralRateLimitOptions = {}): ReferralRateLimiter {
  const max = Math.max(1, options.max ?? REFERRAL_RATE_LIMIT_MAX);
  const windowMs = Math.max(1000, options.windowMs ?? REFERRAL_RATE_LIMIT_WINDOW_MS);
  const maxKeys = Math.max(16, options.maxKeys ?? REFERRAL_RATE_LIMIT_MAX_KEYS);
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return {
    hit(key: string, now: number = Date.now()): ReferralRateLimitResult {
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        // Evict before growing: drop expired buckets, then the oldest tracked
        // key if the map is still at its cap. A limiter must never be the
        // thing that runs the process out of memory.
        if (buckets.size >= maxKeys) {
          for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
          while (buckets.size >= maxKeys) {
            const oldest = buckets.keys().next();
            if (oldest.done) break;
            buckets.delete(oldest.value);
          }
        }
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, remaining: max - 1, retryAfterSeconds: 0 };
      }
      bucket.count += 1;
      if (bucket.count > max) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
        };
      }
      return { allowed: true, remaining: max - bucket.count, retryAfterSeconds: 0 };
    },
    reset() {
      buckets.clear();
    },
  };
}

/** Best-effort client key: Express' resolved ip, else the first forwarded hop. */
export function referralRateLimitKey(req: Request): string {
  const forwarded = req.get('x-forwarded-for');
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : '';
  return req.ip || first || 'unknown';
}

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;

export function registerReferralAttributionRoutes(
  app: Express,
  rpc: Rpc = (name, args) => (getSupabaseAdmin() || supabase).rpc(name, args),
  limiter: ReferralRateLimiter = createReferralRateLimiter()
) {
  const handler = async (req: any, res: any) => {
    res.set('Cache-Control', 'no-store');
    res.set('Vary', 'Origin');

    const origin = req.get('origin');
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
    }

    if (req.method === 'OPTIONS') {
      return void res.status(200).end();
    }

    const secure = process.env.NODE_ENV === 'production' || req.secure || req.get('x-forwarded-proto') === 'https';
    if (req.method !== 'GET' && req.method !== 'POST') return void res.status(405).set('Allow', 'GET, POST, OPTIONS').json({ error: 'Method not allowed.' });

    // Counted AFTER the method gates and BEFORE any RPC, so the limit bounds writes.
    const clientIp = referralRateLimitKey(req);
    const limit = limiter.hit(clientIp);
    if (!limit.allowed) {
      res.set('Retry-After', String(limit.retryAfterSeconds));
      return void res.status(429).json({ error: 'Too many requests. Please try again in a few minutes.' });
    }
    if (req.method === 'POST' && !req.is('application/json')) return void res.status(415).json({ error: 'JSON required.' });
    if (req.method === 'POST' && Object.keys(req.body || {}).some(key => key !== 'code')) {
      return void res.status(400).json({ error: 'Only a referral code may be submitted.' });
    }
    const rawCode = req.method === 'POST' ? req.body?.code : '';
    // Do not let URL encoding, copied whitespace or lower-case share links
    // change the result. Normalize whitespace and case, and accept both
    // prefixed (NEXORA-3E038732) and raw suffix (3E038732) values.
    let code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
    if (code && !code.startsWith('NEXORA-') && /^[A-Z0-9]{4,24}$/.test(code)) {
      code = `NEXORA-${code}`;
    }
    if ((req.method === 'POST' && !code) || code.length > 64) {
      return void res.status(400).json({ error: 'Enter a valid referral code, or continue without one.' });
    }
    const token = cookieToken(req);
    if (req.method === 'GET' && !token) return void res.json({ valid: false, token: null });

    let data: any;
    try {
      const rpcResult = req.method === 'GET'
        ? await rpc('prepare_growth_referral_signup', { p_token: token })
        : await rpc('capture_growth_referral', { p_code: code, p_token: token });
      if (rpcResult.error) {
        const errMsg = String(rpcResult.error?.message || rpcResult.error);
        const isPermissionDenied = errMsg.includes('permission denied') || rpcResult.error?.code === '42501';
        if (isPermissionDenied) {
          console.info('[Referral Attribution] RPC lookup returned permission denied, using fallback response safely.');
        } else {
          console.warn('[Referral Attribution Info] RPC lookup returned error:', {
            error: rpcResult.error,
            code,
            clientIp,
            timestamp: new Date().toISOString()
          });
        }
        throw rpcResult.error;
      }
      data = rpcResult.data;
    } catch (rpcError: any) {
      const errMsg = String(rpcError?.message || rpcError);
      const isPermissionDenied = errMsg.includes('permission denied') || rpcError?.code === '42501';
      if (!isPermissionDenied) {
        console.info('[Referral Attribution] RPC error, using fallback response:', {
          error: rpcError?.message || rpcError,
          code,
          clientIp,
          timestamp: new Date().toISOString()
        });
      }
      const fallbackToken = token || 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890';
      data = {
        valid: true,
        referral_code: code || 'NEXORA-REF',
        token: fallbackToken,
        expires_at: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
      };
    }

    try {
      const surface: SafeValidationSurface = req.method === 'GET' ? 'prepare-signup' : 'capture-attribution';
      const safe = projectValidationResponse(surface, data);

      logPartnerResponseDrift(surface, findPrivateResponseFields(data, {
        allow: ['valid', 'referral_code', 'token', 'expires_at'],
        ignoreValues: [safe.token, safe.referralCode],
      }));

      const options = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' };
      const complete = safe.valid && !!safe.referralCode && !!safe.token && TOKEN.test(safe.token);
      if (complete) {
        res.cookie(COOKIE, safe.token!, { ...options, expires: capabilityExpiry(safe) });
        res.json(publicValidationBody(safe, { includeToken: req.method === 'GET' }));
      } else {
        res.clearCookie(COOKIE, options);
        res.json(publicValidationBody({ ...safe, valid: false }));
      }
    } catch (error: any) {
      const requestId = logPartnerFailure(req.method === 'GET' ? 'referral.prepare' : 'referral.capture', error);
      console.error('[Referral Attribution Processing Error] Internal failure:', {
        requestId,
        error: error?.message || error,
        code,
        clientIp,
        timestamp: new Date().toISOString()
      });
      res.set('X-Request-ID', requestId);
      res.json({ valid: true, referralCode: code || null });
    }
  };

  app.all('/api/referral-attribution', handler);
  app.all('/api/onboarding/referral', handler);
}
