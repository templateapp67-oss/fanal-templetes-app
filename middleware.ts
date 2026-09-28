/**
 * Keep the Vite SPA reachable on every Vercel route.
 *
 * The previous edge metadata renderer imported server-side modules and caused
 * `MIDDLEWARE_INVOCATION_FAILED` before the browser could load the app. Public
 * metadata is handled by the API/server runtime; this edge hook must remain a
 * no-op until it has an independently verified edge-safe implementation.
 */
export default function middleware(_request: Request): undefined {
  return undefined;
}
