/** Exact, reviewed UI copy only; rejected promises can contain arbitrary driver text. */
const SAFE_MESSAGES = new Set([
  "Your account is suspended. Contact support for help.",
  // --- Growth Partner application submission (partnerApplicationErrors.ts) ---
  // Specific, actionable copy: the old flow replaced every failure with
  // "Application failed. Please try again.", which told the user nothing.
  "Check your application details and try again.",
  "Enter a valid 10-digit mobile number.",
  "Enter your full name as it appears on your KYC document.",
  "Enter your full name.",
  "Enter your KYC reference number.",
  "Invalid Aadhaar number. Enter the 12 digits from your Aadhaar card.",
  "Invalid PAN. Enter it as ABCDE1234F.",
  "Invalid passport number. Use 6-20 letters or digits.",
  "Invalid driving licence number. Use 6-20 letters or digits.",
  "Invalid business registration number. Use 6-20 letters or digits.",
  "Select a KYC document type.",
  "That KYC document is already registered. Check the number and try again.",
  "We could not submit your application. Please try again.",
  "Applications are unavailable right now. Please try again later.",
  "Partner application setup needs an update. Please contact support and try again after it is fixed.",
  "Partner applications are not set up on this project yet. Apply supabase/migrations/20261030000000_partner_applications_hardening.sql, then try again.",
  "You have already submitted an application.",
  "Your Growth Partner application is already approved. Sign in to open your dashboard.",
  "Your session expired. Please sign in again.",
  "Cannot process image.",
  "Choose a JPG, PNG or WebP image no larger than 5 MB.",
  "Choose a JPG, PNG or WebP image.",
  "Could not load your partner profile. Please retry.",
  "Could not request an email change. Sign in again and retry.",
  "Could not save your partner profile. Please retry.",
  "Could not update the password. Please try again.",
  "Email changes require a live Supabase Auth connection.",
  "Email sign-in is disabled in Supabase. Enable the Email provider in Authentication → Providers → Email.",
  "Enter a different email address.",
  "Enter a full name of 1–120 characters.",
  "Enter a phone number with 7–15 digits.",
  "Enter a valid WhatsApp number with country code.",
  "Enter a valid email address.",
  "Image must be 5 MB or smaller.",
  "Image processing is unavailable.",
  "Invalid email or password. Please try again.",
  "Login failed. Please try again.",
  "Network error. Check your connection and try again.",
  "Password must be at least 8 characters.",
  "Password reset is unavailable right now. Please try again later.",
  "Passwords do not match.",
  "Photo upload failed. Check your connection and try again.",
  "Please verify your email, then log in.",
  "Signup failed. Please try again.",
  "Signup is unavailable. Please try again later.",
  "This email already has an account. Please use Sign in instead.",
  "Too many attempts. Please wait a moment and try again.",
  "Your session changed. Reload your profile before continuing.",
  "Your session changed. Reload your profile before saving.",
]);

export function safePartnerErrorMessage(error: unknown, fallback = 'Could not complete this request. Please try again.'): string {
  const message = typeof (error as {message?: unknown})?.message === 'string' ? (error as Error).message : '';
  if ((error as {status?: number})?.status === 401 || (error as {code?: string})?.code === 'PGRST301') return 'Your session expired. Please sign in again.';
  if (SAFE_MESSAGES.has(message)) return message;
  if (/jwt expired|invalid jwt|session.*expired|sign in required/i.test(message)) return 'Your session expired. Please sign in again.';
  if (/network|failed to fetch|fetch failed|connection|timeout/i.test(message)) return 'Network error. Check your connection and try again.';
  return fallback;
}
