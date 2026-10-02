import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMoney, csvCell, formatAuditValue, formatFileSize, formatSupplierSince, localDateString } from './format';
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
test('counts the days a supplier has been with us', () => {
  assert.equal(formatSupplierSince('2025-12-06', new Date(2026, 9, 2)), '300 days (Dec 6, 2025)');
  assert.equal(formatSupplierSince('2026-10-01', new Date(2026, 9, 2)), '1 day (Oct 1, 2026)');
  assert.equal(formatSupplierSince('2026-10-02', new Date(2026, 9, 2)), '0 days (Oct 2, 2026)');
  assert.equal(formatSupplierSince(undefined, new Date(2026, 9, 2)), '');
});
test('counts supplier days by the local calendar, not by hours elapsed', () => {
  assert.equal(formatSupplierSince('2025-12-06', new Date(2026, 9, 2, 23, 30)), '300 days (Dec 6, 2025)');
  assert.equal(formatSupplierSince('2026-03-01', new Date(2026, 2, 9, 0, 30)), '8 days (Mar 1, 2026)');
});
test('gives today as the local calendar day even late in the evening', () => {
  assert.equal(localDateString(new Date(2026, 9, 2, 23, 30)), '2026-10-02');
  assert.equal(localDateString(new Date(2026, 0, 5, 0, 0)), '2026-01-05');
});
