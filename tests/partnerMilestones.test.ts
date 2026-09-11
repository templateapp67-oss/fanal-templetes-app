import { test } from 'node:test';
import assert from 'node:assert/strict';
import { milestoneProgress, PARTNER_MILESTONES } from '../src/lib/partnerMilestones';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GrowthPartnerMilestones } from '../src/components/GrowthPartnerMilestones';

test('all seven requested shop targets are preserved', () => {
  assert.deepEqual(PARTNER_MILESTONES.map(item => item.target), [25,50,100,250,500,750,1000]);
});
test('each additional onboarded shop reduces remaining targets', () => {
  assert.equal(milestoneProgress(7, 25).remaining, 18);
  assert.equal(milestoneProgress(8, 25).remaining, 17);
  assert.equal(milestoneProgress(25, 25).reached, true);
  assert.equal(milestoneProgress(26, 25).remaining, 0);
  assert.equal(milestoneProgress(1001, 1000).percent, 100);
});
test('unavailable and invalid counts never masquerade as zero or rewards reached', () => {
  for (const value of [null, undefined, NaN, Infinity, -1]) {
    assert.equal(milestoneProgress(value,25).remaining, null);
    assert.equal(milestoneProgress(value,25).reached, false);
  }
});
test('dashboard renders every reward and next target from the count', () => {
  const html = renderToStaticMarkup(React.createElement(GrowthPartnerMilestones, {shopCount: 27}));
  for (const { reward } of PARTNER_MILESTONES) assert.ok(html.includes(reward));
  assert.ok(html.includes('23 shops remaining'));
  assert.ok(html.includes('Target complete'));
  assert.ok(html.includes('1000'));
});
