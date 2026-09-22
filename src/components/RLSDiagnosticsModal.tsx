import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  ShieldAlert,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Database,
  Search,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Terminal,
  Activity,
  FileText
} from 'lucide-react';
import { supabase, isMockSupabase } from '../lib/supabaseClient';
import { runRLSDiagnosticSuite, type DiagnosticSuiteReport } from '../lib/diagnostics';

export interface AuditLogItem {
  id: string;
  created_at: string;
  user_id?: string | null;
  actor_id?: string | null;
  action?: string | null;
  event_type?: string | null;
  table_name?: string | null;
  resource?: string | null;
  status?: string | null;
  policy_name?: string | null;
  error_message?: string | null;
  details?: any;
  payload?: any;
  metadata?: any;
}

interface RLSDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Optional initial report from app state */
  initialReport?: DiagnosticSuiteReport | null;
}

export const RLSDiagnosticsModal: React.FC<RLSDiagnosticsModalProps> = ({
  isOpen,
  onClose,
  initialReport = null,
}) => {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUid, setCurrentUid] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'blocked' | 'allowed'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Diagnostic suite state
  const [suiteReport, setSuiteReport] = useState<DiagnosticSuiteReport | null>(initialReport);
  const [runningSuite, setRunningSuite] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'audit_logs' | 'live_tests'>('audit_logs');

  const fetchAuditLogs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // 1. Get current user ID
      const { data: authData } = await supabase.auth.getUser();
      const uid = authData?.user?.id ?? null;
      setCurrentUid(uid);

      if (isMockSupabase) {
        // Mock audit logs when in mock mode
        const mockLogs: AuditLogItem[] = [
          {
            id: 'log-1',
            created_at: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
            user_id: uid || 'mock-user-123',
            action: 'UPDATE',
            table_name: 'profiles',
            status: 'allowed',
            policy_name: 'Users can update own profile',
            details: { updated_fields: ['full_name'], auth_role: 'authenticated' },
          },
          {
            id: 'log-2',
            created_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
            user_id: uid || 'mock-user-123',
            action: 'INSERT',
            table_name: 'salons',
            status: 'blocked',
            policy_name: 'Owners can insert salons for owned organizations',
            error_message: '[42501] new row violates row-level security policy for table "salons"',
            details: { organization_id: 'org-demo-999', error_code: '42501' },
          },
          {
            id: 'log-3',
            created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
            user_id: uid || 'mock-user-123',
            action: 'SELECT',
            table_name: 'organization_members',
            status: 'allowed',
            policy_name: 'Members can view organization memberships',
            details: { row_count: 2 },
          },
        ];
        setLogs(mockLogs);
        setLoading(false);
        return;
      }

      // 2. Fetch from real database audit_logs table
      let query = supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (uid) {
        // Attempt filtering by current auth.uid()
        try {
          query = query.or(`user_id.eq.${uid},actor_id.eq.${uid},created_by.eq.${uid}`);
        } catch {
          // Fallback if OR query syntax fails on specific column setup
          query = query.eq('user_id', uid);
        }
      }

      const { data, error: fetchErr } = await query;

      if (fetchErr) {
        // If specific user filter failed due to column names, fallback to standard query
        const fallbackRes = await supabase
          .from('audit_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);

        if (fallbackRes.error) {
          setError(`[${fallbackRes.error.code || '42501'}] ${fallbackRes.error.message}`);
          setLogs([]);
        } else {
          setLogs((fallbackRes.data as AuditLogItem[]) || []);
        }
      } else {
        setLogs((data as AuditLogItem[]) || []);
      }
    } catch (err: any) {
      console.warn('[RLSDiagnosticsModal] Fetch audit_logs error:', err);
      setError(err?.message || 'Failed to query audit_logs table');
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRunSuite = async () => {
    setRunningSuite(true);
    try {
      const report = await runRLSDiagnosticSuite();
      setSuiteReport(report);
    } catch (err: any) {
      console.error('[RLSDiagnosticsModal] Diagnostic suite failed:', err);
    } finally {
      setRunningSuite(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void fetchAuditLogs();
      if (!suiteReport) {
        void handleRunSuite();
      }
    }
  }, [isOpen, fetchAuditLogs]);

  // Filter logs based on search query and status tab
  const filteredLogs = logs.filter((log) => {
    const actionStr = (log.action || log.event_type || '').toLowerCase();
    const tableStr = (log.table_name || log.resource || '').toLowerCase();
    const policyStr = (log.policy_name || '').toLowerCase();
    const errorStr = (log.error_message || '').toLowerCase();
    const statusStr = (log.status || '').toLowerCase();

    const isBlocked =
      statusStr.includes('block') ||
      statusStr.includes('deni') ||
      statusStr.includes('violat') ||
      statusStr.includes('error') ||
      Boolean(log.error_message);

    if (filterStatus === 'blocked' && !isBlocked) return false;
    if (filterStatus === 'allowed' && isBlocked) return false;

    if (!searchQuery.trim()) return true;

    const query = searchQuery.toLowerCase();
    return (
      actionStr.includes(query) ||
      tableStr.includes(query) ||
      policyStr.includes(query) ||
      errorStr.includes(query) ||
      statusStr.includes(query)
    );
  });

  const handleCopyJson = () => {
    const exportData = {
      user_id: currentUid,
      suite_report: suiteReport,
      audit_logs: filteredLogs,
    };
    navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="relative w-full max-w-5xl max-h-[90vh] bg-white rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rls-modal-title"
        >
          {/* Header */}
          <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h2 id="rls-modal-title" className="text-base font-bold text-white flex items-center gap-2">
                  RLS Security & Audit Diagnostics
                  {isMockSupabase && (
                    <span className="text-[10px] font-semibold bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700">
                      Mock Mode
                    </span>
                  )}
                </h2>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  auth.uid(): <span className="text-amber-300 font-semibold">{currentUid || 'Anonymous / None'}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyJson}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors border border-slate-700"
                title="Copy diagnostic report to clipboard"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy Report'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="px-6 pt-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('audit_logs')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  activeTab === 'audit_logs'
                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText className="w-4 h-4 text-slate-500" />
                Audit Logs Table
                <span className="ml-1 text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full font-mono">
                  {filteredLogs.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('live_tests')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  activeTab === 'live_tests'
                    ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Activity className="w-4 h-4 text-amber-500" />
                Live RLS Test Suite
                {suiteReport?.hasAnyRLSViolation && (
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                )}
              </button>
            </div>

            <div className="flex items-center gap-2 pb-2 sm:pb-0">
              <button
                type="button"
                onClick={() => {
                  void fetchAuditLogs();
                  void handleRunSuite();
                }}
                disabled={loading || runningSuite}
                className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading || runningSuite ? 'animate-spin text-amber-500' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {/* Tab Content Area */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {activeTab === 'audit_logs' && (
              <div className="space-y-4">
                {/* Search & Filter Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="relative flex-1 min-w-[240px]">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter by table, policy, or error code..."
                      className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    />
                  </div>

                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setFilterStatus('all')}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                        filterStatus === 'all'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      All Logs
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterStatus('blocked')}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                        filterStatus === 'blocked'
                          ? 'bg-rose-500 text-white shadow-sm'
                          : 'text-slate-600 hover:text-rose-600'
                      }`}
                    >
                      Blocked / RLS Violations
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterStatus('allowed')}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                        filterStatus === 'allowed'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-slate-600 hover:text-emerald-700'
                      }`}
                    >
                      Allowed
                    </button>
                  </div>
                </div>

                {/* Error Banner if table unreachable */}
                {error && (
                  <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-3">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Audit Logs Table Query Notice</p>
                      <p className="mt-0.5 text-amber-800">{error}</p>
                      <p className="mt-1 text-[11px] text-amber-700">
                        If the <code className="font-mono bg-amber-100 px-1 rounded">audit_logs</code> table is restricted by backend RLS, check the <strong>Live RLS Test Suite</strong> tab below for direct table-level write/read test status.
                      </p>
                    </div>
                  </div>
                )}

                {/* Audit Logs Table */}
                <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                  {loading ? (
                    <div className="py-12 text-center text-slate-500 text-xs flex flex-col items-center justify-center gap-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-amber-500" />
                      Fetching recent audit logs for auth.uid()...
                    </div>
                  ) : filteredLogs.length === 0 ? (
                    <div className="py-12 text-center px-4">
                      <Lock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm font-bold text-slate-800">No matching audit logs found</p>
                      <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                        No write/read blocks recorded for auth.uid() <code className="font-mono bg-slate-100 px-1 rounded">{currentUid || 'None'}</code> matching the current filter.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                            <th scope="col" className="py-3 px-4 w-8"></th>
                            <th scope="col" className="py-3 px-4">Time</th>
                            <th scope="col" className="py-3 px-4">Action</th>
                            <th scope="col" className="py-3 px-4">Target Table</th>
                            <th scope="col" className="py-3 px-4">Status / Policy</th>
                            <th scope="col" className="py-3 px-4">Details / Reason</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredLogs.map((log) => {
                            const isExpanded = expandedRowId === log.id;
                            const action = (log.action || log.event_type || 'UNKNOWN').toUpperCase();
                            const targetTable = log.table_name || log.resource || '—';
                            const policyName = log.policy_name || 'Standard RLS Policy';
                            const isBlocked =
                              Boolean(log.error_message) ||
                              (log.status && (log.status.includes('block') || log.status.includes('deni')));

                            return (
                              <React.Fragment key={log.id}>
                                <tr
                                  onClick={() => setExpandedRowId(isExpanded ? null : log.id)}
                                  className={`hover:bg-slate-50/80 cursor-pointer transition-colors ${
                                    isBlocked ? 'bg-rose-50/30' : ''
                                  }`}
                                >
                                  <td className="py-3 px-4 text-slate-400">
                                    {isExpanded ? (
                                      <ChevronDown className="w-4 h-4 text-slate-600" />
                                    ) : (
                                      <ChevronRight className="w-4 h-4" />
                                    )}
                                  </td>
                                  <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                                    {new Date(log.created_at).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      second: '2-digit',
                                    })}
                                  </td>
                                  <td className="py-3 px-4 font-bold">
                                    <span
                                      className={`px-2 py-0.5 rounded-md text-[10px] uppercase font-mono ${
                                        action === 'INSERT'
                                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                          : action === 'UPDATE'
                                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                          : action === 'DELETE'
                                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                          : 'bg-slate-100 text-slate-700 border border-slate-200'
                                      }`}
                                    >
                                      {action}
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 font-mono font-bold text-slate-800">
                                    {targetTable}
                                  </td>
                                  <td className="py-3 px-4">
                                    {isBlocked ? (
                                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800">
                                        <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                                        Blocked (RLS)
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                        Allowed
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-3 px-4 font-medium text-slate-600 truncate max-w-xs">
                                    {log.error_message ? (
                                      <span className="text-rose-700 font-mono text-[11px] truncate block" title={log.error_message}>
                                        {log.error_message}
                                      </span>
                                    ) : (
                                      <span className="text-slate-600 text-xs">{policyName}</span>
                                    )}
                                  </td>
                                </tr>

                                {/* Expanded JSON Row */}
                                {isExpanded && (
                                  <tr className="bg-slate-900 text-slate-200 border-b border-slate-800">
                                    <td colSpan={6} className="p-4 font-mono text-xs">
                                      <div className="space-y-2">
                                        <div className="flex items-center justify-between text-slate-400 text-[11px]">
                                          <span>Log Payload Details (ID: {log.id})</span>
                                          <span>User: {log.user_id || log.actor_id || currentUid}</span>
                                        </div>
                                        {log.error_message && (
                                          <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-200 text-xs">
                                            <strong>Error Message:</strong> {log.error_message}
                                          </div>
                                        )}
                                        <pre className="p-3 rounded-lg bg-slate-950 text-emerald-400 overflow-x-auto text-[11px] leading-relaxed border border-slate-800">
                                          {JSON.stringify(
                                            log.details || log.payload || log.metadata || log,
                                            null,
                                            2
                                          )}
                                        </pre>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Live Tests Tab */}
            {activeTab === 'live_tests' && (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-slate-900 text-white flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <Terminal className="w-5 h-5 text-amber-400" />
                    <div>
                      <h3 className="text-sm font-bold text-white">Proactive RLS Diagnostic Runner</h3>
                      <p className="text-xs text-slate-400">
                        Executes live SELECT, INSERT, and UPDATE tests against core tables for auth.uid() = {currentUid || 'None'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleRunSuite}
                    disabled={runningSuite}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-all flex items-center gap-2 shadow-sm disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${runningSuite ? 'animate-spin' : ''}`} />
                    {runningSuite ? 'Testing RLS Policies...' : 'Re-run RLS Suite'}
                  </button>
                </div>

                {suiteReport && (
                  <div className="space-y-4">
                    {/* Overall Summary Card */}
                    <div
                      className={`p-4 rounded-2xl border flex items-start gap-3 ${
                        suiteReport.hasAnyRLSViolations
                          ? 'bg-rose-50 border-rose-200 text-rose-900'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      }`}
                    >
                      {suiteReport.hasAnyRLSViolations ? (
                        <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                      ) : (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide">
                          {suiteReport.hasAnyRLSViolations ? 'Policy Blocking Detected' : 'All RLS Policies Operational'}
                        </p>
                        <p className="text-sm font-bold mt-0.5">{suiteReport.summary}</p>
                        <p className="text-xs opacity-75 mt-1 font-mono">Ran at {new Date(suiteReport.timestamp).toLocaleString()}</p>
                      </div>
                    </div>

                    {/* Table Specific Breakdown */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {(['profiles', 'salons', 'organization_members'] as const).map((tableName) => {
                        const tableData = suiteReport.tables[tableName];
                        return (
                          <div
                            key={tableName}
                            className={`p-4 rounded-2xl border bg-white shadow-sm space-y-3 ${
                              tableData.hasRLSViolation ? 'border-rose-300 ring-2 ring-rose-500/10' : 'border-slate-200'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <h4 className="text-xs font-bold font-mono text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                                <Database className="w-3.5 h-3.5 text-slate-500" />
                                {tableName}
                              </h4>
                              {tableData.hasRLSViolation ? (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800">
                                  Policy Block
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                                  Clean
                                </span>
                              )}
                            </div>

                            <div className="space-y-2 text-xs">
                              {/* SELECT */}
                              <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50">
                                <span className="font-mono font-semibold text-slate-700">SELECT</span>
                                {tableData.select.ok ? (
                                  <span className="text-emerald-600 font-bold text-[11px] flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" /> OK
                                  </span>
                                ) : (
                                  <span className="text-rose-600 font-bold text-[11px] flex items-center gap-1" title={tableData.select.error || ''}>
                                    <AlertTriangle className="w-3 h-3" /> Failed
                                  </span>
                                )}
                              </div>

                              {/* INSERT */}
                              <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50">
                                <span className="font-mono font-semibold text-slate-700">INSERT</span>
                                {tableData.insert.ok ? (
                                  <span className="text-emerald-600 font-bold text-[11px] flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" /> OK
                                  </span>
                                ) : (
                                  <span className="text-rose-600 font-bold text-[11px] flex items-center gap-1" title={tableData.insert.error || ''}>
                                    <AlertTriangle className="w-3 h-3" /> Blocked
                                  </span>
                                )}
                              </div>

                              {/* UPDATE */}
                              <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50">
                                <span className="font-mono font-semibold text-slate-700">UPDATE</span>
                                {tableData.update.ok ? (
                                  <span className="text-emerald-600 font-bold text-[11px] flex items-center gap-1">
                                    <CheckCircle2 className="w-3 h-3" /> OK
                                  </span>
                                ) : (
                                  <span className="text-rose-600 font-bold text-[11px] flex items-center gap-1" title={tableData.update.error || ''}>
                                    <AlertTriangle className="w-3 h-3" /> Blocked
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              Proactive RLS & Audit Diagnostic Engine
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold transition-colors"
            >
              Close Diagnostics
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
