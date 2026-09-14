// ============================================================================
// 5.2 SAFE RESPONSE — the one definition of what a public/client partner
// validation answer may contain.
//
// WHY THIS FILE EXISTS
//   The referral funnel answers "is this code valid?" for callers who are NOT
//   the partner:
//     • an anonymous visitor  -> POST/GET /api/referral-attribution, which
//       calls capture_growth_referral / prepare_growth_referral_signup;
//     • a signed-in owner     -> validate_growth_referral_code (client
//       validation while typing).
//   Those answers must carry ONLY the information the caller needs to
//   continue — and they must be BUILT from an allowlist, never forwarded
//   verbatim from whatever the database returned. A widened RPC result (a new
//   column, a hand-edited function, schema drift between environments, a
//   future migration) must not be able to turn a validation answer into a
//   disclosure of:
//     • the partner's private profile (identity, business, KYC, address)
//     • internal IDs that have no client-side purpose
//     • bank details (account, IFSC, UPI, settlement/payout destination)
//     • commission configuration (rates, slabs, payout amounts)
//     • admin metadata (is_admin, app metadata, roles, audit actors)
//     • private contact details (email, phone, WhatsApp, address)
//
//   Projection here is STRUCTURAL: the returned object is constructed field by
//   field and type-checked, so unrelated data cannot ride along under a new
//   key name, nested object or array. `findPrivateResponseFields` is the
//   audit backstop used by tests and by the server drift log: it flags the six
//   categories above by KEY NAME and by unmistakable private VALUE
//   (email / phone / UUID / IFSC / IBAN), wherever they appear.
//
//   Every answer this module can produce is exactly:
//     { valid, referralCode }                      — code validation
//     { valid, referralCode }                      — attribution capture
//     { valid, referralCode, token }               — signup preparation
//   (A failed answer is { valid: false, token: null } on the HTTP surface.)
//   `expiresAt` is the server-internal cookie lifetime and is deliberately
//   never serialized into a public body.
// ============================================================================

/** The client-visible validation answers this module can produce. */
export type SafeValidationSurface = 'validate-code' | 'capture-attribution' | 'prepare-signup';

/**
 * Complete allowlist per surface.
 *
 * `validate-code` is a pure question ("is this code valid?"): it never issues
 * a capability, so a token returned by a drifted backend is dropped rather
 * than handed to the caller.
 */
export const SAFE_VALIDATION_FIELDS: Record<SafeValidationSurface, readonly string[]> = {
  'validate-code': ['valid', 'referral_code'],
  'capture-attribution': ['valid', 'referral_code', 'token', 'expires_at'],
  'prepare-signup': ['valid', 'referral_code', 'token', 'expires_at'],
};

/**
 * Canonical stored code form. This is the database's own CHECK constraint
 * (`growth_partners_code_format`, 20260921_public_partner_referral_codes.sql):
 * legacy alphanumerics (no hyphen) or a `NEXORA-` branded code. It is
 * deliberately this narrow — a looser "letters and dashes" rule would happily
 * echo a partner's `PRIVATE-NAME` back through the `referral_code` field.
 */
const CANONICAL_CODE = /^(?:[A-Z0-9]{6,12}|NEXORA-[A-Z0-9]{4,24})$/;

/** The opaque one-use signup capability: 32 random bytes, lower-case hex. */
export const REFERRAL_CAPABILITY = /^[a-f0-9]{64}$/;

/** Server fallback when the backend omits `expires_at` (matches the 7-day TTL). */
export const REFERRAL_CAPABILITY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The only shape a caller ever receives from this module. */
export interface SafeValidationResult {
  valid: boolean;
  /** Canonical code, present only when `valid` and the value really is a code. */
  referralCode: string | null;
  /** One-use signup capability, only on surfaces that issue one. */
  token?: string;
  /** Server-internal cookie lifetime. Never serialized by `publicValidationBody`. */
  expiresAt?: string;
}

