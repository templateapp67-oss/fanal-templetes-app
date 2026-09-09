export class BookingSessionError extends Error {}

/** Refresh a rejected token once. Never send an anonymous request for private rows. */
export async function authenticatedBookingRead(auth: any, url: string, ownerId?: string | null,
  fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<Response> {
  const sessionResult = await auth.getSession();
  if (sessionResult.error) throw sessionResult.error;
  let session = sessionResult.data?.session;
  const validate = () => {
    if (!session?.access_token) throw new BookingSessionError('Please sign in to load your bookings.');
    if (ownerId && session.user?.id !== ownerId) throw new BookingSessionError('Your account changed. Reopen Bookings to load this account.');
  };
  validate();
  const request = () => fetcher(url, { headers: { Authorization: `Bearer ${session.access_token}` }, signal });
  let response = await request();
  if (response.status !== 401) return response;
  const refreshed = await auth.refreshSession();
  session = refreshed.data?.session;
  if (refreshed.error || !session) throw new BookingSessionError('Your session has expired. Sign in to continue.');
  validate();
  response = await request();
  if (response.status === 401) throw new BookingSessionError('Your session could not be verified. Sign in to continue.');
  return response;
}
