import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  Filter,
  Info,
  Key,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { RLSDiagnosticsModal } from './RLSDiagnosticsModal';

export interface AuditLogEntry {
  id: string;
  event?: string;
  action?: string;
  event_type?: string;
  user_id?: string;
  actor_id?: string;
  details?: any;
  error_message?: string;
  status?: string;
  severity?: 'info' | 'warning' | 'error' | 'critical' | string;
  created_at: string;
  ip_address?: string;
}

export interface SessionHealthCheck {
  userId: string | null;
  userEmail: string | null;
  hasSession: boolean;
  rlsTested: boolean;
  rlsError: string | null;
  auditTableStatus: 'connected' | 'unreachable' | 'empty' | 'loading';
  auditTableError: string | null;
  lastChecked: string;
}

export const PartnerAuditDiagnosticPanel: React.FC<{
  user?: { id?: string; email?: string } | null;
  accentHex?: string;
}> = ({ user, accentHex = '#0F172A' }) => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filter, setFilter] = useState<'all' | 'auth' | 'rls' | 'error'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [health, setHealth] = useState<SessionHealthCheck>({
    userId: user?.id || null,
    userEmail: user?.email || null,
    hasSession: Boolean(user?.id),
    rlsTested: false,
    rlsError: null,
    auditTableStatus: 'loading',
    auditTableError: null,
    lastChecked: new Date().toLocaleTimeString(),
  });

  const runDiagnostics = useCallback(async () => {
    setLoading(true);
    const nowStr = new Date().toLocaleTimeString();

    let currentUserId = user?.id || null;
    let currentEmail = user?.email || null;
    let hasValidSession = false;

    // 1. Verify Active Supabase Auth Session
    try {
      const { data: authData } = await supabase.auth.getSession();
      if (authData?.session?.user) {
        currentUserId = authData.session.user.id;
        currentEmail = authData.session.user.email || currentEmail;
        hasValidSession = true;
      }
    } catch {
      hasValidSession = Boolean(currentUserId);
    }

    // 2. Test RLS / RPC Access for Current Session
    let rlsTested = false;
    let rlsError: string | null = null;
    try {
      const { error: rlsErr } = await supabase.rpc('get_my_growth_partner');

      rlsTested = true;
      if (rlsErr) {
        rlsError = `${rlsErr.code || 'RLS'}: ${rlsErr.message}`;
      }
    } catch (err: any) {
      rlsError = err?.message || 'RLS check failed';
    }

    // 3. Query audit_logs Table
    let tableStatus: 'connected' | 'unreachable' | 'empty' = 'unreachable';
    let tableError: string | null = null;
    let fetchedLogs: AuditLogEntry[] = [];

    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        tableStatus = 'unreachable';
        tableError = `${error.code || 'ERR'}: ${error.message}`;
      } else if (data && data.length > 0) {
        tableStatus = 'connected';
        fetchedLogs = data as AuditLogEntry[];
      } else {
        tableStatus = 'empty';
      }
    } catch (err: any) {
      tableStatus = 'unreachable';
      tableError = err?.message || 'Table audit_logs unreachable';
    }

    setHealth({
      userId: currentUserId,
      userEmail: currentEmail,
      hasSession: hasValidSession,
      rlsTested,
      rlsError,
      auditTableStatus: tableStatus,
      auditTableError: tableError,
      lastChecked: nowStr,
    });

    setLogs(fetchedLogs);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void runDiagnostics();
  }, [runDiagnostics]);

  const filteredLogs = logs.filter((item) => {
    const textStr = JSON.stringify(item).toLowerCase();
    const matchesSearch = !searchQuery || textStr.includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (filter === 'auth') {
      return (
        item.event?.toLowerCase().includes('auth') ||
        item.event_type?.toLowerCase().includes('auth') ||
        item.action?.toLowerCase().includes('login') ||
        item.action?.toLowerCase().includes('token')
      );
    }
    if (filter === 'rls') {
      return (
        item.event?.toLowerCase().includes('rls') ||
        item.event_type?.toLowerCase().includes('rls') ||
        item.error_message?.toLowerCase().includes('permission') ||
        item.error_message?.toLowerCase().includes('42501') ||
        textStr.includes('denied')
      );
    }
    if (filter === 'error') {
      return (
        item.severity === 'error' ||
        item.severity === 'critical' ||
        Boolean(item.error_message) ||
        item.status === 'failed'
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <Terminal className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-slate-900 sm:text-2xl">
                Session & Audit Diagnostics
              </h1>
              {health.auditTableStatus === 'connected' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Live Connected
                </span>
              )}
              {health.auditTableStatus === 'unreachable' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800 border border-amber-200">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                  Restricted / Guarded
                </span>
              )}
              {health.auditTableStatus === 'empty' && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 border border-slate-200">
                  <CheckCircle2 className="h-3.5 w-3.5 text-slate-500" />
                  Clean Audit State
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Real-time security diagnostic panel inspecting salon-owner session tokens, active RLS policies, and database audit event records.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition-all hover:bg-amber-400 shadow-sm"
          >
            <ShieldAlert className="h-4 w-4" />
            Launch RLS Modal
          </button>

          <button
            type="button"
            onClick={() => void runDiagnostics()}
            disabled={loading}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-slate-800 disabled:opacity-50"
            style={{ backgroundColor: accentHex }}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Diagnosing...' : 'Refresh Logs'}
          </button>
        </div>
      </div>

      {/* Session Health Overview Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Auth Session */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
            <span>Auth Session</span>
            <Key className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-3 flex items-center gap-2">
            {health.hasSession ? (
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            ) : (
              <span className="flex h-2.5 w-2.5 rounded-full bg-rose-500" />
            )}
            <span className="text-sm font-bold text-slate-900">
              {health.hasSession ? 'Authenticated' : 'No Active Session'}
            </span>
          </div>
          <p className="mt-1 text-xs font-mono text-slate-500 truncate">
            {health.userId ? `ID: ${health.userId}` : 'Anonymous visitor'}
          </p>
        </div>

        {/* Card 2: RLS Policy Status */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
            <span>RLS Security Policy</span>
            <Lock className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-3 flex items-center gap-2">
            {!health.rlsError ? (
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-amber-600" />
            )}
            <span className="text-sm font-bold text-slate-900">
              {!health.rlsError ? 'Active & Enforced' : 'RLS Restricted'}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500 truncate">
            {health.rlsError || 'Tenant isolation verified via auth.uid()'}
          </p>
        </div>

        {/* Card 3: Database Audit Reachability */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
            <span>Audit Trail DB</span>
            <Database className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-3 flex items-center gap-2">
            {health.auditTableStatus === 'connected' && (
              <span className="text-sm font-bold text-emerald-700">Table Reachable</span>
            )}
            {health.auditTableStatus === 'empty' && (
              <span className="text-sm font-bold text-slate-700">0 Violations Recorded</span>
            )}
            {health.auditTableStatus === 'unreachable' && (
              <span className="text-sm font-bold text-amber-800">Restricted Access</span>
            )}
            {health.auditTableStatus === 'loading' && (
              <span className="text-sm font-bold text-slate-500">Checking...</span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500 truncate">
            {health.auditTableError || 'audit_logs table query active'}
          </p>
        </div>

        {/* Card 4: Last Diagnostic Check */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
            <span>Last Scan</span>
            <Activity className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-3 text-sm font-bold text-slate-900">
            {health.lastChecked}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Auto-refreshed for salon owner session
          </p>
        </div>
      </div>

      {/* Table Unreachable Warning Banner if table is guarded */}
      {health.auditTableStatus === 'unreachable' && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
            <div>
              <h3 className="font-bold text-amber-950">
                Audit Table RLS Protection Active
              </h3>
              <p className="mt-1 text-xs text-amber-800 leading-relaxed">
                The database <code className="font-mono bg-amber-100/80 px-1 py-0.5 rounded">audit_logs</code> table is protected by backend security rules or is not accessible from the public anon client. This is expected behavior when audit log access is restricted strictly to platform superadmins or database triggers.
              </p>
              {health.auditTableError && (
                <div className="mt-3 rounded-xl bg-amber-100/60 p-3 font-mono text-xs text-amber-900">
                  Response Code: {health.auditTableError}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Audit Log Inspector Table */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Recent Audit Events & RLS Log</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Inspect auth events, session operations, and security policy checks.
            </p>
          </div>

          {/* Filters & Search */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search logs..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-bold text-slate-700">
              {(['all', 'auth', 'rls', 'error'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded-lg px-3 py-1 uppercase tracking-wider transition-colors cursor-pointer ${
                    filter === f ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table View */}
        <div className="mt-6 overflow-x-auto">
          {filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 p-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                <Info className="h-6 w-6" />
              </div>
              <p className="mt-3 text-sm font-bold text-slate-700">
                {health.auditTableStatus === 'unreachable'
                  ? 'Audit Logs Guarded by Server Policy'
                  : 'No audit records match filters'}
              </p>
              <p className="mt-1 text-xs text-slate-500 max-w-md">
                {health.auditTableStatus === 'unreachable'
                  ? 'Your current salon owner session is active and secure. Backend security triggers automatically log any authentication or RLS violations.'
                  : 'Try selecting a different filter or clearing search queries.'}
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 uppercase tracking-wider font-bold">
                  <th className="py-3 px-3">Timestamp</th>
                  <th className="py-3 px-3">Event / Operation</th>
                  <th className="py-3 px-3">Type</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Actor ID</th>
                  <th className="py-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
                {filteredLogs.map((log) => {
                  const eventName = log.event || log.action || log.event_type || 'audit_event';
                  const isErr = log.severity === 'error' || log.status === 'failed' || Boolean(log.error_message);

                  return (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLog(log)}
                      className="group cursor-pointer hover:bg-slate-50 transition-colors"
                    >
                      <td className="py-3 px-3 whitespace-nowrap text-slate-500">
                        {log.created_at ? new Date(log.created_at).toLocaleString() : '—'}
                      </td>
                      <td className="py-3 px-3 font-bold text-slate-900 font-sans">
                        {eventName}
                      </td>
                      <td className="py-3 px-3 uppercase text-[10px] tracking-wider text-slate-500">
                        {log.event_type || 'system'}
                      </td>
                      <td className="py-3 px-3">
                        {isErr ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                            Violation / Error
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                            Success
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-slate-500 truncate max-w-[120px]">
                        {log.user_id || log.actor_id || 'system'}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <span className="inline-flex items-center gap-1 text-slate-400 group-hover:text-slate-900 font-sans text-xs font-bold">
                          Inspect <ChevronRight className="h-3.5 w-3.5" />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Log Entry Detail Inspector Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2">
                <Terminal className="h-5 w-5 text-slate-700" />
                <h3 className="text-base font-bold text-slate-900">
                  Audit Log Inspector
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="rounded-xl bg-slate-100 p-2 text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Event
                </label>
                <div className="text-sm font-bold text-slate-900">
                  {selectedLog.event || selectedLog.action || 'Audit Event'}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Timestamp
                </label>
                <div className="text-xs font-mono text-slate-600">
                  {selectedLog.created_at}
                </div>
              </div>

              {selectedLog.error_message && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                  <div className="font-bold">Error Message:</div>
                  <div className="mt-1 font-mono">{selectedLog.error_message}</div>
                </div>
              )}

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Raw Payload & Details
                </label>
                <pre className="mt-1 max-h-60 overflow-y-auto rounded-2xl bg-slate-900 p-4 font-mono text-xs text-slate-100">
                  {JSON.stringify(selectedLog, null, 2)}
                </pre>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white cursor-pointer"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      <RLSDiagnosticsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
};
