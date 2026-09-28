import { useEffect, useMemo, useState } from 'react';
import type { LoyaltyConfig, SalonProfile, SalonService, Stylist } from '../types';
import { supabase } from './supabaseClient';

export interface SalonLoyaltySnapshot {
  programEnabled: boolean;
  tier?: string;
  pointsBalance?: number;
  lifetimePoints?: number;
  tierDiscount?: number;
}

export interface SalonDataPayload {
  salonId?: string;
  profile: SalonProfile;
  services: SalonService[];
  stylists: Stylist[];
  selectedTemplateId?: string | null;
  loyaltyConfig?: LoyaltyConfig | null;
}

/**
 * Shared public-template data source. It deliberately reads the server's
 * published site payload instead of querying owner tables from the browser.
 * That keeps RLS intact while every template gets the same dashboard state.
 */
export function useSalonData(
  siteId: string | null | undefined,
  fallback: Omit<SalonDataPayload, 'salonId' | 'loyaltyConfig'>,
  customerId?: string | null,
) {
  const normalizedSite = String(siteId || '').trim();
  const [published, setPublished] = useState<{ site: string; data: SalonDataPayload } | null>(null);
  // Never render the previous tenant's response while a new site loads.
  const remote = published?.site === normalizedSite ? published.data : null;
  const [loading, setLoading] = useState(Boolean(siteId));

  useEffect(() => {
    const normalized = normalizedSite;
    if (!normalized) {
      setPublished(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/site?site=${encodeURIComponent(normalized)}`, { headers: { Accept: 'application/json' } })
      .then(async (res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body?.found || !body?.salon?.profile) return;
        setPublished({ site: normalized, data: {
          salonId: typeof body.salon.salonId === 'string' ? body.salon.salonId : undefined,
          profile: body.salon.profile,
          services: Array.isArray(body.salon.services) ? body.salon.services : [],
          stylists: Array.isArray(body.salon.stylists) ? body.salon.stylists : [],
          selectedTemplateId: typeof body.salon.selectedTemplateId === 'string' ? body.salon.selectedTemplateId : null,
          loyaltyConfig: body.salon.loyaltyConfig && typeof body.salon.loyaltyConfig === 'object' ? body.salon.loyaltyConfig : null,
        } });
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [normalizedSite]);

  const data: SalonDataPayload = remote || fallback;
  const walletKey = `${normalizedSite}:${remote?.salonId || ''}:${customerId || ''}`;
  const [walletResult, setWalletResult] = useState<{ key: string; value: SalonLoyaltySnapshot } | null>(null);
  const wallet = walletResult?.key === walletKey ? walletResult.value : null;
  useEffect(() => {
    const salonId = remote?.salonId;
    if (!salonId || !customerId) {
      setWalletResult(null);
      return;
    }
    let cancelled = false;
    supabase.from('loyalty_accounts')
      .select('points_balance,lifetime_points,loyalty_tiers(name,discount_percent)')
      .eq('salon_id', salonId)
      .eq('customer_id', customerId)
      .maybeSingle()
      .then(({ data: account }) => {
        if (cancelled || !account) return;
        const tier = Array.isArray(account.loyalty_tiers) ? account.loyalty_tiers[0] : account.loyalty_tiers;
        setWalletResult({ key: walletKey, value: {
          programEnabled: Boolean(remote?.loyaltyConfig?.programEnabled),
          pointsBalance: Number(account.points_balance || 0),
          lifetimePoints: Number(account.lifetime_points || 0),
          tier: typeof tier?.name === 'string' ? tier.name : undefined,
          tierDiscount: Number(tier?.discount_percent || 0) || undefined,
        } });
      }, () => undefined);
    return () => { cancelled = true; };
  }, [remote?.salonId, remote?.loyaltyConfig?.programEnabled, customerId, walletKey]);

  const loyalty = useMemo<SalonLoyaltySnapshot | null>(() => {
    if (wallet) return wallet;
    if (!data.loyaltyConfig?.programEnabled) return null;
    return { programEnabled: true };
  }, [wallet, data.loyaltyConfig]);

  return { data, loyalty, loading };
}
