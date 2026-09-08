import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaffCommissionDashboard } from '../src/components/StaffCommissionDashboard';
import {
  STAFF_COMMISSION_PATH as CONTRACT_PATH,
  STAFF_COMMISSION_RPCS,
  aggregatePayoutTotals,
  csvFromPayoutHistory,
  csvFromPayoutSummary,
  currentSettingsOnly,
  normalizePayoutSummaryRow,
  validateCommissionSettingInput,
  type StaffCommissionSettingRow,
  type StaffPayoutSummaryRow,
} from '../src/lib/staffCommission';
import {
  STAFF_COMMISSION_PATH,
  STAFF_PERFORMANCE_PATH,
  isCustomerAppPath,
  isStaffCommissionPath,
  isStaffPerformancePath,
  normalizePath,
} from '../src/lib/router';

function setting(partial: Partial<StaffCommissionSettingRow> & { staff_id: string; staff_name: string }): StaffCommissionSettingRow {
  return {
    id: partial.id || 's1',
    commission_type: 'percentage',
    commission_rate: 30,
    fixed_amount: 0,
    is_enabled: true,
    effective_from: '2026-09-08',
    effective_to: null,
    notes: '',
    is_current: true,
    created_at: '2026-09-08T00:00:00Z',
    ...partial,
  };
}

function payout(partial: Partial<StaffPayoutSummaryRow> & { staff_id: string; staff_name: string }): StaffPayoutSummaryRow {
  return {
    completed_bookings: 0,
    gross_amount: 0,
    discount_amount: 0,
    net_amount: 0,
    commission_amount: 0,
    already_paid_commission: 0,
    pending_commission: 0,
    payout_status: 'pending',
    last_payout_date: null,
    open_payout_id: null,
    ...partial,
  };
}

test('commission lives at /owner/dashboard/staff-performance/commission', () => {
  assert.equal(STAFF_COMMISSION_PATH, '/owner/dashboard/staff-performance/commission');
  assert.equal(CONTRACT_PATH, STAFF_COMMISSION_PATH);
  assert.equal(isStaffCommissionPath('/owner/dashboard/staff-performance/commission'), true);
  assert.equal(isStaffCommissionPath('/owner/dashboard/staff-performance/commission/'), true);
  assert.equal(isStaffPerformancePath(STAFF_COMMISSION_PATH), false, 'commission must not open the performance page');
  assert.equal(isStaffCommissionPath(STAFF_PERFORMANCE_PATH), false);
  assert.equal(isCustomerAppPath(STAFF_COMMISSION_PATH), false);
  assert.equal(normalizePath('/owner/dashboard/staff-performance/commission/'), STAFF_COMMISSION_PATH);
});

test('the commission URL never carries a salon_id the client could spoof', () => {
  assert.equal(STAFF_COMMISSION_PATH.includes(':salon'), false);
  assert.equal(/salon_id/.test(STAFF_COMMISSION_PATH), false);
});

test('setting validation rejects past dates, negative fixed, and rate over 100', () => {
  const today = '2026-09-08';
  assert.equal(
    validateCommissionSettingInput(
      { staff_id: 'a', commission_type: 'percentage', commission_rate: 30, fixed_amount: 0, is_enabled: true, effective_from: today, notes: '' },
      today
    ).ok,
    true
  );
  assert.equal(
    validateCommissionSettingInput(
      { staff_id: 'a', commission_type: 'percentage', commission_rate: 101, fixed_amount: 0, is_enabled: true, effective_from: today, notes: '' },
      today
    ).ok,
    false
  );
  assert.equal(
    validateCommissionSettingInput(
      { staff_id: 'a', commission_type: 'fixed', commission_rate: 0, fixed_amount: -1, is_enabled: true, effective_from: today, notes: '' },
      today
    ).ok,
    false
  );
  assert.equal(
    validateCommissionSettingInput(
      { staff_id: 'a', commission_type: 'percentage', commission_rate: 10, fixed_amount: 0, is_enabled: true, effective_from: '2026-09-01', notes: '' },
      today
    ).ok,
    false
  );
  assert.equal(
    validateCommissionSettingInput(
      { staff_id: '', commission_type: 'none', commission_rate: 0, fixed_amount: 0, is_enabled: false, effective_from: today, notes: '' },
      today
    ).ok,
    false
  );
});

