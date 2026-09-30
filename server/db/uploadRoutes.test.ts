import assert from "node:assert/strict";
import { test } from "node:test";

import { withTestApp } from "../testDb";
import { call, expectJson, send, signIn } from "./http";

test("an HTML upload is rejected before it is stored", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const response = await send(app, session, "POST", "/api/files", {
      fileName: "invoice.html",
      mimeType: "application/pdf",
      contentBase64: Buffer.from("<script>alert(1)</script>").toString("base64"),
      purpose: "Other",
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /invoice\.html cannot be uploaded/);
    const { rows } = await pool.query("SELECT count(*)::int AS count FROM files");
    assert.equal(rows[0].count, 0);
  });
});

test("an uploaded file downloads with its bytes, type and original name", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    const session = await signIn(app);
    const content = Buffer.from("%PDF-1.4 quote");
    const file = await expectJson(
      send(app, session, "POST", "/api/files", { fileName: "报价单 2026.pdf", contentBase64: content.toString("base64"), purpose: "Quote Attachment" }),
      201,
    );
    assert.equal(file.storagePath, `uploads/${file.id}.pdf`);
    assert.equal(file.size, content.length);

    const download = await call(app, `/${file.storagePath}`, { cookie: session.cookie });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/pdf");
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.equal(
      download.headers.get("content-disposition"),
      `inline; filename="___ 2026.pdf"; filename*=UTF-8''${encodeURIComponent("报价单 2026.pdf")}`,
    );
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), content);
  });
});

test("a photo with an upper-case extension opens from its link", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    const session = await signIn(app);
    const file = await expectJson(
      send(app, session, "POST", "/api/files", { fileName: "IMG_0042.JPG", contentBase64: Buffer.from("jpg").toString("base64"), purpose: "QC Photo" }),
      201,
    );
    assert.equal(file.storagePath, `uploads/${file.id}.jpg`);
    const download = await call(app, `/${file.storagePath}`, { cookie: session.cookie });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "image/jpeg");
  });
});

test("a file close to the upload limit is stored intact", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    const session = await signIn(app);
    const content = Buffer.alloc(5 * 1024 * 1024, 7);
    const file = await expectJson(
      send(app, session, "POST", "/api/files", { fileName: "drawing.pdf", contentBase64: content.toString("base64"), purpose: "Drawing" }),
      201,
    );
    const download = await call(app, `/${file.storagePath}`, { cookie: session.cookie });
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), content);
  });
});

test("a download needs a session, and an unknown or mismatched name is not found", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    const session = await signIn(app);
    const file = await expectJson(
      send(app, session, "POST", "/api/files", { fileName: "drawing.pdf", contentBase64: Buffer.from("pdf").toString("base64"), purpose: "Drawing" }),
      201,
    );
    assert.equal((await call(app, `/${file.storagePath}`)).status, 401);
    assert.equal((await call(app, "/uploads/file-9999.pdf", { cookie: session.cookie })).status, 404);
    assert.equal((await call(app, `/uploads/${file.id}.png`, { cookie: session.cookie })).status, 404);
  });
});
