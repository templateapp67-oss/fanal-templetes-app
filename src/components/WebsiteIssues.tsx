import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { WebsiteFieldIssue } from '../lib/websiteValidation';

// ============================================================================
// Field-level save problems in the editor.
//
// The app computes the issues once (src/lib/websiteContentNormalize.ts) and
// provides them here. Inputs look up their own problem by `path`
// (`services[2].price`, `profile.gallery[0].url`…), turn red and show the
// message next to themselves; the panel lists everything and jumps to a field.
//
// Nothing is shown until `revealed` — i.e. until a save was attempted and
// blocked — so a half-typed value never flashes red while the owner types.
// ============================================================================

export interface WebsiteIssuesValue {
  issues: readonly WebsiteFieldIssue[];
  revealed: boolean;
}

const EMPTY: WebsiteIssuesValue = { issues: [], revealed: false };
const IssuesContext = createContext<WebsiteIssuesValue>(EMPTY);

export function WebsiteIssuesProvider({ issues, revealed, children }: {
  issues: readonly WebsiteFieldIssue[];
  revealed: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ issues, revealed }), [issues, revealed]);
  return <IssuesContext.Provider value={value}>{children}</IssuesContext.Provider>;
}

export function useWebsiteIssues(): WebsiteIssuesValue {
  return useContext(IssuesContext);
}

const errorFirst = (issues: WebsiteFieldIssue[]) =>
  issues.find((issue) => issue.severity === 'error') ?? issues[0];

/** The problem with exactly this field (an error beats a warning), once revealed. */
export function useFieldIssue(path: string | undefined): WebsiteFieldIssue | undefined {
  const { issues, revealed } = useContext(IssuesContext);
  return useMemo(
    () => (revealed && path ? errorFirst(issues.filter((issue) => issue.path === path)) : undefined),
    [issues, revealed, path]
  );
}

/** Every revealed problem at or below `prefix` (`services[1]` covers `services[1].price`). */
export function useIssuesUnder(prefix: string | undefined): WebsiteFieldIssue[] {
  const { issues, revealed } = useContext(IssuesContext);
  return useMemo(() => {
    if (!revealed || !prefix) return [];
    return issues.filter((issue) =>
      issue.path === prefix || issue.path.startsWith(`${prefix}.`) || issue.path.startsWith(`${prefix}[`));
  }, [issues, revealed, prefix]);
}

export const fieldErrorId = (path: string) => `field-error-${path.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;

/**
 * Swap a neutral border for a red one (amber for a warning). Class strings are
 * rewritten instead of appended so the highlight wins regardless of the order
 * Tailwind emits its utilities in.
 */
export function withIssueStyle(className: string, issue: Pick<WebsiteFieldIssue, 'severity'> | undefined): string {
  if (!issue) return className;
  const tone = issue.severity === 'error'
    ? { border: 'border-red-500', extra: 'bg-red-50/60 ring-1 ring-red-300' }
    : { border: 'border-amber-500', extra: 'bg-amber-50/60 ring-1 ring-amber-300' };
  return `${className.replace(/\bborder-(?:slate|gray|zinc|neutral)-\d{2,3}\b/g, tone.border)} ${tone.border} ${tone.extra}`;
}

/** What an input needs to show `issue` — for places that cannot call a hook (inside a `.map`). */
export function issueFieldProps(path: string | undefined, issue: WebsiteFieldIssue | undefined) {
  return {
    issue,
    /** Spread onto the input/textarea/select. */
    attrs: {
      ...(path ? { 'data-field-path': path } : {}),
      ...(issue && path ? {
        'aria-invalid': issue.severity === 'error' ? (true as const) : undefined,
        'aria-describedby': fieldErrorId(path),
      } : {}),
    },
    /** Class string with the red/amber highlight applied. */
    className: (base: string) => withIssueStyle(base, issue),
  };
}

/** Everything an input needs to show its own problem. */
export function useFieldIssueProps(path: string | undefined) {
  return issueFieldProps(path, useFieldIssue(path));
}

/** `issueAt('services[1].name')` for code that renders many fields in a loop. */
export function useIssueLookup(): (path: string) => WebsiteFieldIssue | undefined {
  const { issues, revealed } = useContext(IssuesContext);
  return useMemo(
    () => (path: string) => (revealed ? errorFirst(issues.filter((issue) => issue.path === path)) : undefined),
    [issues, revealed]
  );
}

/** The message under a field. Renders nothing when the field has no (revealed) problem. */
export function FieldError({ path, className = '' }: { path: string; className?: string }) {
  const issue = useFieldIssue(path);
  if (!issue) return null;
  const isError = issue.severity === 'error';
  return (
    <p
      id={fieldErrorId(path)}
      role={isError ? 'alert' : 'status'}
      data-field-error={path}
      className={`mt-1 text-xs font-semibold ${isError ? 'text-red-700' : 'text-amber-700'} ${className}`}
    >
      {issue.message}
    </p>
  );
}

/** All problems of one list item (a testimonial, a team member…) as a short list. */
export function ItemIssues({ prefix, className = '' }: { prefix: string; className?: string }) {
  const issues = useIssuesUnder(prefix);
  if (!issues.length) return null;
  return (
    <ul className={`mt-2 space-y-1 ${className}`} data-item-issues={prefix}>
      {issues.map((issue) => (
        <li
          key={`${issue.path}:${issue.message}`}
          role={issue.severity === 'error' ? 'alert' : 'status'}
          data-field-error={issue.path}
          className={`text-xs font-semibold ${issue.severity === 'error' ? 'text-red-700' : 'text-amber-700'}`}
        >
          {issue.label.includes('›') ? `${issue.label.split('›').slice(1).join('›').trim()}: ` : ''}{issue.message}
        </li>
      ))}
    </ul>
  );
}

/** Keep a <details> row open while it contains a problem (never closes it again). */
export function useOpenWhenInvalid(hasIssue: boolean) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (hasIssue && ref.current) ref.current.open = true;
  }, [hasIssue]);
  return ref;
}

/**
 * Scroll to and focus the input that owns `path`. Falls back from
 * `services[2].price` to `services[2]` to `services` so a problem that has no
 * input of its own still lands on the right card. Returns false when nothing
 * on the page carries a matching `data-field-path`.
 */
export function focusWebsiteField(path: string, root: ParentNode = document): boolean {
  let candidate = path;
  let element: HTMLElement | null = null;
  while (candidate && !element) {
    element = root.querySelector<HTMLElement>(`[data-field-path="${candidate.replace(/["\\]/g, '\\$&')}"]`);
    if (!element) {
      const shorter = candidate.replace(/(?:\.[^.[\]]+|\[\d+\])$/, '');
      if (shorter === candidate) break;
      candidate = shorter;
    }
  }
  if (!element) return false;
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (node.tagName === 'DETAILS') (node as HTMLDetailsElement).open = true;
  }
  element.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  const focusable = element.matches('input,textarea,select,button')
    ? element
    : element.querySelector<HTMLElement>('input:not([type="file"]),textarea,select');
  focusable?.focus?.({ preventScroll: true });
  return true;
}

