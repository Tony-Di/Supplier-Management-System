import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseItemImportRows, findDuplicateItemCodes, nextPackagingSetRevision } from './import';
import type { PackagingItem, DrawingSet } from '../types';
test('imports TSV headers, CRLF and multi-model items', () => {
  assert.deepEqual(parseItemImportRows('Item Code\tDescription\tType\tUsed For\r\n P-1\tPallet\tPallet\tBTA; BTC\r\n'), [
    { itemCode: 'P-1', description: 'Pallet', type: 'Pallet', usedFor: ['BTA', 'BTC'] },
  ]);
});
test('imports CSV and excludes incomplete rows', () => {
  assert.equal(parseItemImportRows('P-1,Pallet,Pallet,BTA\nP-2,,Pallet,BTA\nP-3,Box,Pallet,').length, 1);
  assert.equal(parseItemImportRows('').length, 0);
});
test('recognizes duplicate item codes regardless of case or outer whitespace', () => {
  assert.deepEqual([...findDuplicateItemCodes([{ itemCode: ' p-1 ' }, { itemCode: 'P-1' }, { itemCode: 'p-2' }] as PackagingItem[])], ['p-1']);
});
test('revisions count non-void sets for the model', () => {
  assert.equal(nextPackagingSetRevision([{ modelId: 'm1' }, { modelId: 'm1', recordState: 'Void' }, { modelId: 'm2' }] as DrawingSet[], 'm1'), '2.0');
});
