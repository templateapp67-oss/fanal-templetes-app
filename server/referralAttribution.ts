import { logPartnerFailure } from './partnerErrorLog.js';
import type { Express, Request } from 'express';
import { supabase } from '../src/lib/supabaseClient.js';

const COOKIE = 'nexora_referral';
const TOKEN = /^[a-f0-9]{64}$/;
function cookieToken(req: Request): string | null {
  const value = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return value && TOKEN.test(value) ? value : null;
}

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
export function registerReferralAttributionRoutes(app: Express, rpc: Rpc = (name, args) => supabase.rpc(name, args)) {
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
