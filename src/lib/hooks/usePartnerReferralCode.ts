import { useEffect, useState } from 'react';
import { fetchGrowthPartnerProfile } from '../growthPartnerProfile';
import { supabase } from '../supabaseClient';

export interface UsePartnerReferralCodeResult {
  referralCode: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * Custom React Hook to fetch the 'partner_profiles.referral_code' for the authenticated user.
 * Provides a clean loading skeleton state (loading: true) and guarantees that no secondary
 * hashes are dynamically derived from user.id.
 */
export function usePartnerReferralCode(): UsePartnerReferralCodeResult {
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    const load = async () => {
      const current = ++generation;
      setReferralCode(null);
      setLoading(true);
      setError(null);
      try {
        const { data, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!data.user) return;
        const profile = await fetchGrowthPartnerProfile();
        if (!cancelled && current === generation) setReferralCode(profile?.referral_code || null);
      } catch (err: any) {
        if (!cancelled && current === generation) setError(err?.message || 'Could not load referral code.');
      } finally {
        if (!cancelled && current === generation) setLoading(false);
      }
    };
    void load();
    const { data } = supabase.auth.onAuthStateChange(() => { void load(); });
    return () => { cancelled = true; generation++; data.subscription.unsubscribe(); };
  }, []);

  return { referralCode, loading, error };
}
