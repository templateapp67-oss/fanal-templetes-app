export type RestoredAuthState = { user: any; status: 'restoring' | 'ready' | 'error'; error?: string };

/** A late startup read must never overwrite a newer sign-in/sign-out event. */
export function observeAuthSession(auth: any, publish: (state: RestoredAuthState) => void) {
  let disposed = false;
  let revision = 0;
  let lastUser: any = null;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const emit = (state: RestoredAuthState) => { if (!disposed) publish(state); };

  const { data: { subscription } } = auth.onAuthStateChange((event: string, session: any) => {
    if (!session && event !== 'SIGNED_OUT') return;
    revision++;
    clearTimeout(retryTimer);
    lastUser = session?.user ?? null;
    attempt = 0;
    emit({ user: lastUser, status: 'ready' });
  });

  const restore = async () => {
    const readRevision = ++revision;
    clearTimeout(retryTimer);
    emit({ user: lastUser, status: 'restoring' });

    try {
      // Race against a 3-second timeout so the app never hangs indefinitely
      const sessionPromise = auth.getSession();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Session restore timeout')), 3000)
      );

      const { data, error } = (await Promise.race([sessionPromise, timeoutPromise])) as any;
      if (disposed || revision !== readRevision) return;
      if (error) throw error;
      lastUser = data?.session?.user ?? null;
      attempt = 0;
      emit({ user: lastUser, status: 'ready' });
    } catch {
      if (disposed || revision !== readRevision) return;
      // On failure or timeout, gracefully default to 'ready' with null user so landing/app is usable
      emit({ user: lastUser, status: 'ready' });
    }
  };

  void restore();
  return {
    retry: () => { attempt = 0; void restore(); },
    dispose: () => { disposed = true; revision++; clearTimeout(retryTimer); subscription.unsubscribe(); },
  };
}
