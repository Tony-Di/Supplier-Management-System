import assert from 'node:assert/strict';
import { test } from 'node:test';
import { incomingDefectPendingQty, isIncomingDefectComplete, isIncomingDefectPendingReceive } from './defects';
import type { IncomingDefectRecord } from '../types';
const defect = (patch: Partial<IncomingDefectRecord>) => ({ defectAction: 'Request Replacement', defectQty: 10, ...patch } as IncomingDefectRecord);
test('only accepted replacement receipts fulfill a PO', () => {
  const record = defect({ poQty: 100, receivedQty: 80, replacementReceipts: [
    { receivedQty: 8, result: 'Accepted' }, { receivedQty: 7, result: 'Rejected' },
  ] as IncomingDefectRecord['replacementReceipts'] });
  assert.equal(incomingDefectPendingQty(record), 12);
  assert.equal(isIncomingDefectPendingReceive(record), true);
});
test('legacy records use replacement quantity or defect quantity', () => {
  assert.equal(incomingDefectPendingQty(defect({ replacementQty: 15 })), 15);
  assert.equal(incomingDefectPendingQty(defect({})), 10);
});
test('overdelivery never creates negative pending quantity; credits complete immediately', () => {
  assert.equal(incomingDefectPendingQty(defect({ poQty: 100, receivedQty: 105 })), 0);
  assert.equal(isIncomingDefectComplete(defect({ defectAction: 'Request Credit' })), true);
});
