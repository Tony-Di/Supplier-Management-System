import assert from "node:assert/strict";
import { test } from "node:test";
import { attachInspectionUploads } from "./uploads";
import type { UploadedFileRecord } from "../types";

const upload = async (file: File, purpose: UploadedFileRecord["purpose"]) => ({ id: `${purpose}: ${file.name}` });

function formWith(fileNames: string[]) {
  const form = new FormData();
  for (const fileName of fileNames) form.append("photoFiles", new File([fileName], fileName));
  return form;
}

test("files added when completing an inspection join the ones it already has", async () => {
  const patch: Record<string, unknown> = {};
  await attachInspectionUploads(formWith(["Round 2 photo.jpg", "Test report.pdf"]), patch, ["file-1"], upload);
  assert.deepEqual(patch, { photoFileIds: ["file-1", "QC Photo: Round 2 photo.jpg", "QC Photo: Test report.pdf"], problemPhotos: 3 });
});

test("no file chosen leaves the inspection's files alone", async () => {
  const patch: Record<string, unknown> = {};
  const form = new FormData();
  form.append("photoFiles", new File([], ""));
  await attachInspectionUploads(form, patch, ["file-1"], upload);
  assert.deepEqual(patch, {});
});
