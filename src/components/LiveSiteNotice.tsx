import React from 'react';
import { AlertCircle } from 'lucide-react';
import type { LiveSiteNotice as LiveSiteNoticeContent } from '../lib/liveSite';

interface LiveSiteNoticeProps {
  notice: LiveSiteNoticeContent;
  /** The address Open Site leads to; named when it differs from the draft address. */
  liveUrl: string;
  onSave: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

/**
 * "You have unsaved changes" — shown beside the Open Site link when the draft is
 * ahead of the live website. It is information plus a shortcut to save: it never
 * blocks, delays or replaces the link.
 */
export const LiveSiteNotice: React.FC<LiveSiteNoticeProps> = ({ notice, liveUrl, onSave }) => {
  const failed = notice.kind === 'failed';
  return (
    <div
      role="status"
      data-testid="live-site-notice"
      data-notice-kind={notice.kind}
      className={`flex flex-col gap-2 rounded-xl border px-3 py-2.5 sm:flex-row sm:items-center ${
        failed ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <AlertCircle className={`mt-0.5 h-4 w-4 shrink-0 ${failed ? 'text-rose-500' : 'text-amber-500'}`} aria-hidden="true" />
        <div className="min-w-0 text-xs leading-relaxed">
          <p>
            <span className="font-bold">{notice.title}.</span> {notice.detail}
          </p>
          {notice.liveAddressDiffers && (
            <p className="mt-1 break-all font-mono text-[11px] font-bold" data-testid="live-site-notice-url">
              Live now: {liveUrl}
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onSave}
        className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border bg-white px-3 py-1.5 text-[11px] font-bold transition-colors ${
          failed ? 'border-rose-300 text-rose-800 hover:bg-rose-100' : 'border-amber-300 text-amber-800 hover:bg-amber-100'
        }`}
      >
        Save now
      </button>
    </div>
  );
};
