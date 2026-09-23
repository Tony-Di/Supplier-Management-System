import assert from "node:assert/strict";
import { test } from "node:test";
import type { Response } from "express";

import { UploadRejectedError, setUploadHeaders, uploadFileType } from "./uploads";

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
