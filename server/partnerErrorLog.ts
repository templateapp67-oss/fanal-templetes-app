import { createHash, randomUUID } from 'node:crypto';

/** Server-only diagnostics. Never log SQL text, args, headers, cookies or Auth data. */
export function logPartnerFailure(operation: string, error: unknown, sink: (entry: string) => void = console.error): string {
  const id = randomUUID();
  const value = error as { code?: unknown; status?: unknown; name?: unknown; message?: unknown } | null;
  const code = typeof value?.code === 'string' && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(value.code) ? value.code : 'UNKNOWN';
  const status = typeof value?.status === 'number' && value.status >= 400 && value.status <= 599 ? value.status : undefined;
  const message = typeof value?.message === 'string' ? value.message : '';
  const category = /network|fetch|connection|timeout/i.test(message) ? 'transport' : code === '42501' ? 'authorization' : 'database_or_service';
  try { sink(JSON.stringify({event:'partner_request_failed',requestId:id,operation:/^[a-zA-Z0-9_.:-]{1,100}$/.test(operation) ? operation : 'unknown',code,status,category,
    fingerprint:createHash('sha256').update(message).digest('hex').slice(0,16),at:new Date().toISOString()})); } catch { /* logging must not break the safe response */ }
  return id;
}

/**
 * 5.2 SAFE RESPONSE backstop. The public validation answer is already built
 * from an allowlist, so a private field in the RPC payload cannot reach the
 * browser — but it does mean the database contract drifted from what this
 * repository expects (a hand-edited function, an environment with an extra
 * column, a future migration). Log the field PATHS and CATEGORIES so an
 * operator can fix it at the source. Values are never logged: the point of the
 * rule is that they are private.
 */
export function logPartnerResponseDrift(
  surface: string,
  findings: readonly { path: string; category: string }[],
  sink: (entry: string) => void = console.warn
): void {
  if (findings.length === 0) return;
  try {
    sink(JSON.stringify({
      event: 'partner_response_drift',
      surface: /^[a-zA-Z0-9_.:-]{1,64}$/.test(surface) ? surface : 'unknown',
      dropped: findings.slice(0, 20).map(finding => ({
        path: /^[a-zA-Z0-9_.\[\]-]{1,120}$/.test(finding.path) ? finding.path : 'unknown',
        category: finding.category,
      })),
      total: findings.length,
      at: new Date().toISOString(),
    }));
  } catch { /* logging must not break the safe response */ }
}

/** Fixed response copy; detailed payloads and SQL names never cross the gateway. */
export function safeGatewayFailure(error: unknown): string {
  const value = error as {message?: string; code?: string};
  const message = String(value?.message || '');
  if (/sign in required|jwt expired|not authenticated/i.test(message)) return 'Sign in required';
  if (/(partner|account|access).*(inactive|paused|suspended)/i.test(message)) return 'Growth Partner access is paused';
  if (/already linked to a Growth Partner/i.test(message)) return 'Already linked to a Growth Partner';
  if (/own referral code/i.test(message)) return 'You cannot use your own referral code';
  if (/invalid.*referral code|referral code.*invalid/i.test(message)) return 'Invalid referral code';
  if (/Growth Partner access required/i.test(message)) return 'Growth Partner access required';
  if (/Unknown referral filter/i.test(message)) return 'Unknown referral filter';
  if (value?.code === '42501') return 'Permission denied';
  return 'The request could not be completed. Please try again.';
}