/** The complete public body. No other key can appear. */
export interface PublicValidationBody {
  valid: boolean;
  referralCode?: string;
  token?: string | null;
}

/** A bounded, canonical string or null. Arbitrary text is never echoed. */
function canonicalString(value: unknown, pattern: RegExp): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length > 64 || !pattern.test(trimmed)) return null;
  return trimmed;
}

/** An absolute instant, or undefined — `new Date(value)` must be meaningful. */
function instantString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 64) return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

/**
 * Build the ONLY answer a public/client validation surface may return.
 *
 * Anything not in the surface's allowlist is discarded — including keys this
 * function does not know about, nested objects and arrays. `valid` is a strict
 * boolean check (a truthy string is not validity), and the code/token are
 * re-validated against their canonical shape so a private value (an email, a
 * name, a user id) cannot be echoed back through a validation field.
 */
export function projectValidationResponse(
  surface: SafeValidationSurface,
  raw: unknown
): SafeValidationResult {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const valid = source.valid === true;
  const allows = (field: string) => SAFE_VALIDATION_FIELDS[surface].includes(field);
  // The same answer exists in two spellings: snake_case from the database
  // (validate_growth_referral_code) and camelCase on the HTTP surface
  // (/api/referral-attribution). Both are read here so every caller projects
  // through this one definition instead of re-implementing the mapping.
  const code = source.referral_code ?? source.referralCode;
  const expiry = source.expires_at ?? source.expiresAt;

  const result: SafeValidationResult = {
    valid,
    referralCode: valid && allows('referral_code') ? canonicalString(code, CANONICAL_CODE) : null,
  };

  if (valid && allows('token')) {
    const token = canonicalString(source.token, REFERRAL_CAPABILITY);
    if (token) result.token = token;
  }
  if (valid && allows('expires_at')) {
    const expiresAt = instantString(expiry);
    if (expiresAt) result.expiresAt = expiresAt;
  }
  return result;
}

/**
 * The exact HTTP body for a validation answer. Fail-closed: a "valid" answer
 * that carries no canonical code is reported as invalid rather than as a
 * half-answer, so no partially-trusted data reaches the browser.
 *
 * An invalid answer still carries `token: null` so callers can use one shape
 * for both outcomes (existing contract of /api/referral-attribution).
 */
export function publicValidationBody(
  result: SafeValidationResult,
  options: { includeToken?: boolean } = {}
): PublicValidationBody {
  if (!result.valid || !result.referralCode) return { valid: false, token: null };
  const body: PublicValidationBody = { valid: true, referralCode: result.referralCode };
  if (options.includeToken && result.token) body.token = result.token;
  return body;
}

/** Cookie lifetime for the attribution capability (server-side only). */
export function capabilityExpiry(result: SafeValidationResult, now: number = Date.now()): Date {
  const parsed = result.expiresAt ? Date.parse(result.expiresAt) : NaN;
  return new Date(Number.isFinite(parsed) ? parsed : now + REFERRAL_CAPABILITY_TTL_MS);
}

// ---------------------------------------------------------------------------
// Audit backstop: the six categories that must never appear in a validation
// answer. Key rules are matched against a normalized `snake_case` name, so
// `partnerName`, `partner-name` and `partner_name` are all caught.
// ---------------------------------------------------------------------------

export type PrivateResponseCategory =
  | 'private-partner-profile'
  | 'internal-id'
  | 'bank-details'
  | 'commission-configuration'
  | 'admin-metadata'
  | 'private-contact';

export interface PrivateResponseRule {
  category: PrivateResponseCategory;
  /** Why this field must not reach a public/client validation answer. */
  why: string;
  /** Tested against the normalized key (or the whole string value). */
  match: RegExp;
}

/**
 * Field-name rules. Deliberately narrow enough to read as a spec: each entry
 * names the category from 5.2 that it protects.
 */
