import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseItemImportRows, findDuplicateItemCodes, nextPackagingSetRevision, packagingSetNameFromFileName } from './import';
import type { PackagingItem, DrawingSet } from '../types';
const models = [{ id: 'm1', name: 'BTA' }, { id: 'm2', name: 'BTC 620' }];
test('imports TSV headers, CRLF and multi-model items', () => {
  assert.deepEqual(parseItemImportRows('Item Code\tDescription\tType\tUsed For\r\n P-1\tPallet\tPallet\tBTA; BTC 620\r\n', models), [
    { itemCode: 'P-1', description: 'Pallet', type: 'Pallet', usedFor: ['BTA', 'BTC 620'], errors: [] },
  ]);
});
test('reports rows with missing columns instead of dropping them', () => {
  assert.deepEqual(parseItemImportRows('P-1,Pallet,Pallet,BTA\nP-2,,Pallet,BTA\nP-3,Box,,', models).map((row) => row.errors), [
    [],
    ['Missing Description'],
    ['Missing Type, Used for'],
  ]);
  assert.deepEqual(parseItemImportRows('P-4\tBox\tPallet\t;', models)[0].errors, ['Missing Used for']);
  assert.equal(parseItemImportRows('', models).length, 0);
});
test('corrects Type case and spacing to the standard type name', () => {
  const [row] = parseItemImportRows('27.006.001.028\tPacking materials,Short Paper protector\tShort  Paper protector\tBTC 620', models);
  assert.equal(row.type, 'Short Paper Protector');
  assert.deepEqual(row.errors, []);
});
test('reports a Type that is not one of the packaging types', () => {
  const [row] = parseItemImportRows('P-1\tBox\tShort Paper Protecter\tBTA', models);
  assert.deepEqual(row.errors, ['Type "Short Paper Protecter" is not a valid type']);
});
test('matches Used for to model names regardless of case and spacing', () => {
  const [row] = parseItemImportRows('P-1\tBox\tPallet\tbta, btc  620', models);
  assert.deepEqual(row.usedFor, ['BTA', 'BTC 620']);
  assert.deepEqual(row.errors, []);
});
test('reports a Used for model that does not exist', () => {
  const [row] = parseItemImportRows('P-1\tBox\tPallet\tBTA; BTC 621', models);
  assert.deepEqual(row.errors, ['Model "BTC 621" not found']);
});
test('recognizes duplicate item codes regardless of case or outer whitespace', () => {
  assert.deepEqual([...findDuplicateItemCodes([{ itemCode: ' p-1 ' }, { itemCode: 'P-1' }, { itemCode: 'p-2' }] as PackagingItem[])], ['p-1']);
});
test('revisions count non-void sets for the model', () => {
  assert.equal(nextPackagingSetRevision([{ modelId: 'm1' }, { modelId: 'm1', recordState: 'Void' }, { modelId: 'm2' }] as DrawingSet[], 'm1'), '2.0');
});
test('names a packaging set after its file without the extension', () => {
  assert.equal(packagingSetNameFromFileName('SEG-BTC-BG-G12R-P-7 A0.pdf'), 'SEG-BTC-BG-G12R-P-7 A0');
  assert.equal(packagingSetNameFromFileName('SEG-620.BTC.rev2.pdf'), 'SEG-620.BTC.rev2');
  assert.equal(packagingSetNameFromFileName('SEG-620-BTC'), 'SEG-620-BTC');
});
