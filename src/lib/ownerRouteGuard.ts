import {
  EDITOR_PATH,
  SETTINGS_PROFILE_PATH,
  buildSettingsProfileUrl,
  isEditorPath,
  isSettingsProfilePath,
  normalizePath,
  parseNextUrl,
} from './router';

/**
 * Owner setup is a guard for the editor, not for general app navigation.
 * Home and Dashboard must always remain reachable after sign-in, including
 * while the first salon is still being created.
 */
export function requiresOwnerEditorSetup(pathname: string): boolean {
  return isEditorPath(pathname);
}

export function isOwnerWorkspacePath(pathname: string): boolean {
  return isEditorPath(pathname) || isSettingsProfilePath(pathname);
}

/**
 * `next=` may only continue into the editor or profile settings.
 * Landing, template preview ("Select & Customize This Template") and
 * external URLs are rejected so a logged-in session cannot fall through
 * to the public explorer.
 */
export function sanitizeOwnerNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  const raw = String(next).trim();
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('://')) return null;
  const path = normalizePath(raw);
  if (isEditorPath(path) || isSettingsProfilePath(path)) return raw;
  return null;
}

/**
 * The website builder is an explicit recovery route for a direct editor visit
 * without an owned salon. It is never a fallback for Home, Dashboard, a
 * completed profile, or a `next=/editor` continuation.
 */
export function shouldRedirectEditorToWebsiteOnboarding(
  pathname: string,
  ownedSalonCount: number,
  hasSelectedTemplate = false,
  profileComplete = false
): boolean {
  // Selecting a template is an explicit request to customise it. A new owner
  // legitimately has no salon record yet, so sending that request to the old
  // profile/setup screen loses the selected design and creates a loop.
  // A completed profile (or a session that already asked for /editor) must
  // stay in the editor — never the public template preview.
  if (hasSelectedTemplate || profileComplete) return false;
  return requiresOwnerEditorSetup(normalizePath(pathname)) && ownedSalonCount === 0;
}

export interface LoggedInOwnerDestinationInput {
  path: string;
  search?: string;
  profileComplete: boolean;
}

export interface LoggedInOwnerDestination {
  action: 'stay' | 'redirect';
  to: string;
  openProfile: boolean;
}

function withSearch(path: string, search?: string): string {
  const base = normalizePath(path);
  const suffix = String(search || '');
  if (!suffix || suffix === '?') return base;
  return `${base}${suffix.startsWith('?') ? suffix : `?${suffix}`}`;
}

/**
 * Keep a signed-in owner on `/editor` or `/settings/profile`.
 *
 * Visiting Profile / Settings is never rewritten to the marketing landing
 * page or `/templates/:id/preview`. After the profile-complete gate,
 * `next=/editor` continues into the editor instead of Explore Templates.
 */
export function resolveLoggedInOwnerDestination(
  input: LoggedInOwnerDestinationInput
): LoggedInOwnerDestination {
  const path = normalizePath(input.path);
  const search = input.search || '';
  const next = sanitizeOwnerNextPath(parseNextUrl(search));

  if (isSettingsProfilePath(path)) {
    if (input.profileComplete && next && isEditorPath(next)) {
      return { action: 'redirect', to: next, openProfile: false };
    }
    return { action: 'stay', to: withSearch(path, search), openProfile: true };
  }

  if (isEditorPath(path)) {
    if (!input.profileComplete) {
      return {
        action: 'redirect',
        to: buildSettingsProfileUrl(withSearch(path, search)),
        openProfile: true,
      };
    }
    return { action: 'stay', to: withSearch(path, search), openProfile: false };
  }

  return { action: 'stay', to: withSearch(path, search), openProfile: false };
}

/**
 * After a successful sign-in, honour `next=/editor` / current editor or
 * settings URL. Never fall back to `/` or the template explorer.
 */
export function resolvePostAuthDestination(path: string, search = ''): string {
  const next = sanitizeOwnerNextPath(parseNextUrl(search));
  if (next) return next;
  if (isEditorPath(path) || isSettingsProfilePath(path)) {
    return withSearch(path, search);
  }
  return EDITOR_PATH;
}

export { EDITOR_PATH, SETTINGS_PROFILE_PATH };
