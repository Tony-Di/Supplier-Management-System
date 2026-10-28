import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectImportKind, parseItemImportRows, parseModelImportRows, findDuplicateItemCodes, nextPackagingSetRevision, packagingSetNameFromFileName } from './import';
import type { PackagingItem, DrawingSet } from '../types';
const models = [{ id: 'm1', name: 'BTA' }, { id: 'm2', name: 'BTC 620' }];
test('imports TSV headers, CRLF and multi-model items', () => {
  assert.deepEqual(parseItemImportRows('Item Code\tDescription\tType\tUsed For\r\n P-1\tPallet\tPallet\tBTA; BTC 620\r\n', models), [
    { itemCode: 'P-1', description: 'Pallet', type: 'Pallet', usedFor: ['BTA', 'BTC 620'], note: '', errors: [] },
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
test('keeps commas inside a quoted CSV cell in that cell', () => {
  assert.deepEqual(parseItemImportRows('P-1,"Pallet, heat treated",Pallet,"BTA, BTC 620"', models), [
    { itemCode: 'P-1', description: 'Pallet, heat treated', type: 'Pallet', usedFor: ['BTA', 'BTC 620'], note: '', errors: [] },
  ]);
});
test('reads a doubled quote in a quoted CSV cell as one quote', () => {
  const [row] = parseItemImportRows('P-1,"48"" pallet",Pallet,BTA', models);
  assert.equal(row.description, '48" pallet');
  assert.deepEqual(row.errors, []);
});
test('keeps a line break inside a quoted CSV cell in one row', () => {
  const rows = parseItemImportRows('P-1,"Pallet\r\nheat treated",Pallet,BTA\r\nP-2,Box,Pallet,BTA', models);
  assert.deepEqual(rows.map((row) => [row.itemCode, row.description, row.errors]), [
    ['P-1', 'Pallet\nheat treated', []],
    ['P-2', 'Box', []],
  ]);
});
test('keeps a line break inside a quoted cell pasted from Excel in one row', () => {
  const rows = parseItemImportRows('P-1\t"Pallet\nheat treated"\tPallet\tBTA', models);
  assert.deepEqual(rows.map((row) => [row.itemCode, row.description, row.errors]), [['P-1', 'Pallet\nheat treated', []]]);
});
test('reads a quote inside an unquoted CSV cell as text', () => {
  const [row] = parseItemImportRows('P-1,48" pallet,Pallet,BTA', models);
  assert.equal(row.description, '48" pallet');
  assert.deepEqual(row.errors, []);
});
test('adds the new models of an existing Item Code to that item', () => {
  const items = [{ itemCode: 'P-1', usedForModels: ['m1'] }];
  const rows = parseItemImportRows('p-1\tPallet\tPallet\tBTA; BTC 620\nP-1\tPallet\tPallet\tBTA', models, items);
  assert.deepEqual(rows.map((row) => row.note), ['Adds BTC 620 to the existing item', 'Already exists, skipped']);
});
test('combines the models of an Item Code repeated in the paste', () => {
  const rows = parseItemImportRows('P-1\tPallet\tPallet\tBTA\nP-1\tPallet\tPallet\tBTC 620\nP-1\tPallet\tPallet\tBTA', models);
  assert.deepEqual(rows.map((row) => row.note), ['', 'Adds BTC 620 to the same item above', 'Repeated row, skipped']);
});
test('detects models or items from the header row', () => {
  assert.equal(detectImportKind('Model\tProduct Family\nBTA 610\tSolar Module', models), 'Models');
  assert.equal(detectImportKind('module name,notes\nBTA 610,', models), 'Models');
  assert.equal(detectImportKind('Item Code\tDescription\tType\tUsed for\nP-1\tBox\tPalet\tBTX', models), 'Items');
});
test('detects items without a header from their Type or Used for column', () => {
  assert.equal(detectImportKind('P-1\tPallet\tPallet\tBTX', models), 'Items');
  assert.equal(detectImportKind('P-1\tBox\tCrate\tBTA', models), 'Items');
  assert.equal(detectImportKind('BTA 610\tSolar Module\tActive\tNew line\nBTC 630', models), 'Models');
  assert.equal(detectImportKind('', models), 'Items');
});
test('reads model rows with defaults and flags existing names', () => {
  assert.deepEqual(parseModelImportRows('Model\tProduct Family\tStatus\tNotes\nbta\nBTA 610\t\tinactive\tPilot\nBTA  610\nBTC 630\tSolar Module\tRetired', models), [
    { name: 'bta', productFamily: 'Solar Module', status: 'Active', notes: '', note: 'Already exists, skipped', errors: [] },
    { name: 'BTA 610', productFamily: 'Solar Module', status: 'Inactive', notes: 'Pilot', note: '', errors: [] },
    { name: 'BTA  610', productFamily: 'Solar Module', status: 'Active', notes: '', note: 'Repeated row, skipped', errors: [] },
    { name: 'BTC 630', productFamily: 'Solar Module', status: 'Retired', notes: '', note: '', errors: ['Status "Retired" must be Active or Inactive'] },
  ]);
  assert.deepEqual(parseModelImportRows(',Solar Module', models)[0].errors, ['Missing Model']);
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
