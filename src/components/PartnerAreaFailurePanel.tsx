import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  Loader2,
  RefreshCw,
  ShieldQuestion,
  XCircle,
} from 'lucide-react';
import {
  classifyPartnerAreaFailure,
  type PartnerAreaFailure,
  type PartnerAreaReportCheck,
} from '../lib/partnerAreaFailure';
import {
  buildPartnerAreaReportFromDiagnostics,
  runPartnerAreaDiagnostics,
  type PartnerAreaDiagnosticReport,
} from '../lib/partnerAreaDiagnostics';

// ============================================================================
// The block that replaces "Please try again" as the end of the story.
//
// It answers, in this order:
//   1. who owns this failure  (you / support / an administrator)
//   2. what the next step is
//   3. what the live service actually says, on demand ("Run diagnostic")
//   4. a copyable report for support
//
// Nothing here decides access — the backend still does. This only reports what
// happened, truthfully, so a failure is never a dead end.
// ============================================================================

const OWNER_LABEL: Record<PartnerAreaFailure['owner'], string> = {
  you: 'You can fix this',
  support: 'Support has to act',
  administrator: 'An administrator has to act',
};

const CheckRow: React.FC<{ check: PartnerAreaReportCheck }> = ({ check }) => {
  const icon =
    check.status === 'pass' ? (
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
    ) : check.status === 'fail' ? (
      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
    ) : check.status === 'warn' ? (
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
    ) : (
      <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
    );
  return (
    <li className="flex gap-2 text-left">
      {icon}
      <span className="min-w-0">
        <span className="font-semibold text-slate-800">{check.label}</span>
        <span className="sr-only"> — {check.status}</span>
        {check.detail ? <span className="block break-words text-slate-600">{check.detail}</span> : null}
      </span>
    </li>
  );
};

export const PartnerAreaFailurePanel: React.FC<{
  /** The error the area actually failed with. */
  error: unknown;
  /**
   * The cause when a caller has already classified it (the service layer does).
   * Preferred over re-classifying `error`, which can lose a cause that carries
   * no HTTP status.
   */
  failure?: PartnerAreaFailure | null;
  /** Path shown in the report, e.g. `/partner/dashboard`. */
  route?: string | null;
  onRetry?: () => void;
  onSignIn?: () => void;
  /** Applied to the outer wrapper (screens and inline section cards differ). */
  className?: string;
}> = ({ error, failure: classified, route, onRetry, onSignIn, className = '' }) => {
  const failure = useMemo(
    () =>
      classified ??
      classifyPartnerAreaFailure(error, { online: typeof navigator !== 'undefined' ? navigator.onLine : null }),
    [classified, error]
  );
  const [report, setReport] = useState<PartnerAreaDiagnosticReport | null>(null);
  const [running, setRunning] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'failed'>('idle');

  const panelId = 'partner-area-diagnostic-panel';
  const reportText = report ? buildPartnerAreaReportFromDiagnostics(report) : '';

  const runDiagnostics = async () => {
    setRunning(true);
    setCopyState('idle');
    try {
      setReport(await runPartnerAreaDiagnostics({ error, route, failure }));
    } catch {
      // runPartnerAreaDiagnostics never throws by design; this is belt-and-braces
      // so the button can never appear dead.
      setReport(null);
    } finally {
      setRunning(false);
    }
  };

  const copyReport = async () => {
    if (!reportText) return;
    try {
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (!clipboard?.writeText) throw new Error('clipboard unavailable');
      await clipboard.writeText(reportText);
      setCopyState('ok');
    } catch {
      // No clipboard (jsdom, insecure origin, permission denied): the report is
      // printed below and can be selected by hand, so say that instead of
      // pretending the copy worked.
      setCopyState('failed');
    }
  };

  // One primary action, always labelled with what it will actually do: a filled
  // button when repeating the request can succeed, an outlined one when it only
  // re-checks the same state.
  const primaryOnClick =
    failure.kind === 'session-expired' ? onSignIn ?? onRetry : onRetry;
  const primaryActionLabel = failure.kind === 'session-expired' ? 'Sign in again' : failure.actionLabel;
  const primaryAction = primaryOnClick ? (
    <button
      type="button"
      onClick={() => primaryOnClick()}
      className={
        failure.retryable || failure.kind === 'session-expired'
          ? 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90'
          : 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 transition-colors hover:bg-slate-50'
      }
    >
      {failure.kind === 'session-expired' ? null : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
      {primaryActionLabel}
    </button>
  ) : null;

  return (
    <div className={`text-left ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-700">
          <Activity className="h-3.5 w-3.5" aria-hidden="true" />
          {failure.label}
        </span>
        <span className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
          {OWNER_LABEL[failure.owner]}
        </span>
      </div>

      {/* The sentence that ends the guesswork: whose problem is this? */}
      <p className="mt-3 text-sm text-slate-700">{failure.scopeSentence}</p>

      <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Next step</p>
        <p className="mt-1 text-sm text-slate-700">{failure.nextStep}</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {primaryAction}
        <button
          type="button"
          onClick={() => void runDiagnostics()}
          aria-expanded={!!report}
          aria-controls={panelId}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 transition-colors hover:bg-slate-50"
        >
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Activity className="h-4 w-4" aria-hidden="true" />
          )}
          {running ? 'Checking the live service…' : report ? 'Run diagnostic again' : 'Run diagnostic'}
        </button>
      </div>

      <div id={panelId} aria-live="polite" className="mt-4">
        {report ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Live checks · {report.checkedAt}
            </p>
            <ul className="mt-2 space-y-2 text-xs">
              {report.checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </ul>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void copyReport()}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 transition-colors hover:bg-slate-50"
              >
                <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
                Copy report for support
              </button>
              {copyState === 'ok' ? (
                <span role="status" className="text-xs font-bold text-emerald-700">
                  Report copied.
                </span>
              ) : null}
              {copyState === 'failed' ? (
                <span role="status" className="text-xs font-bold text-amber-700">
                  Copying is blocked in this browser — select the report below and copy it manually.
                </span>
              ) : null}
            </div>

            {/* Always visible: the copy button is a convenience, not the only way. */}
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
              {reportText}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default PartnerAreaFailurePanel;