export const PRIVATE_KEY_RULES: readonly PrivateResponseRule[] = [
  { category: 'internal-id', why: 'internal identifier with no client-side purpose', match: /^(id|uuid|user_id|partner_id|growth_partner_id|referrer_id|referred_user_id|referral_id|application_id|session_id|auth_id|owner_id|salon_id|organization_id)$/ },
  { category: 'bank-details', why: 'bank/settlement details', match: /bank|ifsc|micr|iban|swift|beneficiary|account_(no|number|name|type|holder)|upi|vpa|settlement|payout_account|fund_account|card_number/ },
  { category: 'commission-configuration', why: 'commission/payout configuration', match: /commission|payout_(amount|rate|config)|revenue_share|incentive|(^|_)slab|(^|_)tier|markup|margin|(^|_)rate$/ },
  { category: 'admin-metadata', why: 'administrative/internal metadata', match: /admin|app_metadata|user_metadata|raw_app_meta_data|raw_user_meta_data|(^|_)(role|roles|audit|actor|reviewer|reviewed_by|updated_by|created_by|internal_notes|review_notes|ban_reason|banned_until|token_hash|secret|password|claims|service_key)$/ },
  { category: 'private-contact', why: 'private contact details', match: /(^|_)(email|e_mail|phone|phone_number|mobile|whatsapp|telephone|contact|alternate_contact|emergency_contact|address|residential_address)$/ },
  { category: 'private-partner-profile', why: 'partner identity/business/KYC data', match: /(^|_)(partner|referrer|owner|business|salon|company)_(name|full_name|display_name|profile|business|company|address|email|phone|mobile|whatsapp|kyc|pan|gst|bank|commission|user_id|id)/ },
  { category: 'private-partner-profile', why: 'profile identity fields', match: /^(full_name|display_name|business_name|salon_name|company_name|owner_name|owner_role|tagline|about|bio|avatar|avatar_url|photo|photo_url|profile_photo|cover_image|logo|kyc|kyc_status|kyc_document|dob|date_of_birth|gender)$/ },
  { category: 'private-partner-profile', why: 'profile location data', match: /^(address|address_line1|address_line2|full_address|city|state|postal_code|pincode|zip|landmark|latitude|longitude|subdomain|custom_domain|gst_number|pan_number|tax_id)$/ },
];

/**
 * Value rules. A private value stays private wherever it appears, even under a
 * neutral key — e.g. a partner's email returned as `label`. Patterns are
 * deliberately unambiguous so a legitimate referral code can never match.
 */
export const PRIVATE_VALUE_RULES: readonly PrivateResponseRule[] = [
  { category: 'internal-id', why: 'a raw UUID (internal id)', match: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i },
  { category: 'private-contact', why: 'an email address', match: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/ },
  { category: 'private-contact', why: 'a phone number', match: /^\+[1-9]\d{7,14}$/ },
  { category: 'bank-details', why: 'an IFSC code', match: /^[A-Z]{4}0[A-Z0-9]{6}$/ },
  { category: 'bank-details', why: 'an IBAN', match: /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/ },
];

export interface PrivateResponseFinding {
  /** Dotted path to the offending field, e.g. `rows.0.partner.email`. */
  path: string;
  category: PrivateResponseCategory;
  why: string;
}

export interface FindPrivateResponseOptions {
  /**
   * Field names that are EXPECTED on this surface and therefore exempt from the
   * key-name rules — e.g. the referred owner's own `partner_name`, which the
   * committed migrations disclose on purpose
   * (20260915_growth_partner_dashboard.sql, DELIBERATE MINIMAL DISCLOSURE).
   * Exempt keys are still checked against the value rules.
   */
  allow?: readonly (string | RegExp)[];
  /** Values that are legitimate on this surface (e.g. the issued capability). */
  ignoreValues?: readonly (string | null | undefined)[];
}

/** `partnerName` / `partner-name` / `partner_name` -> `partner_name`. */
function normalizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '');
}

function isAllowedKey(key: string, allow: readonly (string | RegExp)[]): boolean {
  const normalized = normalizeKey(key);
  return allow.some((entry) => (typeof entry === 'string' ? normalizeKey(entry) === normalized : entry.test(normalized)));
}

