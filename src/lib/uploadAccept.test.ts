import assert from "node:assert/strict";
import { test } from "node:test";
import { uploadAccept } from "../constants";
import { acceptedUploadExtensions } from "../../server/uploads";

test("file pickers offer exactly the types the server accepts", () => {
  assert.deepEqual(uploadAccept.split(","), acceptedUploadExtensions);
});
