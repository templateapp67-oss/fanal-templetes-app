import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SalonService } from '../src/types';
import { toServiceDbRow } from '../src/lib/salonSync';
import { toCustomerService } from '../src/lib/customer/mappers';

test('SalonService interface supports showDuration boolean flag', () => {
  const serviceWithDuration: SalonService = {
    id: 'srv-1',
    name: 'Hydra Facial',
    category: 'Skincare',
    durationMinutes: 45,
    price: 1500,
    description: 'Deep hydration facial treatment',
    icon: 'Sparkles',
    showDuration: true,
  };

  const serviceWithoutDuration: SalonService = {
    id: 'srv-2',
    name: 'Signature Haircut',
    category: 'Hair',
    durationMinutes: 60,
    price: 800,
    description: 'Customized haircut and styling',
    icon: 'Scissors',
    showDuration: false,
  };

  assert.equal(serviceWithDuration.showDuration, true);
  assert.equal(serviceWithoutDuration.showDuration, false);
});

test('toServiceDbRow accurately maps showDuration to show_duration column', () => {
  const srvVisible: SalonService = {
    id: 'srv-1',
    name: 'Visible Service',
    category: 'Hair',
    durationMinutes: 30,
    price: 500,
    description: 'Test',
    icon: 'Scissors',
    showDuration: true,
  };

  const srvHidden: SalonService = {
    id: 'srv-2',
    name: 'Hidden Duration Service',
    category: 'Hair',
    durationMinutes: 30,
    price: 500,
    description: 'Test',
    icon: 'Scissors',
    showDuration: false,
  };

  const dbRowVisible = toServiceDbRow(srvVisible, 'owner-123', 0);
  const dbRowHidden = toServiceDbRow(srvHidden, 'owner-123', 1);

  assert.equal(dbRowVisible.show_duration, true);
  assert.equal(dbRowHidden.show_duration, false);
});

test('toCustomerService correctly maps show_duration column to showDuration in CustomerService', () => {
  const rowVisible = {
    id: '11111111-1111-1111-1111-111111111111',
    owner_id: '22222222-2222-2222-2222-222222222222',
    name: 'Blowdry & Style',
    category: 'Hair',
    description: 'Classic blowdry styling',
    icon: 'Sparkles',
    price: 900,
    duration_minutes: 40,
    popular: true,
    show_duration: true,
    sort_order: 1,
  };

  const rowHidden = {
    id: '33333333-3333-3333-3333-333333333333',
    owner_id: '22222222-2222-2222-2222-222222222222',
    name: 'Custom Hair Coloring',
    category: 'Hair',
    description: 'Full head coloration',
    icon: 'Palette',
    price: 3500,
    duration_minutes: 120,
    popular: false,
    show_duration: false,
    sort_order: 2,
  };

  const mappedVisible = toCustomerService(rowVisible);
  const mappedHidden = toCustomerService(rowHidden);

  assert.equal(mappedVisible.showDuration, true);
  assert.equal(mappedHidden.showDuration, false);
});
