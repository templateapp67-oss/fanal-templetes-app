import type { Request, Response } from 'express';
import { getSupabaseAdmin } from '../src/lib/supabaseClient.js';

export async function partnerMilestonesHandler(req: Request, res: Response) {
  res.setHeader('Cache-Control', 'private, no-store');
  const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return res.status(401).json({ error: 'Sign in required' });
  const db = getSupabaseAdmin();
  if (!db) return res.status(503).json({ error: 'Shop count unavailable' });
  try {
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return res.status(401).json({ error: 'Sign in required' });
    const { data: partner, error: partnerError } = await db.from('growth_partners')
      .select('id,status').eq('user_id', auth.user.id).maybeSingle();
    if (partnerError) throw partnerError;
    if (!partner || partner.status !== 'approved') return res.status(403).json({ error: 'Active Growth Partner access required' });
    // Count distinct salon parents, not user rows or duplicate attribution rows.
    // The inner relation limits the count to this authenticated partner.
    const now = new Date().toISOString();
    const { count, error } = await db.from('salons')
      .select('id,shop_attributions!inner(salon_id)', { count: 'exact', head: true })
      .eq('shop_attributions.growth_partner_id', partner.id)
      .eq('shop_attributions.status', 'active')
      .lte('shop_attributions.effective_from', now)
      .or('effective_until.is.null,effective_until.gt.' + now, { referencedTable: 'shop_attributions' })
      .not('owner_id', 'is', null).neq('owner_id', auth.user.id);
    if (error || count === null) throw error || new Error('Count unavailable');
    return res.json({ onboarded_shops: count });
  } catch {
    return res.status(503).json({ error: 'Could not load shop count. Please retry.' });
  }
}
