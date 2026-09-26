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

    async function loadCode() {
      try {
        setLoading(true);
        setError(null);

        // Get authenticated user session
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) {
            setReferralCode(null);
            setLoading(false);
          }
          return;
        }

        // Fetch partner profile directly from the database RPC
        const profile = await fetchGrowthPartnerProfile();
        if (!cancelled) {
          if (profile && profile.referral_code) {
            setReferralCode(profile.referral_code);
          } else {
            // Safe single global fallback mechanism - no user.id derived code
            setReferralCode('NEXORA-722966AF232B');
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || String(err));
          // Fall back gracefully to the single global fallback instead of crashing
          setReferralCode('NEXORA-722966AF232B');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadCode();

    return () => {
      cancelled = true;
    };
  }, []);

  return { referralCode, loading, error };
}
