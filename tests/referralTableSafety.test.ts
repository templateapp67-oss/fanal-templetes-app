import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReferralTable } from '../src/components/ReferralTable';
import { normalizePartnerReferralList } from '../src/lib/growthPartner';

test('ReferralTable renders safely when referral rows are missing', () => {
  assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(ReferralTable, { rows: undefined })));
  assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(ReferralTable, { rows: null, showStarted: false })));
});

test('referral RPC payloads are normalized before reaching React', () => {
  assert.deepEqual(normalizePartnerReferralList(undefined), { rows: [], total: 0, limit: 20, offset: 0 });
  assert.deepEqual(normalizePartnerReferralList({ total: 3, rows: null, limit: 0, offset: -1 }), {
    rows: [], total: 3, limit: 20, offset: 0,
  });
});
