import assert from "node:assert/strict";
import { test } from "node:test";
import { attachSupplierUploads } from "./uploads";
import type { UploadedFileRecord } from "../types";

function recordingUpload() {
  const uploaded: string[] = [];
  const upload = async (file: File, purpose: UploadedFileRecord["purpose"]) => {
    uploaded.push(file.name);
    return { id: `${purpose}: ${file.name}` };
  };
  return { upload, uploaded };
}

function formWith(files: Record<string, string[]>) {
  const form = new FormData();
  for (const [name, fileNames] of Object.entries(files)) {
    for (const fileName of fileNames) form.append(name, new File([fileName], fileName));
  }
  return form;
}

test("a new W-9 file is linked and marks the W-9 uploaded", async () => {
  const patch: Record<string, unknown> = { hasW9: false, w9FileId: null, otherFileIds: [] };
  await attachSupplierUploads(formWith({ w9File: ["W9 2026.pdf"] }), patch, recordingUpload().upload);
  assert.equal(patch.hasW9, true);
  assert.equal(patch.w9FileId, "Supplier W9: W9 2026.pdf");
});

test("a new bank/payment info file is linked and marks it uploaded", async () => {
  const patch: Record<string, unknown> = { hasPaymentInfo: false, otherFileIds: [] };
  await attachSupplierUploads(formWith({ paymentInfoFile: ["Bank letter.pdf"] }), patch, recordingUpload().upload);
  assert.equal(patch.hasPaymentInfo, true);
  assert.equal(patch.paymentInfoFileId, "Supplier Payment Info: Bank letter.pdf");
});

test("new other documents are added after the ones kept", async () => {
  const patch: Record<string, unknown> = { otherFileIds: ["file-3"] };
  await attachSupplierUploads(formWith({ otherFiles: ["ISO 9001.pdf"] }), patch, recordingUpload().upload);
  assert.deepEqual(patch.otherFileIds, ["file-3", "Other: ISO 9001.pdf"]);
});

test("more other documents than there is room for are refused before anything uploads", async () => {
  const { upload, uploaded } = recordingUpload();
  const patch: Record<string, unknown> = { otherFileIds: ["file-3"] };
  await assert.rejects(
    attachSupplierUploads(formWith({ w9File: ["W9.pdf"], otherFiles: ["a.pdf", "b.pdf"] }), patch, upload),
    /at most 2 other documents/,
  );
  assert.deepEqual(uploaded, []);
  assert.deepEqual(patch.otherFileIds, ["file-3"]);
});

test("an empty file picker uploads nothing and changes nothing", async () => {
  const { upload, uploaded } = recordingUpload();
  const form = new FormData();
  form.append("w9File", new File([], ""));
  form.append("otherFiles", new File([], ""));
  const patch: Record<string, unknown> = { hasW9: true, w9FileId: "file-1", otherFileIds: ["file-3", "file-4"] };
  await attachSupplierUploads(form, patch, upload);
  assert.deepEqual(uploaded, []);
  assert.deepEqual(patch, { hasW9: true, w9FileId: "file-1", otherFileIds: ["file-3", "file-4"] });
});
