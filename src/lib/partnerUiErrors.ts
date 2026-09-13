/** Exact, reviewed UI copy only; rejected promises can contain arbitrary driver text. */
const SAFE_MESSAGES = new Set([
  "Your account is suspended. Contact support for help.",
  "Account created, but the partner application could not be submitted. Please sign in and try again.",
  "Cannot process image.",
  "Choose a JPG, PNG or WebP image no larger than 5 MB.",
  "Choose a JPG, PNG or WebP image.",
  "Could not load your partner profile. Please retry.",
  "Could not request an email change. Sign in again and retry.",
  "Could not save your partner profile. Please retry.",
  "Could not update the password. Please try again.",
  "Email changes require a live Supabase Auth connection.",
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
