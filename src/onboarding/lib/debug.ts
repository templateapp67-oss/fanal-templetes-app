/**
 * Diagnostic utility for onboarding service & referral attribution debugging.
 */

export interface OnboardingDiagnosticResult {
  env: {
    hasViteSupabaseUrl: boolean;
    hasViteSupabaseAnonKey: boolean;
    hasPublicApiUrl: boolean;
    nodeEnv: string;
  };
  endpointProbe: {
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    error?: string;
  };
}

/**
 * Runs diagnostics on environmental setup, backend connectivity, and CORS headers.
 */
export async function diagnoseOnboardingService(): Promise<OnboardingDiagnosticResult> {
  const envInfo = {
    hasViteSupabaseUrl: Boolean(import.meta.env?.VITE_SUPABASE_URL),
    hasViteSupabaseAnonKey: Boolean(import.meta.env?.VITE_SUPABASE_ANON_KEY),
    hasPublicApiUrl: Boolean(import.meta.env?.VITE_PUBLIC_API_URL || import.meta.env?.NEXT_PUBLIC_API_URL),
    nodeEnv: import.meta.env?.MODE || 'unknown',
  };

  console.group('[Onboarding Diagnostics] Environment Check');
  console.info('VITE_SUPABASE_URL available:', envInfo.hasViteSupabaseUrl);
  console.info('VITE_SUPABASE_ANON_KEY available:', envInfo.hasViteSupabaseAnonKey);
  console.info('API_URL configured:', envInfo.hasPublicApiUrl);
  console.info('Environment Mode:', envInfo.nodeEnv);
  console.groupEnd();

  const headersMap: Record<string, string> = {};
  let probeStatus = 0;
  let probeStatusText = '';
  let isOk = false;
  let errorMsg: string | undefined;

  try {
    const response = await fetch('/api/referral-attribution', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    });

    probeStatus = response.status;
    probeStatusText = response.statusText;
    isOk = response.ok;

    response.headers.forEach((value, key) => {
      headersMap[key.toLowerCase()] = value;
    });

    console.group(`[Onboarding Diagnostics] Endpoint Probe (/api/referral-attribution) -> ${response.status}`);
    console.info('Status:', response.status, response.statusText);
    console.info('CORS Access-Control-Allow-Origin:', headersMap['access-control-allow-origin'] || '(none)');
    console.info('CORS Access-Control-Allow-Credentials:', headersMap['access-control-allow-credentials'] || '(none)');
    console.info('Vary Header:', headersMap['vary'] || '(none)');
    console.info('Cache-Control:', headersMap['cache-control'] || '(none)');
    console.groupEnd();
  } catch (err: any) {
    errorMsg = err?.message || String(err);
    console.error('[Onboarding Diagnostics] Probe request failed:', err);
  }

  return {
    env: envInfo,
    endpointProbe: {
      ok: isOk,
      status: probeStatus,
      statusText: probeStatusText,
      headers: headersMap,
      error: errorMsg,
    },
  };
}
