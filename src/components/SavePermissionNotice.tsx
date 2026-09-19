import React from 'react';
import { AlertTriangle, LogIn, RotateCcw } from 'lucide-react';

interface SavePermissionNoticeProps {
  /** Render nothing unless the save engine reported an unusable cloud session. */
  visible: boolean;
  /** Opens the sign-in modal so the owner can re-authenticate and publish. */
  onSignIn?: () => void;
  /** Re-runs the save (after a refresh or a successful sign-in). */
  onRetry?: () => void;
  /** Copy override for tests / future wording. */
  message?: string;
}

export const SESSION_EXPIRED_NOTICE =
  'Your session expired, so this website could not be published to the cloud. Your edits are saved on this device — sign in again and press Save to publish them.';

/**
 * Owner-facing notice for a cloud save that was rejected because the Supabase
 * session is no longer usable (expired/revoked token) even after a silent
 * refresh + retry.
 *
 * Before this existed the only feedback was the red toast
 * "Save failed: Database permission problem — please sign in again…", which
 * reads like a broken database/RLS schema and gives no path forward inside the
 * editor. This notice states what actually happened, what is safe locally, and
 * gives the two actions that fix it: sign in again, or retry the save.
 */
export const SavePermissionNotice: React.FC<SavePermissionNoticeProps> = ({
  visible,
  onSignIn,
  onRetry,
  message = SESSION_EXPIRED_NOTICE,
}) => {
  if (!visible) return null;
  return (
    <div
      role="alert"
      data-testid="save-session-expired-notice"
      className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900"
    >
      <AlertTriangle className="w-5 h-5 shrink-0 text-amber-500" />
      <p className="flex-1 text-xs font-medium leading-relaxed">{message}</p>
      <div className="flex items-center gap-2 shrink-0">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 bg-white hover:bg-amber-100 text-amber-800 text-[11px] font-bold transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Retry Save</span>
          </button>
        )}
        {onSignIn && (
          <button
            type="button"
            onClick={onSignIn}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#C20E5A] hover:bg-[#A30B4A] text-white text-[11px] font-bold transition-colors cursor-pointer"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign in again</span>
          </button>
        )}
      </div>
    </div>
  );
};
