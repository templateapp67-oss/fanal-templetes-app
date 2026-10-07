export type RestoredAuthState = { user: any; status: 'restoring' | 'ready' | 'error'; error?: string };

/** A late startup read must never overwrite a newer sign-in/sign-out event. */
export function observeAuthSession(auth: any, publish: (state: RestoredAuthState) => void) {
  let disposed = false;
  let revision = 0;
  let lastUser: any = null;
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  const clearPendingTimers = () => {
    for (const timer of pendingTimers) clearTimeout(timer);
    pendingTimers.clear();
  };
  const emit = (state: RestoredAuthState) => { if (!disposed) publish(state); };

  const { data: { subscription } } = auth.onAuthStateChange((event: string, session: any) => {
    if (!session && event !== 'SIGNED_OUT') return;
    revision++;
    clearPendingTimers();
    lastUser = session?.user ?? null;
    emit({ user: lastUser, status: 'ready' });
  });

  const restore = async () => {
    const readRevision = ++revision;
    emit({ user: lastUser, status: 'restoring' });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // Race against a 3-second timeout so the app never hangs indefinitely
      const sessionPromise = auth.getSession();
      const timeoutPromise = new Promise((_, reject) =>
        timeout = setTimeout(() => reject(new Error('Session restore timeout')), 3000)
      );
      pendingTimers.add(timeout!);

      const { data, error } = (await Promise.race([sessionPromise, timeoutPromise])) as any;
      if (disposed || revision !== readRevision) return;
      if (error) throw error;
      lastUser = data?.session?.user ?? null;
      emit({ user: lastUser, status: 'ready' });
    } catch {
      if (disposed || revision !== readRevision) return;
      // An unavailable session read does not prove that the user signed out.
      // Keep the established identity and expose the existing connection retry UI.
      emit({ user: lastUser, status: 'error', error: 'Could not restore your login. Check your connection and retry.' });
    } finally {
      clearTimeout(timeout);
      if (timeout) pendingTimers.delete(timeout);
    }
  };

  void restore();
  return {
    retry: () => { void restore(); },
    dispose: () => { disposed = true; revision++; clearPendingTimers(); subscription.unsubscribe(); },
  };
}
