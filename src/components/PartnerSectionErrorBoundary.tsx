import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

// ============================================================================
// A last line of defence for ONE card of a partner page.
//
// React unmounts the whole tree when a render throws, so a single bad row
// (a session with a malformed timestamp, a null event) used to blank the
// entire /partner/account-settings route. React has no hook-based error
// boundary, so this is a small class component: it catches a throw from the
// subtree below it, renders an honest fallback there, and offers a Reset that
// remounts only that subtree.
// ============================================================================

interface Props {
  /** Shown in the fallback so the user knows which card failed. */
  label: string;
  /** Changing this value clears a caught error (e.g. after a successful refetch). */
  resetKey?: string | number;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class PartnerSectionErrorBoundary extends Component<Props, State> {
  // `props` and `setState` are declared explicitly: this repo builds without
  // @types/react, so the inherited members are not visible to the compiler.
  // Both are declaration-only — with `useDefineForClassFields: false` they
  // emit nothing, so React's own instance/prototype members are untouched
  // (the same pattern src/main.tsx uses for `props`).
  props: Props;
  setState: (patch: Partial<State>, callback?: () => void) => void;
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Local-only diagnostics: a section failure should be visible in the
    // console without leaking anything to the surface.
    if (typeof console !== 'undefined') {
      console.error(`[partner-ui] ${this.props.label} failed to render:`, error?.message || error, info?.componentStack || '');
    }
  }

  componentDidUpdate(previous: Props): void {
    // The data underneath changed (a successful retry) — let the children try again.
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  private reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section
        role="alert"
        data-partner-section-error={this.props.label}
        className="rounded-2xl border border-rose-200 bg-rose-50 p-4"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-rose-900">{this.props.label} could not be displayed.</p>
            <p className="mt-0.5 text-xs text-rose-800">
              The rest of this page is unaffected. Retry this card, or reload the page if it keeps happening.
            </p>
            <button
              type="button"
              onClick={this.reset}
              data-partner-section-retry
              className="mt-3 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700"
            >
              Retry this section
            </button>
          </div>
        </div>
      </section>
    );
  }
}
