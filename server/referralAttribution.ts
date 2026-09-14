import { logPartnerFailure } from './partnerErrorLog.js';
import type { Express, Request } from 'express';
import { supabase } from '../src/lib/supabaseClient.js';

const COOKIE = 'nexora_referral';
const TOKEN = /^[a-f0-9]{64}$/;
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
  rpc: Rpc = (name, args) => supabase.rpc(name, args),
  limiter: ReferralRateLimiter = createReferralRateLimiter()
) {
  app.all('/api/referral-attribution', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('Vary', 'Origin');
    // This endpoint carries a cookie capability; unlike general APIs it must
    // not accept credentialed requests from other origins, even sibling sites.
    const secure = process.env.NODE_ENV === 'production' || req.secure || req.get('x-forwarded-proto') === 'https';
    const origin = req.get('origin');
    let sameOrigin = true;
    try { if (origin) sameOrigin = new URL(origin).origin === `${secure ? 'https' : req.protocol}://${req.get('host')}`; } catch { sameOrigin = false; }
    if (!sameOrigin || req.get('sec-fetch-site') === 'cross-site') return void res.status(403).json({ error: 'Same-origin request required.' });
    if (req.method !== 'GET' && req.method !== 'POST') return void res.status(405).set('Allow', 'GET, POST').json({ error: 'Method not allowed.' });
    // Counted AFTER the origin/method gates (a rejected request never reaches
    // the database) and BEFORE any RPC, so the limit actually bounds writes.
    const limit = limiter.hit(referralRateLimitKey(req));
    if (!limit.allowed) {
      res.set('Retry-After', String(limit.retryAfterSeconds));
      return void res.status(429).json({ error: 'Too many requests. Please try again in a few minutes.' });
    }
    if (req.method === 'POST' && !req.is('application/json')) return void res.status(415).json({ error: 'JSON required.' });
    if (req.method === 'POST' && Object.keys(req.body || {}).some(key => key !== 'code')) {
      return void res.status(400).json({ error: 'Only a referral code may be submitted.' });
    }
    const code = req.method === 'POST' ? req.body?.code : '';
    if (typeof code !== 'string' || code.length > 64) return void res.status(400).json({ error: 'Invalid referral code.' });
    const token = cookieToken(req);
    if (req.method === 'GET' && !token) return void res.json({ valid: false, token: null });
    try {
      const { data, error } = req.method === 'GET'
        ? await rpc('prepare_growth_referral_signup', { p_token: token })
        : await rpc('capture_growth_referral', { p_code: code, p_token: token });
      if (error) throw error;
      const options = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' };
      if (data?.valid && TOKEN.test(data.token)) {
        res.cookie(COOKIE, data.token, { ...options, expires: new Date(data.expires_at) });
        // Only signup preparation needs the capability in JS. No partner ID.
        res.json({ valid: true, referralCode: data.referral_code, ...(req.method === 'GET' ? { token: data.token } : {}) });
      } else {
        res.clearCookie(COOKIE, options);
        res.json({ valid: false, token: null });
      }
    } catch (error) {
      const requestId = logPartnerFailure(req.method === 'GET' ? 'referral.prepare' : 'referral.capture', error);
      res.set('X-Request-ID', requestId);
      res.status(503).json({ error: 'Referral attribution is temporarily unavailable. Please retry.' });
    }
  });
}
