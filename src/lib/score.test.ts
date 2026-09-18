import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoreIncomingQuality, scoreLeadTime, scorePaymentTerms } from './score';
test('preserves quality threshold boundaries', () => {
  assert.deepEqual([4, 5, 9, 10, 19, 20].map(q => scoreIncomingQuality(q, 20)), [20, 15, 15, 9, 9, 3]);
});
test('scores missing lead times and payment terms without credit', () => {
  assert.equal(scoreLeadTime(undefined, 10), 0);
  assert.equal(scoreLeadTime(21, 10), 6);
  assert.equal(scorePaymentTerms('', 10), 0);
  assert.equal(scorePaymentTerms('Net 60', 10), 10);
});
