import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMoney, csvCell, formatAuditValue, formatFileSize } from './format';
test('preserves fractional packaging prices and CSV quoting', () => {
  assert.equal(formatMoney(1234.567), '$1,234.567');
  assert.equal(csvCell('Supplier, "A"'), '"Supplier, ""A"""');
  assert.equal(csvCell(undefined), '');
});
test('formats audit fields and upload sizes', () => {
  assert.equal(formatAuditValue(['Pass', 'Conditional']), 'Pass, Conditional');
  assert.equal(formatAuditValue(null), '-');
  assert.equal(formatFileSize(1536), '1.5 KB');
});
