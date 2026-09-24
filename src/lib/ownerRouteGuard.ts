import { isEditorPath, normalizePath } from './router';

/**
 * Owner setup is a guard for the editor, not for general app navigation.
 * Home and Dashboard must always remain reachable after sign-in, including
 * while the first salon is still being created.
 */
export function requiresOwnerEditorSetup(pathname: string): boolean {
  return isEditorPath(pathname);
}

/**
 * The website builder is an explicit recovery route for a direct editor visit
 * without an owned salon. It is never a fallback for Home or Dashboard.
 */
export function shouldRedirectEditorToWebsiteOnboarding(
  pathname: string,
  ownedSalonCount: number
): boolean {
  return requiresOwnerEditorSetup(normalizePath(pathname)) && ownedSalonCount === 0;
}