test('payout totals come from RPC rows and current settings hide closed versions', () => {
  const totals = aggregatePayoutTotals([
    payout({
      staff_id: 'a',
      staff_name: 'Ananya',
      completed_bookings: 3,
      gross_amount: 2400,
      discount_amount: 100,
      net_amount: 2300,
      commission_amount: 690,
      already_paid_commission: 270,
      pending_commission: 420,
    }),
    payout({
      staff_id: 'r',
      staff_name: 'Rohan',
      completed_bookings: 1,
      commission_amount: 200,
      pending_commission: 200,
    }),
  ]);
  assert.equal(totals.commission_amount, 890);
  assert.equal(totals.pending_commission, 620);
  assert.equal(totals.already_paid_commission, 270);
  const rows = [
    setting({ staff_id: 'a', staff_name: 'Ananya', is_current: true, commission_rate: 40 }),
    setting({ id: 'old', staff_id: 'a', staff_name: 'Ananya', is_current: false, commission_rate: 30, effective_to: '2026-09-07' }),
  ];
  assert.equal(currentSettingsOnly(rows).length, 1);
  assert.equal(currentSettingsOnly(rows)[0].commission_rate, 40);
});

test('CSV export uses RPC field lists and escapes commas', () => {
  const csv = csvFromPayoutSummary([
    payout({
      staff_id: 'a',
      staff_name: 'Ananya, Senior',
      completed_bookings: 3,
      gross_amount: 2400,
      discount_amount: 100,
      net_amount: 2300,
      commission_amount: 690,
      already_paid_commission: 0,
      pending_commission: 690,
      payout_status: 'pending',
    }),
  ]);
  assert.ok(csv.startsWith('Staff name,Completed bookings,Gross amount,Discount amount,Net amount,Commission amount,Already paid,Pending commission,Status,Last payout date'));
  assert.ok(csv.includes('"Ananya, Senior"'));
  assert.ok(csv.includes(',690,'));
  const hist = csvFromPayoutHistory([
    {
      payout_id: 'p1',
      staff_id: 'a',
      staff_name: 'Ananya',
      commission_amount: 690,
      period_from: '2026-09-01',
      period_to: '2026-09-08',
      status: 'paid',
      approved_by: 'owner',
      paid_at: '2026-09-08T10:00:00Z',
      reference_number: 'NEFT-1',
      notes: 'ok',
      created_at: '2026-09-08T09:00:00Z',
      completed_bookings: 3,
      gross_amount: 2400,
      net_amount: 2300,
    },
  ]);
  assert.ok(hist.includes('NEFT-1'));
  assert.ok(hist.includes('paid'));
});

test('summary normalizer never invents a paid status', () => {
  const row = normalizePayoutSummaryRow({ staff_id: 'a', staff_name: 'Ananya', commission_amount: '270.00' });
  assert.equal(row.payout_status, 'pending');
  assert.equal(row.commission_amount, 270);
  assert.equal(row.open_payout_id, null);
});

test('a signed-out visitor sees access denied, not commission numbers', () => {
  const html = renderToStaticMarkup(
    React.createElement(StaffCommissionDashboard, { user: null, onRequireAuth: () => {} })
  );
  assert.ok(html.includes('Access denied'));
  assert.ok(html.includes('session expired') || html.includes('Sign in'));
  assert.equal(html.includes('data-kpi='), false);
  assert.equal(html.includes('Ananya'), false);
});

test('a signed-in owner sees the commission shell before RPCs return', () => {
  const html = renderToStaticMarkup(
    React.createElement(StaffCommissionDashboard, {
      user: { id: 'owner-1' },
      salonName: 'Luxe Salon',
    })
  );
  assert.ok(html.includes('Staff Commission'));
  assert.ok(html.includes('Settings'));
  assert.ok(html.includes('Pending'));
  assert.ok(html.includes('Paid History'));
  assert.ok(html.includes('CSV Export'));
  assert.ok(html.includes('Owner only'));
});

test('the page talks to Phase 5 RPCs and never logs payout payloads', () => {
  const api = readFileSync('src/lib/staffCommissionApi.ts', 'utf8');
  const ui = readFileSync('src/components/StaffCommissionDashboard.tsx', 'utf8');
  for (const rpc of STAFF_COMMISSION_RPCS) {
    assert.ok(api.includes(rpc), `API client missing ${rpc}`);
  }
  assert.equal(/console\.(log|debug|info)\(.*payout/.test(api), false);
  assert.equal(/console\.(log|debug|info)\(.*commission_amount/.test(ui), false);
  assert.ok(api.includes('auth.getSession') === false);
  assert.ok(api.includes('resolveOwnerSalon'));
  assert.ok(ui.includes('get_staff_payout_summary') === false, 'UI must not call RPCs directly');
  assert.ok(ui.includes('STAFF_FILTER_DEBOUNCE_MS'));
  assert.ok(ui.includes('Escape'));
  assert.ok(ui.includes('validateCommissionSettingInput'));
});

test('App.tsx mounts the commission page on the owner route', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  assert.ok(app.includes('StaffCommissionDashboard'));
  assert.ok(app.includes('isStaffCommissionPath'));
  assert.ok(app.includes('STAFF_COMMISSION_PATH'));
  assert.ok(app.includes('staffCommission'));
});
