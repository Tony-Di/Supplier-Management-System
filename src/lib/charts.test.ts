import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dashboardPriceDomain, priceAnalyticsDomain } from './charts';
import type { Quote } from '../types';
test('keeps empty and sub-dollar chart scales', () => {
  assert.deepEqual(priceAnalyticsDomain([]), ['auto', 'auto']);
  assert.deepEqual(priceAnalyticsDomain([{ unitPrice: 0.35 }] as Quote[]), [0, 1]);
});
test('both price charts use a padded scale including all prices', () => {
  const quotes = [35.5, 38].map(unitPrice => ({ unitPrice })) as Quote[];
  const domain = priceAnalyticsDomain(quotes) as [number, number];
  assert.ok(domain[0] <= 35.5 && domain[1] >= 38);
  assert.deepEqual(dashboardPriceDomain(quotes), domain);
});