/** Bring the summary panel into view (after a manual save was blocked). */
export function scrollToIssuesPanel(): boolean {
  const panel = typeof document === 'undefined' ? null : document.getElementById('website-issues-panel');
  if (!panel) return false;
  panel.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  return true;
}

/**
 * Summary of what stopped the save, with a jump link per field. Shows only
 * after a save was attempted and blocked (`revealed`) and something blocks it.
 */
export function WebsiteIssuesPanel({ className = '' }: { className?: string }) {
  const { issues, revealed } = useWebsiteIssues();
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  if (!revealed || !errors.length) return null;
  return (
    <section
      id="website-issues-panel"
      role="alert"
      aria-labelledby="website-issues-heading"
      data-testid="website-issues-panel"
      className={`rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900 shadow-sm ${className}`}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="website-issues-heading" className="text-sm font-bold">
            {errors.length === 1
              ? '1 field needs fixing before your website can be saved'
              : `${errors.length} fields need fixing before your website can be saved`}
          </h2>
          <p className="mt-0.5 text-xs text-red-800">Your other changes are kept on this device. Fix the highlighted fields and save again.</p>
          <ul className="mt-3 space-y-2">
            {errors.map((issue) => (
              <li key={`${issue.path}:${issue.message}`} className="text-xs">
                <button
                  type="button"
                  onClick={() => focusWebsiteField(issue.path)}
                  className="text-left font-bold text-red-900 underline decoration-red-300 underline-offset-2 hover:decoration-red-700"
                >
                  {issue.label}
                </button>
                <span className="block text-red-800">{issue.message}</span>
              </li>
            ))}
          </ul>
          {warnings.length > 0 && (
            <div className="mt-3 border-t border-red-200 pt-3">
              <h3 className="text-xs font-bold text-amber-900">Also worth checking (these do not block saving)</h3>
              <ul className="mt-1.5 space-y-1.5">
                {warnings.map((issue) => (
                  <li key={`${issue.path}:${issue.message}`} className="text-xs text-amber-900">
                    <button type="button" onClick={() => focusWebsiteField(issue.path)} className="text-left font-semibold underline decoration-amber-300 underline-offset-2">
                      {issue.label}
                    </button>
                    <span className="block">{issue.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** "2,150 / 2,000 characters" — appears only when the text nears (or passes) the database limit. */
export function CharCounter({ value, limit, className = '', overNote }: { value?: string; limit: number; className?: string; overNote?: string }) {
  const length = Array.from(value ?? '').length;
  if (length < limit * 0.85) return null;
  return (
    <p data-char-counter className={`mt-1 text-[11px] ${length > limit ? 'font-bold text-red-700' : 'text-slate-500'} ${className}`}>
      {length.toLocaleString('en-US')} / {limit.toLocaleString('en-US')} characters
      {length > limit && overNote ? <span className="font-normal"> — {overNote}</span> : null}
    </p>
  );
}