/**
 * Every field of `value` that belongs to one of the six 5.2 categories,
 * including nested objects and array items. Returns an empty array for a clean
 * payload; values are never included, only the path and the category.
 */
export function findPrivateResponseFields(
  value: unknown,
  options: FindPrivateResponseOptions = {}
): PrivateResponseFinding[] {
  const allow = options.allow ?? [];
  const ignored = new Set((options.ignoreValues ?? []).filter((entry): entry is string => typeof entry === 'string'));
  const findings: PrivateResponseFinding[] = [];
  // A field already reported by name is not reported again by value.
  const flagged = new Set<string>();

  const visit = (current: unknown, path: string): void => {
    if (typeof current === 'string') {
      if (ignored.has(current) || flagged.has(path)) return;
      for (const rule of PRIVATE_VALUE_RULES) {
        if (rule.match.test(current)) {
          findings.push({ path: path || '(root)', category: rule.category, why: rule.why });
          return;
        }
      }
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, path ? `${path}.${index}` : String(index)));
      return;
    }
    if (!current || typeof current !== 'object') return;

    for (const [childKey, childValue] of Object.entries(current as Record<string, unknown>)) {
      const childPath = path ? `${path}.${childKey}` : childKey;
      if (!isAllowedKey(childKey, allow)) {
        for (const rule of PRIVATE_KEY_RULES) {
          if (rule.match.test(normalizeKey(childKey))) {
            findings.push({ path: childPath, category: rule.category, why: rule.why });
            flagged.add(childPath);
            break;
          }
        }
      }
      visit(childValue, childPath);
    }
  };

  visit(value, '');
  return findings;
}

/** True when nothing in the payload belongs to a forbidden category. */
export function isSafeValidationResponse(
  value: unknown,
  options: FindPrivateResponseOptions = {}
): boolean {
  return findPrivateResponseFields(value, options).length === 0;
}

// ---------------------------------------------------------------------------
// Client-facing projection of the referral relationship.
//
// The related-user answer (link/get) deliberately discloses the partner's
// display name and the relationship status — the committed migrations document
// that reverse disclosure — but nothing else. This allowlist keeps a widened
// row (bank details, commission configuration, admin metadata, private
// contacts) from ever reaching React state.
// ---------------------------------------------------------------------------

/** Fields the client may hold about its own referral relationship. */
export const SAFE_RELATIONSHIP_FIELDS = [
  'growth_partner_id',
  'referral_code',
  'linked_at',
  'status',
  'partner_name',
] as const;

const RELATIONSHIP_STATUSES = ['not_started', 'linked', 'template_started', 'template_completed'] as const;
const RELATED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SafeReferralRelationship {
  growth_partner_id: string;
  referral_code: string;
  linked_at: string | null;
  status: (typeof RELATIONSHIP_STATUSES)[number] | null;
  partner_name: string | null;
}

function textOrNull(value: unknown, maxLength = 120): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

/**
 * Project an own-referral row to its documented fields. Returns null when the
 * payload does not carry a usable partner id + canonical code, so a drifted
 * backend cannot produce a half-populated relationship in the UI.
 */
export function projectReferralRelationship(raw: unknown): SafeReferralRelationship | null {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!source) return null;
  const partnerId = typeof source.growth_partner_id === 'string' && RELATED_ID.test(source.growth_partner_id)
    ? source.growth_partner_id.toLowerCase()
    : null;
  const referralCode = canonicalString(source.referral_code, CANONICAL_CODE);
  if (!partnerId || !referralCode) return null;
  const status = typeof source.status === 'string' && (RELATIONSHIP_STATUSES as readonly string[]).includes(source.status)
    ? (source.status as SafeReferralRelationship['status'])
    : null;
  return {
    growth_partner_id: partnerId,
    referral_code: referralCode,
    linked_at: textOrNull(source.linked_at, 64),
    status,
    partner_name: textOrNull(source.partner_name),
  };
}
