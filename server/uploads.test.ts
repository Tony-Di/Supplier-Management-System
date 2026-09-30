import assert from "node:assert/strict";
import { test } from "node:test";
import type { Response } from "express";

import { UploadRejectedError, setUploadHeaders, uploadFileType, downloadHeaders, fileIdFromStoredName, storagePath } from "./uploads";

function fakeResponse() {
  const headers: Record<string, string> = {};
  const response = {
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
  };
  return { response: response as unknown as Response, headers };
}

test("an accepted file keeps a lowercase extension and a type chosen by the server", () => {
  assert.deepEqual(uploadFileType("Crate drawing.PDF"), { extension: ".pdf", mimeType: "application/pdf" });
  assert.deepEqual(uploadFileType("IMG_0042.JPG"), { extension: ".jpg", mimeType: "image/jpeg" });
  assert.deepEqual(uploadFileType("quote.xlsx"), {
    extension: ".xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
});

test("files a browser would run as a page are rejected", () => {
  for (const fileName of ["invoice.html", "invoice.htm", "logo.svg", "feed.xml", "script.js"]) {
    assert.throws(() => uploadFileType(fileName), UploadRejectedError, fileName);
  }
});

test("a file without an extension is rejected", () => {
  assert.throws(() => uploadFileType("W9"), UploadRejectedError);
});

test("a rejected upload names the file and reports a 400", () => {
  assert.throws(
    () => uploadFileType("setup.exe"),
    (error: UploadRejectedError) => error.status === 400 && error.message.includes("setup.exe"),
  );
});

test("every stored file is served without content sniffing", () => {
  const { response, headers } = fakeResponse();
  setUploadHeaders(response, "/srv/uploads/file-1.pdf");
  assert.equal(headers["x-content-type-options"], "nosniff");
});

test("PDFs and photos open in the browser", () => {
  for (const path of ["/srv/uploads/file-1.pdf", "/srv/uploads/file-2.JPG", "/srv/uploads/file-3.png"]) {
    const { response, headers } = fakeResponse();
    setUploadHeaders(response, path);
    assert.equal(headers["content-disposition"], undefined, path);
  }
});

test("anything else is sent as a download, including files stored before the allowlist", () => {
  for (const path of ["/srv/uploads/file-4.xlsx", "/srv/uploads/file-5.html", "/srv/uploads/file-6"]) {
    const { response, headers } = fakeResponse();
    setUploadHeaders(response, path);
    assert.equal(headers["content-disposition"], "attachment", path);
  }
});

test("a stored file's path keeps its ID and a lower-case extension", () => {
  assert.equal(storagePath("file-1004", "Crate drawing.PDF"), "uploads/file-1004.pdf");
  assert.equal(storagePath("file-1002", "IMG_0042.JPG"), "uploads/file-1002.jpg");
});

test("a download path names a file ID", () => {
  assert.equal(fileIdFromStoredName("file-1004.pdf"), "file-1004");
  assert.equal(fileIdFromStoredName("file-1004"), undefined);
  assert.equal(fileIdFromStoredName("../data/store.json"), undefined);
  assert.equal(fileIdFromStoredName("sup-1001.pdf"), undefined);
});

test("PDFs and photos download inline, everything else as an attachment", () => {
  assert.match(downloadHeaders({ fileName: "drawing.pdf", mimeType: "application/pdf" })["Content-Disposition"], /^inline; /);
  assert.match(downloadHeaders({ fileName: "IMG_0042.JPG", mimeType: "image/jpeg" })["Content-Disposition"], /^inline; /);
  assert.match(downloadHeaders({ fileName: "quote.xlsx", mimeType: "application/vnd.ms-excel" })["Content-Disposition"], /^attachment; /);
  assert.match(downloadHeaders({ fileName: "prices.csv", mimeType: "text/csv" })["Content-Disposition"], /^attachment; /);
});

test("a download is saved under its original name", () => {
  assert.equal(
    downloadHeaders({ fileName: "W9 2026.pdf", mimeType: "application/pdf" })["Content-Disposition"],
    `inline; filename="W9 2026.pdf"; filename*=UTF-8''W9%202026.pdf`,
  );
});

test("a non-ASCII or quoted name survives in the UTF-8 parameter", () => {
  const chinese = downloadHeaders({ fileName: "报价单.pdf", mimeType: "application/pdf" })["Content-Disposition"];
  assert.equal(chinese, `inline; filename="___.pdf"; filename*=UTF-8''${encodeURIComponent("报价单")}.pdf`);
  const quoted = downloadHeaders({ fileName: `O'Neil "final".pdf`, mimeType: "application/pdf" })["Content-Disposition"];
  assert.equal(quoted, `inline; filename="O'Neil _final_.pdf"; filename*=UTF-8''O%27Neil%20%22final%22.pdf`);
});

test("a download is typed by the server, never sniffed, and cached privately", () => {
  const headers = downloadHeaders({ fileName: "drawing.pdf", mimeType: "application/pdf" });
  assert.equal(headers["Content-Type"], "application/pdf");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Cache-Control"], "private, max-age=31536000, immutable");
});
