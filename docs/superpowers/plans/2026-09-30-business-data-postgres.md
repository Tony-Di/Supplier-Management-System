# Business Data in Postgres Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every business record, the score weights and uploaded files from `data/store.json` and `uploads/` into Postgres, with each write request committed atomically, and make emptied edit-form fields clear the stored value.

**Architecture:** Each record type gets a typed table (migration `003`). A request loads all business rows into today's in-memory `Store` shape; a write runs the existing handlers and rules against it inside one transaction under an advisory lock, then stores only the changed rows, the ID counters and the audit entries before committing. Reads use a read-only snapshot and never write.

**Tech Stack:** Node.js 20.19+, TypeScript run with `tsx`, Express 4, `pg` 8, Zod 3, `node:test`, Postgres 17 (Docker).

**Spec:** `docs/superpowers/specs/2026-09-30-business-data-postgres-design.md`

## Global Constraints

- The HTTP API is unchanged, except that `null` in a `PATCH` body clears a field. The frontend changes only in `src/modals/record/editHelpers.ts`.
- IDs keep the `prefix-number` format (`sup-1001`). A prefix missing from `id_counters` starts at 1000.
- Writes take `SELECT pg_advisory_xact_lock(hashtext('business-data'))` as their first statement.
- Foreign keys are `DEFERRABLE INITIALLY DEFERRED`. `quotes.drawing_item_id` and `inspections.drawing_item_id` have none.
- Dates are `date` columns read back as `YYYY-MM-DD` strings; `numeric` columns are read back as JavaScript numbers.
- The store load never reads `files.content`.
- `npm test` stays offline: database tests live only in `server/db/*.test.ts` and run with `npm run test:db`.
- A database test file never imports `../app`, `../db`, `../session` or `../unitOfWork` statically; it reaches them only through `withTestApp` (these modules bind the pool to `DATABASE_URL` at import).
- No new npm dependencies.
- Match the surrounding code: two-space indent, double quotes, semicolons, a short comment only where the reason is not obvious.
- Commit messages: an imperative summary line, a short body saying why, and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Editing a packaging set so it drops an item that a saved quote still points at must still save; `drawing_item_id` has no foreign key for this reason. Test in Task 8.
2. Deleting an unused packaging set must delete its drawing items and nothing else. Test in Task 8.
3. A photo uploaded as `IMG_0042.JPG` must open from its link, whose extension is lower-cased. Test in Task 8.
4. A file close to the upload limit (5 MB) must be stored and downloaded byte for byte. Test in Task 8.
5. A `PATCH` that sends `null` for a required field (a supplier's name) must be rejected with 400, not stored. Test in Task 1.

## Prerequisites

Run once before starting; the database tests need both databases.

```bash
docker compose -f compose.dev.yml up -d
docker compose -f compose.dev.yml exec -T postgres psql -U sourcing -c "CREATE DATABASE sourcing_test" || true
```

`.env` must set `DATABASE_URL`, `DATABASE_URL_TEST`, `SESSION_SECRET` (32+ characters) and `AUTH_MODE=dev` (see `.env.example`). The npm scripts load it with `--env-file-if-exists=.env`.

Until Task 2 lands, do not run `npm run test:db`: the existing app-level database tests write to the real `data/store.json`.

## File Structure

New server modules, each with one job:

| File | Responsibility |
| --- | --- |
| `migrations/003_business_data.sql` | The 16 business tables |
| `server/pgTypes.ts` | `pg` parsers: `date` as text, `numeric` as number |
| `server/patch.ts` | `mergePatch`: an edit laid over a stored record, `null` removes a field |
| `server/storeShape.ts` | The `Store` type, `emptyStore()`, `defaultScoreWeights()` |
| `server/storeTables.ts` | Table definitions and record ↔ row mapping (pure) |
| `server/storeDiff.ts` | Rows to insert, update and delete between two stores (pure) |
| `server/storeRepository.ts` | Load the store, apply changes, counters, score weights, file content (Postgres) |
| `server/errors.ts` | `ValidationError` |
| `server/lookups.ts` | `findSupplier(store, id)` and the other record lookups |
| `server/auditEntry.ts` | Builds an audit entry and its compact before/after diff |
| `server/context.ts` | The per-request context: store, `nextId`, audit collection, file contents |
| `server/workflow.ts` | Route helpers and the sync passes, moved out of `createApp` |
| `server/unitOfWork.ts` | The `read` and `write` Express wrappers |
| `server/testFixtures.ts` | `sampleStore()`: one of every record, every optional field set once |
| `server/db/http.ts` | HTTP helpers for database tests: `call`, `signIn`, `send`, `expectJson` |
| `server/db/seed.ts` | `seedSourcingCase` and `snapshotTables` for database tests |
| `scripts/measure-write-time.ts` | Times quote edits against a large synthetic data set |

Removed by the end: `server/store.ts`, `server/storeFile.ts`, `server/storeFile.test.ts`, `scripts/import-audit-logs.ts`.

---

### Task 1: Clear fields that an edit empties

**Files:**
- Create: `server/patch.ts`, `server/patch.test.ts`
- Modify: `server/app.ts` (`updateById`, `PATCH /api/quotes`, `PATCH /api/drawing-sets`)
- Modify: `src/modals/record/editHelpers.ts`
- Test: `src/lib/editPatch.test.ts`

**Interfaces:**
- Produces: `mergePatch(record: object, patch: unknown): Record<string, unknown>` in `server/patch.ts`. Task 8 moves `updateById` into `server/workflow.ts` and keeps calling it.

- [ ] **Step 1: Write the failing server tests**

Create `server/patch.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { mergePatch } from "./patch";
import { incomingDefectSchema, supplierSchema } from "./schemas";

test("a null in the patch removes the field", () => {
  assert.deepEqual(mergePatch({ id: "q-1001", effectiveTo: "2026-06-30", notes: "" }, { effectiveTo: null }), {
    id: "q-1001",
    notes: "",
  });
});

test("other patch values replace the stored ones and absent keys are kept", () => {
  assert.deepEqual(mergePatch({ id: "sup-1001", name: "Old", phone: "1" }, { name: "New" }), {
    id: "sup-1001",
    name: "New",
    phone: "1",
  });
});

test("arrays are replaced whole", () => {
  assert.deepEqual(mergePatch({ itemIds: ["item-1001", "item-1002"] }, { itemIds: ["item-1003"] }), { itemIds: ["item-1003"] });
});

test("a missing or non-object patch leaves the record as it was", () => {
  const record = { id: "model-1001", name: "BTA" };
  assert.deepEqual(mergePatch(record, undefined), record);
  assert.deepEqual(mergePatch(record, ["name"]), record);
});

test("the stored record is not changed", () => {
  const record = { id: "q-1001", effectiveTo: "2026-06-30" };
  mergePatch(record, { effectiveTo: null });
  assert.equal(record.effectiveTo, "2026-06-30");
});

test("a defect switched to Request Credit passes validation once its replacement quantity is cleared", () => {
  const stored = {
    id: "def-1001",
    supplierId: "sup-1001",
    itemId: "item-1001",
    defectDate: "2026-09-01",
    defectQty: 5,
    defectAction: "Request Replacement",
    replacementQty: 5,
    notes: "",
  };
  assert.equal(incomingDefectSchema.safeParse(mergePatch(stored, { defectAction: "Request Credit", replacementQty: null })).success, true);
  // Without the null the old quantity stays and the schema rejects the edit.
  assert.equal(incomingDefectSchema.safeParse(mergePatch(stored, { defectAction: "Request Credit" })).success, false);
});

test("null for a required field is rejected, not stored", () => {
  const stored = { id: "sup-1001", name: "Legacy Paper", recordState: "Active" };
  assert.equal(supplierSchema.safeParse(mergePatch(stored, { name: null })).success, false);
});
```

- [ ] **Step 2: Run the server tests to verify they fail**

Run: `npx tsx --test server/patch.test.ts`
Expected: FAIL — `Cannot find module './patch'`.

- [ ] **Step 3: Implement `mergePatch`**

Create `server/patch.ts`:

```ts
/**
 * The record an edit produces: the stored record with the patch's keys laid
 * over it. A key whose patch value is null is removed, which is how an edit
 * clears an optional field — JSON has no way to send undefined. Arrays and
 * objects in the patch replace the stored value whole.
 */
export function mergePatch(record: object, patch: unknown): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...record };
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return merged;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}
```

- [ ] **Step 4: Run the server tests to verify they pass**

Run: `npx tsx --test server/patch.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Use `mergePatch` in the three places `server/app.ts` merges an edit**

Add `import { mergePatch } from "./patch";` after the `./priceWindows` import.

Replace `updateById` (near the end of `createApp`) with:

```ts
  function updateById<T extends { id: string }>(
    records: T[],
    id: string,
    patch: unknown,
    parse: (value: unknown) => Omit<T, "id">,
  ) {
    const index = records.findIndex((record) => record.id === id);
    if (index === -1) throw new ValidationError(`Record not found: ${id}`);
    const nextRecord = { ...mergePatch(records[index], patch), id };
    records[index] = { id, ...parse(nextRecord) } as T;
    saveStore();
    return records[index];
  }
```

In `PATCH /api/quotes`, replace the price window line with:

```ts
      if (before) checkPriceWindow({ ...quoteSchema.parse(mergePatch(before, patch)), id: before.id }, before, reason);
```

In `PATCH /api/drawing-sets`, replace the first two lines of the `drawingSetSchema.parse({` argument (`...current,` and `...request.body,`) with the single line:

```ts
        ...mergePatch(current, request.body),
```

- [ ] **Step 6: Write the failing frontend tests**

Replace `src/lib/editPatch.test.ts` with:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEditPatch } from "../modals/record/editHelpers";
import type { IncomingDefectRecord, Quote, Supplier } from "../types";

const quote = { id: "q1", recordState: "Active", effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" } as Quote;

function editForm(fields: Record<string, string>) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

test("a quote edit sends the reason for a changed Effective To", () => {
  const patch = buildEditPatch({ endpoint: "quotes", record: quote }, editForm({ effectiveTo: "2026-05-31", changeReason: "Supplier notice" }));
  assert.equal(patch.effectiveTo, "2026-05-31");
  assert.equal(patch.changeReason, "Supplier notice");
});

test("a quote edit without a reason sends none", () => {
  const patch = buildEditPatch({ endpoint: "quotes", record: quote }, editForm({ effectiveTo: "2026-06-30", changeReason: "" }));
  assert.equal("changeReason" in patch, false);
});

test("an emptied optional field is sent as null so the server clears it", () => {
  const patch = buildEditPatch({ endpoint: "quotes", record: quote }, editForm({ effectiveTo: "", changeReason: "Open-ended again" }));
  assert.equal(patch.effectiveTo, null);
  assert.equal(JSON.parse(JSON.stringify(patch)).effectiveTo, null);
});

test("a field that is not in the form is not sent", () => {
  const patch = buildEditPatch({ endpoint: "quotes", record: quote }, editForm({ notes: "Checked" }));
  assert.equal("effectiveTo" in patch, false);
  assert.equal("voidReason" in patch, false);
});

test("editing a quote's effective date clears Valid Until", () => {
  const patch = buildEditPatch({ endpoint: "quotes", record: quote }, editForm({ effectiveFrom: "2026-02-01" }));
  assert.equal(patch.validUntil, null);
});

test("an emptied ERP vendor ID is sent as null", () => {
  const supplier = { id: "sup-1", recordState: "Active", capableItems: [] } as unknown as Supplier;
  const patch = buildEditPatch({ endpoint: "suppliers", record: supplier }, editForm({ erpVendorId: "", capableItemsJson: "[]" }));
  assert.equal(patch.erpVendorId, null);
});

test("switching a defect to Request Credit clears its replacement quantity", () => {
  const defect = { id: "def-1", recordState: "Active", defectAction: "Request Replacement", defectQty: 5, replacementQty: 5 } as unknown as IncomingDefectRecord;
  const patch = buildEditPatch(
    { endpoint: "incoming-defects", record: defect },
    editForm({ defectAction: "Request Credit", defectQty: "5", poQty: "", receivedQty: "", replacementReceiptsJson: "[]", materialReturned: "false" }),
  );
  assert.equal(patch.replacementQty, null);
  assert.equal(patch.poQty, null);
  assert.equal(patch.receivedQty, null);
  assert.equal(patch.actionCompleted, true);
});

test("an unfinished replacement sends a null completion date", () => {
  const defect = { id: "def-1", recordState: "Active", defectAction: "Request Replacement", defectQty: 5 } as unknown as IncomingDefectRecord;
  const patch = buildEditPatch(
    { endpoint: "incoming-defects", record: defect },
    editForm({ defectAction: "Request Replacement", defectQty: "5", replacementQty: "5", poQty: "", receivedQty: "", replacementReceiptsJson: "[]", materialReturned: "false" }),
  );
  assert.equal(patch.actionCompleted, false);
  assert.equal(patch.actionCompletedDate, null);
  assert.equal(patch.replacementQty, 5);
});
```

- [ ] **Step 7: Run the frontend tests to verify the new ones fail**

Run: `npx tsx --test src/lib/editPatch.test.ts`
Expected: FAIL — the new tests see `undefined` where they expect `null` (for example `patch.effectiveTo` is `undefined`), and "a field that is not in the form is not sent" fails on `voidReason`.

- [ ] **Step 8: Send `null` for emptied fields in `buildEditPatch`**

In `src/modals/record/editHelpers.ts`:

Replace the opening of `buildEditPatch` down to the `setNumber` helper with:

```ts
export function buildEditPatch(target: EditTarget, form: FormData) {
  const patch: Record<string, unknown> = {
    recordState: String(form.get("recordState") ?? target.record.recordState ?? "Active"),
  };
  const setString = (name: string) => {
    if (form.has(name)) patch[name] = String(form.get(name) ?? "");
  };
  // null, not undefined: JSON drops undefined, and the server keeps a field it never receives.
  const setOptionalString = (name: string) => {
    if (form.has(name)) patch[name] = String(form.get(name) ?? "") || null;
  };
  const setNumber = (name: string) => {
    if (form.has(name)) patch[name] = Number(form.get(name) ?? 0);
  };
```

In the `setString` field list, remove `"erpVendorId", `. Replace the `setOptionalString` loop with:

```ts
  for (const field of ["voidReason", "erpVendorId", "targetCloseDate", "signedDate", "effectiveTo", "returnDate"]) setOptionalString(field);
```

In the quotes block, change `patch.validUntil = undefined;` to `patch.validUntil = null;`.

In the suppliers block, delete the line `patch.erpVendorId = String(form.get("erpVendorId") ?? "") || undefined;`.

Replace the whole `if (target.endpoint === "incoming-defects") { ... }` block with:

```ts
  if (target.endpoint === "incoming-defects") {
    const replacementReceipts = JSON.parse(String(form.get("replacementReceiptsJson") ?? "[]")) as NonNullable<IncomingDefectRecord["replacementReceipts"]>;
    const optionalNumber = (name: string) => (String(form.get(name) ?? "") ? Number(form.get(name)) : undefined);
    const defectAction = patch.defectAction as IncomingDefectRecord["defectAction"];
    const poQty = optionalNumber("poQty");
    const receivedQty = optionalNumber("receivedQty");
    const replacementQty = defectAction === "Request Replacement" ? Number(form.get("replacementQty") ?? form.get("defectQty") ?? 0) : undefined;
    patch.poQty = poQty ?? null;
    patch.receivedQty = receivedQty ?? null;
    patch.materialReturned = String(form.get("materialReturned") ?? "false") === "true";
    patch.replacementReceipts = replacementReceipts;
    patch.replacementQty = replacementQty ?? null;
    patch.actionCompleted = isIncomingDefectComplete({
      defectAction,
      defectQty: Number(patch.defectQty ?? 0),
      poQty,
      receivedQty,
      replacementQty,
      replacementReceipts,
    });
    patch.actionCompletedDate = patch.actionCompleted ? String(form.get("returnDate") ?? "") || todayDateString() : null;
    if (patch.materialReturned && !patch.returnDate) throw new Error("Return date is required when defect material has been returned.");
  }
```

- [ ] **Step 9: Run both test files to verify they pass**

Run: `npx tsx --test src/lib/editPatch.test.ts server/patch.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 10: Run the full offline suite and both type checks**

Run: `npm test && npm run typecheck:api && npx tsc -p tsconfig.json --noEmit`
Expected: all tests pass; both type checks exit 0.

- [ ] **Step 11: Commit**

```bash
git add server/patch.ts server/patch.test.ts server/app.ts src/modals/record/editHelpers.ts src/lib/editPatch.test.ts
git commit -F - <<'EOF'
Clear fields that an edit empties

The edit form sent emptied fields as undefined, which JSON drops, so the
server kept the old value. A defect could not be switched to Request Credit
at all: its kept replacement quantity failed validation. The form now sends
null, and the server removes a field whose patch value is null.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Create the business tables and keep database tests out of the working tree

**Files:**
- Create: `migrations/003_business_data.sql`, `server/pgTypes.ts`, `server/db/businessSchema.test.ts`
- Modify: `server/db.ts` (import the parsers), `server/testDb.ts` (`withTestApp` changes directory)
- Test: `server/db/businessSchema.test.ts`, `server/db/testDb.test.ts`

**Interfaces:**
- Produces: the tables and columns below (every later task reads and writes them); importing `./pgTypes` makes `date` columns load as `YYYY-MM-DD` strings and `numeric` columns as numbers.

- [ ] **Step 1: Write the failing schema tests**

Create `server/db/businessSchema.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import "../pgTypes";
import { withTestDatabase } from "../testDb";

const BUSINESS_TABLES = [
  "drawing_items", "drawing_sets", "files", "id_counters", "incoming_defects", "inspections", "items", "models",
  "price_changes", "projects", "purchase_prices", "quote_case_links", "quotes", "score_weights", "source_assignments", "suppliers",
];

const insertModel = `INSERT INTO models (id, name, product_family, status, notes) VALUES ('model-1001', 'BTA', 'Solar Module', 'Active', '')`;
const insertDrawingSet = (modelId: string) =>
  `INSERT INTO drawing_sets (id, model_id, name, revision, status, effective_date, maintained_by)
   VALUES ('dwgset-1001', '${modelId}', 'BTA packaging', '1.0', 'Active', '2026-01-01', 'Process Engineering')`;

test("creates every business table", async () => {
  await withTestDatabase(async (client) => {
    const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = current_schema()");
    const tables = rows.map((row) => row.tablename as string);
    for (const table of BUSINESS_TABLES) assert.ok(tables.includes(table), table);
  });
});

test("seeds the default score weights as numbers", async () => {
  await withTestDatabase(async (client) => {
    const { rows } = await client.query(
      "SELECT sample_quality, incoming_quality, pricing, responsiveness, scope_fit, setup FROM score_weights WHERE id = 1",
    );
    assert.deepEqual(rows, [{ sample_quality: 25, incoming_quality: 20, pricing: 20, responsiveness: 15, scope_fit: 10, setup: 10 }]);
  });
});

test("a date comes back as the stored day", async () => {
  await withTestDatabase(async (client) => {
    await client.query(insertModel);
    await client.query(insertDrawingSet("model-1001"));
    const { rows } = await client.query("SELECT effective_date FROM drawing_sets");
    assert.equal(rows[0].effective_date, "2026-01-01");
  });
});

test("a reference to a missing record is refused when the transaction commits", async () => {
  await withTestDatabase(async (client) => {
    await client.query("BEGIN");
    await client.query(insertDrawingSet("model-9999"));
    await assert.rejects(client.query("COMMIT"), /foreign key/);
  });
});

test("deleting a drawing set deletes its items", async () => {
  await withTestDatabase(async (client) => {
    await client.query(insertModel);
    await client.query(insertDrawingSet("model-1001"));
    await client.query(`INSERT INTO items (id, item_code, item_name, type, used_for_models, uom, status)
      VALUES ('item-1001', 'PAL-01', 'Pallet', 'Pallet', '{model-1001}', 'pcs', 'Active')`);
    await client.query(`INSERT INTO drawing_items (id, drawing_set_id, position, item_id, revision, status, drawing_source)
      VALUES ('dwgitem-1001', 'dwgset-1001', 0, 'item-1001', '1.0', 'Active', 'Package PDF')`);
    await client.query("DELETE FROM drawing_sets WHERE id = 'dwgset-1001'");
    const { rows } = await client.query("SELECT count(*)::int AS count FROM drawing_items");
    assert.equal(rows[0].count, 0);
  });
});

test("a quote may point at a drawing item that no longer exists", async () => {
  await withTestDatabase(async (client) => {
    await client.query(insertModel);
    await client.query(insertDrawingSet("model-1001"));
    await client.query(`INSERT INTO items (id, item_code, item_name, type, used_for_models, uom, status)
      VALUES ('item-1001', 'PAL-01', 'Pallet', 'Pallet', '{model-1001}', 'pcs', 'Active')`);
    await client.query(`INSERT INTO suppliers (id, name, status, type, country, region, capable_items, primary_contact, email, phone, payment_terms, has_w9, has_payment_info, notes)
      VALUES ('sup-1001', 'Legacy Paper', 'Active', 'Manufacturer', 'United States', '', '{Pallet}', '', '', '', '', false, false, '')`);
    await client.query("BEGIN");
    await client.query(`INSERT INTO quotes (id, supplier_id, quote_type, quote_reason, model_id, item_id, drawing_set_id, drawing_item_id,
        quote_date, effective_from, currency, uom, unit_price, moq, lead_time, extra_cost_type, extra_cost_amount, status, notes)
      VALUES ('q-1001', 'sup-1001', 'Standalone', 'New Quote', 'model-1001', 'item-1001', 'dwgset-1001', 'dwgitem-9999',
        '2026-02-10', '2026-02-10', 'USD', 'pcs', 12.5, '100', '14 days', 'None', 0, 'Received', '')`);
    await client.query("COMMIT");
    const { rows } = await client.query("SELECT unit_price FROM quotes");
    assert.equal(rows[0].unit_price, 12.5);
  });
});
```

- [ ] **Step 2: Run the schema tests to verify they fail**

Run: `npx tsx --env-file-if-exists=.env --test --test-concurrency=1 server/db/businessSchema.test.ts`
Expected: FAIL — `Cannot find module '../pgTypes'`.

- [ ] **Step 3: Add the `pg` type parsers**

Create `server/pgTypes.ts`:

```ts
import { types } from "pg";

// A date column holds a calendar day. pg would turn it into a Date at local
// midnight, which can shift the day when it is turned back into text; keep
// the YYYY-MM-DD string instead.
types.setTypeParser(types.builtins.DATE, (value) => value);

// numeric arrives as text so nothing is lost in transit; prices, quantities
// and weights are JavaScript numbers everywhere else in the app.
types.setTypeParser(types.builtins.NUMERIC, (value) => Number(value));
```

In `server/db.ts`, add `import "./pgTypes";` as the first line.

- [ ] **Step 4: Write the migration**

Create `migrations/003_business_data.sql`:

```sql
-- Business records, previously data/store.json and uploads/. Each column is a
-- record field in snake_case; server/storeTables.ts lists them. Foreign keys
-- are checked at commit, so a request's writes may go in any order.

CREATE TABLE files (
  id                 text PRIMARY KEY,
  file_name          text NOT NULL,
  mime_type          text NOT NULL,
  size               integer NOT NULL,
  uploaded_at        timestamptz NOT NULL,
  purpose            text NOT NULL,
  linked_record_type text,
  linked_record_id   text,
  content            bytea NOT NULL
);

CREATE TABLE suppliers (
  id                   text PRIMARY KEY,
  record_state         text,
  void_reason          text,
  name                 text NOT NULL,
  erp_vendor_id        text,
  status               text NOT NULL,
  type                 text NOT NULL,
  country              text NOT NULL,
  region               text NOT NULL,
  capable_items        text[] NOT NULL,
  primary_contact      text NOT NULL,
  email                text NOT NULL,
  phone                text NOT NULL,
  payment_terms        text NOT NULL,
  has_w9               boolean NOT NULL,
  has_payment_info     boolean NOT NULL,
  w9_file_id           text REFERENCES files(id) DEFERRABLE INITIALLY DEFERRED,
  payment_info_file_id text REFERENCES files(id) DEFERRABLE INITIALLY DEFERRED,
  notes                text NOT NULL
);

CREATE TABLE models (
  id             text PRIMARY KEY,
  record_state   text,
  void_reason    text,
  name           text NOT NULL,
  product_family text NOT NULL,
  status         text NOT NULL,
  notes          text NOT NULL
);

CREATE TABLE items (
  id              text PRIMARY KEY,
  record_state    text,
  void_reason     text,
  item_code       text NOT NULL,
  item_name       text NOT NULL,
  type            text NOT NULL,
  used_for_models text[] NOT NULL,
  uom             text NOT NULL,
  status          text NOT NULL
);

CREATE TABLE drawing_sets (
  id                text PRIMARY KEY,
  record_state      text,
  void_reason       text,
  model_id          text NOT NULL REFERENCES models(id) DEFERRABLE INITIALLY DEFERRED,
  name              text NOT NULL,
  revision          text NOT NULL,
  status            text NOT NULL,
  effective_date    date NOT NULL,
  maintained_by     text NOT NULL,
  package_file_id   text REFERENCES files(id) DEFERRABLE INITIALLY DEFERRED,
  package_file_name text
);

CREATE TABLE drawing_items (
  id             text PRIMARY KEY,
  drawing_set_id text NOT NULL REFERENCES drawing_sets(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  position       integer NOT NULL,
  item_id        text NOT NULL REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
  revision       text NOT NULL,
  status         text NOT NULL,
  drawing_source text NOT NULL,
  file_name      text,
  file_id        text REFERENCES files(id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE projects (
  id                text PRIMARY KEY,
  record_state      text,
  void_reason       text,
  name              text NOT NULL,
  model_ids         text[] NOT NULL,
  drawing_set_id    text NOT NULL REFERENCES drawing_sets(id) DEFERRABLE INITIALLY DEFERRED,
  type              text NOT NULL,
  case_reason       text NOT NULL,
  status            text NOT NULL,
  supplier_ids      text[] NOT NULL,
  item_ids          text[] NOT NULL,
  owner             text NOT NULL,
  open_date         date NOT NULL,
  target_close_date date
);

-- drawing_item_id has no foreign key: editing a packaging set rebuilds its
-- item rows, and a quote may keep pointing at one that was removed.
CREATE TABLE quotes (
  id                 text PRIMARY KEY,
  record_state       text,
  void_reason        text,
  supplier_id        text NOT NULL REFERENCES suppliers(id) DEFERRABLE INITIALLY DEFERRED,
  project_id         text REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED,
  quote_type         text NOT NULL,
  quote_reason       text NOT NULL,
  previous_quote_id  text REFERENCES quotes(id) DEFERRABLE INITIALLY DEFERRED,
  model_id           text NOT NULL REFERENCES models(id) DEFERRABLE INITIALLY DEFERRED,
  item_id            text NOT NULL REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
  drawing_set_id     text NOT NULL REFERENCES drawing_sets(id) DEFERRABLE INITIALLY DEFERRED,
  drawing_item_id    text NOT NULL,
  quote_date         date NOT NULL,
  effective_from     date NOT NULL,
  effective_to       date,
  valid_until        date,
  currency           text NOT NULL,
  uom                text NOT NULL,
  unit_price         numeric NOT NULL,
  moq                text NOT NULL,
  lead_time          text NOT NULL,
  extra_cost_type    text NOT NULL,
  extra_cost_amount  numeric NOT NULL,
  status             text NOT NULL,
  attachment_file_id text REFERENCES files(id) DEFERRABLE INITIALLY DEFERRED,
  notes              text NOT NULL
);

CREATE TABLE quote_case_links (
  id                 text PRIMARY KEY,
  record_state       text,
  void_reason        text,
  quote_id           text NOT NULL REFERENCES quotes(id) DEFERRABLE INITIALLY DEFERRED,
  project_id         text NOT NULL REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED,
  supplier_id        text NOT NULL REFERENCES suppliers(id) DEFERRABLE INITIALLY DEFERRED,
  item_id            text NOT NULL REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
  model_id           text NOT NULL REFERENCES models(id) DEFERRABLE INITIALLY DEFERRED,
  link_type          text NOT NULL,
  sample_requirement text NOT NULL
);

CREATE TABLE source_assignments (
  id              text PRIMARY KEY,
  record_state    text,
  void_reason     text,
  project_id      text REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED,
  model_id        text NOT NULL REFERENCES models(id) DEFERRABLE INITIALLY DEFERRED,
  item_id         text NOT NULL REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
  supplier_id     text NOT NULL REFERENCES suppliers(id) DEFERRABLE INITIALLY DEFERRED,
  source_quote_id text REFERENCES quotes(id) DEFERRABLE INITIALLY DEFERRED,
  role            text NOT NULL,
  effective_from  date NOT NULL,
  notes           text NOT NULL
);

CREATE TABLE inspections (
  id                   text PRIMARY KEY,
  record_state         text,
  void_reason          text,
  supplier_id          text NOT NULL REFERENCES suppliers(id) DEFERRABLE INITIALLY DEFERRED,
  project_id           text REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED,
  related_quote_id     text REFERENCES quotes(id) DEFERRABLE INITIALLY DEFERRED,
  model_id             text NOT NULL REFERENCES models(id) DEFERRABLE INITIALLY DEFERRED,
  drawing_set_id       text NOT NULL REFERENCES drawing_sets(id) DEFERRABLE INITIALLY DEFERRED,
  item_id              text NOT NULL REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
  drawing_item_id      text NOT NULL,
  sample_round         integer NOT NULL,
  sample_received_date date NOT NULL,
  inspection_date      date,
  inspector            text,
  result               text NOT NULL,
  disposition          text NOT NULL,
  problem_photos       integer NOT NULL,
  photo_file_ids       text[] NOT NULL,
  notes                text NOT NULL,
  signed_date          date
);

CREATE TABLE incoming_defects (
  id                    text PRIMARY KEY,
  record_state          text,
  void_reason           text,
  supplier_id           text NOT NULL REFERENCES suppliers(id) DEFERRABLE INITIALLY DEFERRED,
  model_id              text REFERENCES models(id) DEFERRABLE INITIALLY DEFERRED,
  item_id               text NOT NULL REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
  po_number             text,
  po_qty                integer,
  defect_type           text NOT NULL,
  defect_date           date NOT NULL,
  defect_qty            integer NOT NULL,
  received_qty          integer,
  defect_action         text NOT NULL,
  replacement_qty       integer,
  replacement_receipts  jsonb NOT NULL,
  action_completed      boolean NOT NULL,
  action_completed_date date,
  material_returned     boolean NOT NULL,
  return_date           date,
  notes                 text NOT NULL,
  photo_file_ids        text[] NOT NULL,
  attachment_file_ids   text[] NOT NULL
);

CREATE TABLE purchase_prices (
  id              text PRIMARY KEY,
  record_state    text,
  void_reason     text,
  supplier_id     text NOT NULL REFERENCES suppliers(id) DEFERRABLE INITIALLY DEFERRED,
  model_id        text NOT NULL REFERENCES models(id) DEFERRABLE INITIALLY DEFERRED,
  item_id         text NOT NULL REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
  po_number       text NOT NULL,
  order_date      date NOT NULL,
  unit_price      numeric NOT NULL,
  quantity        numeric NOT NULL,
  currency        text NOT NULL,
  uom             text NOT NULL,
  source_type     text NOT NULL,
  linked_quote_id text REFERENCES quotes(id) DEFERRABLE INITIALLY DEFERRED,
  buyer           text NOT NULL,
  notes           text NOT NULL
);

CREATE TABLE price_changes (
  id                         text PRIMARY KEY,
  record_state               text,
  void_reason                text,
  supplier_id                text NOT NULL REFERENCES suppliers(id) DEFERRABLE INITIALLY DEFERRED,
  model_id                   text NOT NULL REFERENCES models(id) DEFERRABLE INITIALLY DEFERRED,
  item_id                    text NOT NULL REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
  source_quote_id            text REFERENCES quotes(id) DEFERRABLE INITIALLY DEFERRED,
  previous_quote_id          text REFERENCES quotes(id) DEFERRABLE INITIALLY DEFERRED,
  source_purchase_price_id   text REFERENCES purchase_prices(id) DEFERRABLE INITIALLY DEFERRED,
  previous_purchase_price_id text REFERENCES purchase_prices(id) DEFERRABLE INITIALLY DEFERRED,
  source_type                text NOT NULL,
  old_price                  numeric NOT NULL,
  new_price                  numeric NOT NULL,
  currency                   text NOT NULL,
  effective_date             date NOT NULL,
  reason                     text NOT NULL,
  status                     text NOT NULL
);

CREATE TABLE score_weights (
  id               smallint PRIMARY KEY CHECK (id = 1),
  sample_quality   numeric NOT NULL,
  incoming_quality numeric NOT NULL,
  pricing          numeric NOT NULL,
  responsiveness   numeric NOT NULL,
  scope_fit        numeric NOT NULL,
  setup            numeric NOT NULL
);

INSERT INTO score_weights (id, sample_quality, incoming_quality, pricing, responsiveness, scope_fit, setup)
VALUES (1, 25, 20, 20, 15, 10, 10);

-- The last number issued for each ID prefix, so a deleted record's ID is never reused.
CREATE TABLE id_counters (
  prefix text PRIMARY KEY,
  value  integer NOT NULL
);
```

- [ ] **Step 5: Run the schema tests to verify they pass**

Run: `npx tsx --env-file-if-exists=.env --test --test-concurrency=1 server/db/businessSchema.test.ts server/db/migrate.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Write the failing working-directory test**

Append to `server/db/testDb.test.ts` (add `existsSync` from `node:fs`, `join` from `node:path` and `withTestApp` to the imports):

```ts
test("withTestApp runs the app outside the working tree", async () => {
  const workingTree = process.cwd();
  await withTestApp(async () => {
    assert.notEqual(process.cwd(), workingTree);
    assert.equal(existsSync(join(process.cwd(), "package.json")), false);
  });
});
```

Run: `npx tsx --env-file-if-exists=.env --test --test-concurrency=1 server/db/testDb.test.ts`
Expected: FAIL — `process.cwd()` is still the repository.

- [ ] **Step 7: Run the app under test from a temporary directory**

In `server/testDb.ts`, add `import { mkdtempSync } from "node:fs";`, `import { tmpdir } from "node:os";` and `import { join } from "node:path";`, then in `withTestApp` directly after `process.env.DATABASE_URL = connectionString;` add:

```ts
  // Run the app from an empty directory, so nothing it resolves against the
  // working directory (data/, uploads/, dist/) can reach the developer's files.
  process.chdir(mkdtempSync(join(tmpdir(), "sourcing-test-")));
```

- [ ] **Step 8: Run the whole database suite**

Run: `npm run test:db`
Expected: PASS. The app-level tests now write their JSON store under the temporary directory; `git status` shows no change to `data/`.

- [ ] **Step 9: Commit**

```bash
git add migrations/003_business_data.sql server/pgTypes.ts server/db.ts server/testDb.ts server/db/businessSchema.test.ts server/db/testDb.test.ts
git commit -F - <<'EOF'
Create the business tables and run app tests outside the working tree

Migration 003 adds a typed table for every business record, file contents,
the score weights and the ID counters. Foreign keys are checked at commit.
withTestApp now starts the app in a temporary directory, so database tests
can no longer write to the developer's data/store.json.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Map every record to its table row

**Files:**
- Create: `server/storeShape.ts`, `server/storeTables.ts`, `server/testFixtures.ts`
- Modify: `server/store.ts` (take `Store` and `defaultScoreWeights` from `storeShape.ts`)
- Test: `server/storeTables.test.ts`

**Interfaces:**
- Consumes: the tables from Task 2.
- Produces:
  - `storeShape.ts`: `interface Store` (unchanged shape), `defaultScoreWeights(): ScoreWeights`, `emptyStore(): Store`.
  - `storeTables.ts`: `interface TableDef { table: string; fields: readonly string[]; json?: readonly string[]; timestamps?: readonly string[] }`, `type Row = unknown[]`, `TABLES` (keys: `files`, `suppliers`, `models`, `items`, `drawingSets`, `drawingItems`, `projects`, `quotes`, `quoteCaseLinks`, `sourceAssignments`, `inspections`, `incomingDefects`, `priceChanges`, `purchasePrices`), `columnName(field)`, `toRow(def, record): Row`, `fromRow(def, row): Record<string, unknown>`, `flattenDrawingItems(drawingSets)`, `attachDrawingItems(drawingSets, drawingItems)`.
  - `testFixtures.ts`: `sampleStore(): Store`, `sampleFileContents(): Map<string, Buffer>`.

- [ ] **Step 1: Move the `Store` type out of `server/store.ts`**

Create `server/storeShape.ts`:

```ts
import type {
  DrawingSet,
  IncomingDefectRecord,
  Model,
  PackagingItem,
  PriceChange,
  PurchasePriceRecord,
  Quote,
  QuoteCaseLink,
  SampleInspection,
  ScoreWeights,
  SourceAssignment,
  SourcingProject,
  Supplier,
  UploadedFileRecord,
} from "../src/types";

/** Every business record plus the score weights: what /api/bootstrap returns. */
export interface Store {
  suppliers: Supplier[];
  models: Model[];
  items: PackagingItem[];
  drawingSets: DrawingSet[];
  projects: SourcingProject[];
  quotes: Quote[];
  quoteCaseLinks: QuoteCaseLink[];
  sourceAssignments: SourceAssignment[];
  inspections: SampleInspection[];
  incomingDefects: IncomingDefectRecord[];
  priceChanges: PriceChange[];
  purchasePrices: PurchasePriceRecord[];
  files: UploadedFileRecord[];
  scoreWeights: ScoreWeights;
}

export function defaultScoreWeights(): ScoreWeights {
  return {
    sampleQuality: 25,
    incomingQuality: 20,
    pricing: 20,
    responsiveness: 15,
    scopeFit: 10,
    setup: 10,
  };
}

export function emptyStore(): Store {
  return {
    suppliers: [],
    models: [],
    items: [],
    drawingSets: [],
    projects: [],
    quotes: [],
    quoteCaseLinks: [],
    sourceAssignments: [],
    inspections: [],
    incomingDefects: [],
    priceChanges: [],
    purchasePrices: [],
    files: [],
    scoreWeights: defaultScoreWeights(),
  };
}
```

In `server/store.ts`, delete the `export interface Store { ... }` block and the `function defaultScoreWeights() { ... }` function, and add below the existing imports:

```ts
import { defaultScoreWeights, type Store } from "./storeShape";

export type { Store };
```

Run: `npm run typecheck:api`
Expected: exit 0.

- [ ] **Step 2: Create the sample store fixture**

Create `server/testFixtures.ts`:

```ts
import type { Store } from "./storeShape";

/**
 * One or two of every business record, linked the way the app links them.
 * The first record of each kind sets every optional field; the second, where
 * there is one, sets only the required ones. `q-1002` points at a drawing item
 * that does not exist, which the schema allows.
 */
export function sampleStore(): Store {
  return {
    files: [
      {
        id: "file-1001",
        fileName: "W9 2026.pdf",
        mimeType: "application/pdf",
        size: 3,
        storagePath: "uploads/file-1001.pdf",
        uploadedAt: "2026-09-01T12:00:00.000Z",
        purpose: "Supplier W9",
        linkedRecordType: "supplier",
        linkedRecordId: "sup-1001",
      },
      {
        id: "file-1002",
        fileName: "photo.JPG",
        mimeType: "image/jpeg",
        size: 3,
        storagePath: "uploads/file-1002.jpg",
        uploadedAt: "2026-09-02T08:30:00.000Z",
        purpose: "QC Photo",
      },
    ],
    suppliers: [
      {
        id: "sup-1001",
        recordState: "Active",
        voidReason: "Restored after review",
        name: "Legacy Paper",
        erpVendorId: "V-1001",
        status: "Approved",
        type: "Manufacturer",
        country: "United States",
        region: "TX",
        capableItems: ["Pallet", "Strapping"],
        primaryContact: "Ann Lee",
        email: "ann@example.com",
        phone: "555-0100",
        paymentTerms: "Net 30",
        hasW9: true,
        hasPaymentInfo: true,
        w9FileId: "file-1001",
        paymentInfoFileId: "file-1001",
        notes: "Preferred for pallets",
      },
      {
        id: "sup-1002",
        name: "UFP New Waverly",
        status: "Active",
        type: "Distributor",
        country: "United States",
        region: "",
        capableItems: [],
        primaryContact: "",
        email: "",
        phone: "",
        paymentTerms: "",
        hasW9: false,
        hasPaymentInfo: false,
        notes: "",
      },
    ],
    models: [
      { id: "model-1001", recordState: "Active", voidReason: "n/a", name: "BTA", productFamily: "Solar Module", status: "Active", notes: "Main line" },
      { id: "model-1002", name: "BTC 620", productFamily: "Solar Module", status: "Inactive", notes: "" },
    ],
    items: [
      {
        id: "item-1001",
        recordState: "Active",
        voidReason: "n/a",
        itemCode: "PAL-01",
        itemName: "Pallet",
        type: "Pallet",
        usedForModels: ["model-1001", "model-1002"],
        uom: "pcs",
        status: "Active",
      },
      { id: "item-1002", itemCode: "STR-01", itemName: "Strap", type: "Strapping", usedForModels: [], uom: "bundle", status: "Inactive" },
    ],
    drawingSets: [
      {
        id: "dwgset-1001",
        recordState: "Active",
        voidReason: "n/a",
        modelId: "model-1001",
        name: "BTA packaging",
        revision: "1.0",
        status: "Active",
        effectiveDate: "2026-01-15",
        maintainedBy: "Process Engineering",
        packageFileId: "file-1001",
        packageFileName: "W9 2026.pdf",
        drawingItems: [
          {
            id: "dwgitem-1001",
            itemId: "item-1001",
            revision: "1.0",
            status: "Active",
            drawingSource: "Item-specific PDF",
            fileName: "W9 2026.pdf",
            fileId: "file-1001",
          },
          { id: "dwgitem-1002", itemId: "item-1002", revision: "1.0", status: "Superseded", drawingSource: "Package PDF" },
        ],
      },
      {
        id: "dwgset-1002",
        modelId: "model-1002",
        name: "BTC packaging",
        revision: "1.0",
        status: "Draft",
        effectiveDate: "2026-03-01",
        maintainedBy: "Process Engineering",
        drawingItems: [],
      },
    ],
    projects: [
      {
        id: "proj-1001",
        recordState: "Active",
        voidReason: "n/a",
        name: "BTA packaging 2026",
        modelIds: ["model-1001"],
        drawingSetId: "dwgset-1001",
        type: "New Supplier Development",
        caseReason: "New Supplier Intro",
        status: "Quoting",
        supplierIds: ["sup-1001", "sup-1002"],
        itemIds: ["item-1001"],
        owner: "Purchasing",
        openDate: "2026-02-01",
        targetCloseDate: "2026-03-31",
      },
    ],
    quotes: [
      {
        id: "q-1001",
        recordState: "Active",
        voidReason: "n/a",
        supplierId: "sup-1001",
        projectId: "proj-1001",
        quoteType: "Case-linked",
        quoteReason: "New Quote",
        previousQuoteId: "q-1002",
        modelId: "model-1001",
        itemId: "item-1001",
        drawingSetId: "dwgset-1001",
        drawingItemId: "dwgitem-1001",
        quoteDate: "2026-02-10",
        effectiveFrom: "2026-02-10",
        effectiveTo: "2026-12-31",
        validUntil: "2026-03-10",
        currency: "USD",
        uom: "pcs",
        unitPrice: 12.3456,
        moq: "100",
        leadTime: "14 days",
        extraCostType: "Freight",
        extraCostAmount: 150.5,
        status: "Selected",
        attachmentFileId: "file-1001",
        notes: "Best price",
      },
      {
        id: "q-1002",
        supplierId: "sup-1001",
        quoteType: "Standalone",
        quoteReason: "New Quote",
        modelId: "model-1001",
        itemId: "item-1001",
        drawingSetId: "dwgset-1001",
        drawingItemId: "dwgitem-9999",
        quoteDate: "2026-01-20",
        effectiveFrom: "2026-01-20",
        currency: "USD",
        uom: "pcs",
        unitPrice: 12,
        moq: "100",
        leadTime: "3 weeks",
        extraCostType: "None",
        extraCostAmount: 0,
        status: "Received",
        notes: "",
      },
    ],
    quoteCaseLinks: [
      {
        id: "ql-1001",
        recordState: "Active",
        voidReason: "n/a",
        quoteId: "q-1001",
        projectId: "proj-1001",
        supplierId: "sup-1001",
        itemId: "item-1001",
        modelId: "model-1001",
        linkType: "Origin Case",
        sampleRequirement: "Required",
      },
    ],
    sourceAssignments: [
      {
        id: "assign-1001",
        recordState: "Active",
        voidReason: "n/a",
        projectId: "proj-1001",
        modelId: "model-1001",
        itemId: "item-1001",
        supplierId: "sup-1001",
        sourceQuoteId: "q-1001",
        role: "Primary",
        effectiveFrom: "2026-03-01",
        notes: "Primary source",
      },
    ],
    inspections: [
      {
        id: "ins-1001",
        recordState: "Active",
        voidReason: "n/a",
        supplierId: "sup-1001",
        projectId: "proj-1001",
        relatedQuoteId: "q-1001",
        modelId: "model-1001",
        drawingSetId: "dwgset-1001",
        itemId: "item-1001",
        drawingItemId: "dwgitem-1001",
        sampleRound: 2,
        sampleReceivedDate: "2026-02-20",
        inspectionDate: "2026-02-22",
        inspector: "QC Lead",
        result: "Pass",
        disposition: "Accepted",
        problemPhotos: 1,
        photoFileIds: ["file-1002"],
        notes: "Second round passed",
        signedDate: "2026-02-23",
      },
    ],
    incomingDefects: [
      {
        id: "def-1001",
        recordState: "Active",
        voidReason: "n/a",
        supplierId: "sup-1001",
        modelId: "model-1001",
        itemId: "item-1001",
        poNumber: "PO-1",
        poQty: 100,
        defectType: "Damage",
        defectDate: "2026-04-01",
        defectQty: 5,
        receivedQty: 95,
        defectAction: "Request Replacement",
        replacementQty: 5,
        replacementReceipts: [{ receivedDate: "2026-04-10", receivedQty: 5, result: "Accepted" }],
        actionCompleted: true,
        actionCompletedDate: "2026-04-10",
        materialReturned: true,
        returnDate: "2026-04-05",
        notes: "Forklift damage",
        photoFileIds: ["file-1002"],
        attachmentFileIds: ["file-1001"],
      },
      {
        id: "def-1002",
        supplierId: "sup-1002",
        itemId: "item-1001",
        defectType: "Other",
        defectDate: "2026-05-01",
        defectQty: 1,
        defectAction: "Request Credit",
        replacementReceipts: [],
        actionCompleted: true,
        materialReturned: false,
        notes: "",
        photoFileIds: [],
        attachmentFileIds: [],
      },
    ],
    purchasePrices: [
      {
        id: "po-1001",
        recordState: "Active",
        voidReason: "n/a",
        supplierId: "sup-1001",
        modelId: "model-1001",
        itemId: "item-1001",
        poNumber: "PO-1",
        orderDate: "2026-03-05",
        unitPrice: 12.25,
        quantity: 1000,
        currency: "USD",
        uom: "pcs",
        sourceType: "ERP Import",
        linkedQuoteId: "q-1001",
        buyer: "Purchasing",
        notes: "First order",
      },
    ],
    priceChanges: [
      {
        id: "pc-1001",
        recordState: "Active",
        voidReason: "n/a",
        supplierId: "sup-1001",
        modelId: "model-1001",
        itemId: "item-1001",
        sourceQuoteId: "q-1001",
        previousQuoteId: "q-1002",
        sourcePurchasePriceId: "po-1001",
        previousPurchasePriceId: "po-1001",
        sourceType: "Requote",
        oldPrice: 12,
        newPrice: 12.3456,
        currency: "USD",
        effectiveDate: "2026-02-10",
        reason: "Requote",
        status: "Pending",
      },
      {
        id: "pc-1002",
        supplierId: "sup-1002",
        modelId: "model-1002",
        itemId: "item-1002",
        sourceType: "Manual",
        oldPrice: 1,
        newPrice: 1.1,
        currency: "USD",
        effectiveDate: "2026-06-01",
        reason: "Other",
        status: "Approved",
      },
    ],
    scoreWeights: { sampleQuality: 30, incomingQuality: 20, pricing: 20, responsiveness: 10, scopeFit: 10, setup: 10 },
  };
}

/** Content for the sample store's files; each is 3 bytes, matching their recorded size. */
export function sampleFileContents(): Map<string, Buffer> {
  return new Map([
    ["file-1001", Buffer.from("pdf")],
    ["file-1002", Buffer.from("jpg")],
  ]);
}
```

Run: `npm run typecheck:api`
Expected: exit 0 (the fixture type-checks against `Store`).

- [ ] **Step 3: Write the failing mapping tests**

Create `server/storeTables.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  drawingSetSchema,
  incomingDefectSchema,
  inspectionSchema,
  itemSchema,
  modelSchema,
  priceChangeSchema,
  projectSchema,
  purchasePriceSchema,
  quoteSchema,
  sourceAssignmentSchema,
  supplierSchema,
} from "./schemas";
import { TABLES, attachDrawingItems, columnName, flattenDrawingItems, fromRow, toRow, type TableDef } from "./storeTables";
import { sampleStore } from "./testFixtures";

/** What pg hands back for a row: values keyed by column, timestamps as Dates. */
function asLoaded(def: TableDef, row: unknown[]) {
  return Object.fromEntries(
    def.fields.map((field, index) => {
      const value = row[index];
      return [columnName(field), value !== null && def.timestamps?.includes(field) ? new Date(value as string) : value];
    }),
  );
}

function roundTrip(def: TableDef, record: object) {
  return fromRow(def, asLoaded(def, toRow(def, record)));
}

const sorted = (values: Iterable<string>) => [...values].sort();

test("column names are the fields in snake case", () => {
  assert.equal(columnName("id"), "id");
  assert.equal(columnName("sampleReceivedDate"), "sample_received_date");
  assert.equal(columnName("w9FileId"), "w9_file_id");
  assert.equal(columnName("hasW9"), "has_w9");
});

test("every table starts with its id", () => {
  for (const def of Object.values(TABLES)) assert.equal(def.fields[0], "id", def.table);
});

test("every field a request can set has a column", () => {
  const cases: Array<[TableDef, string[]]> = [
    [TABLES.suppliers, Object.keys(supplierSchema.shape)],
    [TABLES.models, Object.keys(modelSchema.shape)],
    [TABLES.items, Object.keys(itemSchema.shape)],
    [TABLES.drawingSets, Object.keys(drawingSetSchema.shape).filter((key) => key !== "drawingItems")],
    [TABLES.drawingItems, [...Object.keys(drawingSetSchema.shape.drawingItems.removeDefault().element.shape), "drawingSetId", "position"]],
    [TABLES.projects, Object.keys(projectSchema.shape)],
    [TABLES.quotes, Object.keys(quoteSchema.shape)],
    [TABLES.sourceAssignments, Object.keys(sourceAssignmentSchema.shape)],
    [TABLES.inspections, Object.keys(inspectionSchema.shape)],
    [TABLES.incomingDefects, Object.keys(incomingDefectSchema.innerType().shape)],
    [TABLES.priceChanges, Object.keys(priceChangeSchema.shape)],
    [TABLES.purchasePrices, Object.keys(purchasePriceSchema.shape)],
  ];
  for (const [def, keys] of cases) assert.deepEqual(sorted(def.fields), sorted(["id", ...keys]), def.table);
});

test("case links and files, which have no request schema, keep every field", () => {
  const store = sampleStore();
  assert.deepEqual(sorted(TABLES.quoteCaseLinks.fields), sorted(Object.keys(store.quoteCaseLinks[0])));
  const { storagePath: _derived, ...file } = store.files[0];
  assert.deepEqual(sorted(TABLES.files.fields), sorted(Object.keys(file)));
});

test("every record maps to a row and back unchanged", () => {
  const store = sampleStore();
  const collections = [
    "suppliers", "models", "items", "projects", "quotes", "quoteCaseLinks", "sourceAssignments",
    "inspections", "incomingDefects", "priceChanges", "purchasePrices",
  ] as const;
  for (const collection of collections) {
    for (const record of store[collection]) assert.deepEqual(roundTrip(TABLES[collection], record), record, record.id);
  }
  for (const { drawingItems: _items, ...drawingSet } of store.drawingSets) {
    assert.deepEqual(roundTrip(TABLES.drawingSets, drawingSet), drawingSet);
  }
  for (const drawingItem of flattenDrawingItems(store.drawingSets)) {
    assert.deepEqual(roundTrip(TABLES.drawingItems, drawingItem), drawingItem);
  }
  for (const { storagePath: _derived, ...file } of store.files) assert.deepEqual(roundTrip(TABLES.files, file), file);
});

test("an absent optional field is stored as null and stays absent", () => {
  const minimal = sampleStore().quotes[1];
  const row = toRow(TABLES.quotes, minimal);
  assert.equal(row[TABLES.quotes.fields.indexOf("effectiveTo")], null);
  assert.equal("effectiveTo" in roundTrip(TABLES.quotes, minimal), false);
});

test("an explicit undefined is stored the same as an absent field", () => {
  const minimal = sampleStore().quotes[1];
  assert.deepEqual(toRow(TABLES.quotes, { ...minimal, effectiveTo: undefined }), toRow(TABLES.quotes, minimal));
});

test("false, zero and empty values are kept", () => {
  const supplier = roundTrip(TABLES.suppliers, sampleStore().suppliers[1]);
  assert.equal(supplier.hasW9, false);
  assert.equal(supplier.region, "");
  assert.deepEqual(supplier.capableItems, []);
  assert.equal(roundTrip(TABLES.quotes, sampleStore().quotes[1]).extraCostAmount, 0);
});

test("drawing items keep their set and their order", () => {
  const { drawingSets } = sampleStore();
  const rows = flattenDrawingItems(drawingSets);
  assert.deepEqual(
    rows.map((row) => [row.id, row.drawingSetId, row.position]),
    [["dwgitem-1001", "dwgset-1001", 0], ["dwgitem-1002", "dwgset-1001", 1]],
  );
  const setsWithoutItems = drawingSets.map(({ drawingItems: _items, ...drawingSet }) => drawingSet);
  assert.deepEqual(attachDrawingItems(setsWithoutItems, [...rows].reverse()), drawingSets);
});
```

- [ ] **Step 4: Run the mapping tests to verify they fail**

Run: `npx tsx --test server/storeTables.test.ts`
Expected: FAIL — `Cannot find module './storeTables'`.

- [ ] **Step 5: Implement the table definitions and mapping**

Create `server/storeTables.ts`:

```ts
import type { DrawingItem, DrawingSet } from "../src/types";

/** A business table and the record fields it stores, one column each; `id` comes first. */
export interface TableDef {
  table: string;
  fields: readonly string[];
  /** Fields stored as jsonb. */
  json?: readonly string[];
  /** Fields stored as timestamptz and held as ISO strings in records. */
  timestamps?: readonly string[];
}

/** A record's values in its table's field order, with null for an absent field. */
export type Row = unknown[];

export type StoredDrawingItem = DrawingItem & { drawingSetId: string; position: number };

const lifecycle = ["recordState", "voidReason"];

export const TABLES = {
  files: {
    table: "files",
    fields: ["id", "fileName", "mimeType", "size", "uploadedAt", "purpose", "linkedRecordType", "linkedRecordId"],
    timestamps: ["uploadedAt"],
  },
  suppliers: {
    table: "suppliers",
    fields: [
      "id", ...lifecycle, "name", "erpVendorId", "status", "type", "country", "region", "capableItems", "primaryContact",
      "email", "phone", "paymentTerms", "hasW9", "hasPaymentInfo", "w9FileId", "paymentInfoFileId", "notes",
    ],
  },
  models: { table: "models", fields: ["id", ...lifecycle, "name", "productFamily", "status", "notes"] },
  items: { table: "items", fields: ["id", ...lifecycle, "itemCode", "itemName", "type", "usedForModels", "uom", "status"] },
  drawingSets: {
    table: "drawing_sets",
    fields: ["id", ...lifecycle, "modelId", "name", "revision", "status", "effectiveDate", "maintainedBy", "packageFileId", "packageFileName"],
  },
  drawingItems: {
    table: "drawing_items",
    fields: ["id", "drawingSetId", "position", "itemId", "revision", "status", "drawingSource", "fileName", "fileId"],
  },
  projects: {
    table: "projects",
    fields: [
      "id", ...lifecycle, "name", "modelIds", "drawingSetId", "type", "caseReason", "status", "supplierIds", "itemIds",
      "owner", "openDate", "targetCloseDate",
    ],
  },
  quotes: {
    table: "quotes",
    fields: [
      "id", ...lifecycle, "supplierId", "projectId", "quoteType", "quoteReason", "previousQuoteId", "modelId", "itemId",
      "drawingSetId", "drawingItemId", "quoteDate", "effectiveFrom", "effectiveTo", "validUntil", "currency", "uom",
      "unitPrice", "moq", "leadTime", "extraCostType", "extraCostAmount", "status", "attachmentFileId", "notes",
    ],
  },
  quoteCaseLinks: {
    table: "quote_case_links",
    fields: ["id", ...lifecycle, "quoteId", "projectId", "supplierId", "itemId", "modelId", "linkType", "sampleRequirement"],
  },
  sourceAssignments: {
    table: "source_assignments",
    fields: ["id", ...lifecycle, "projectId", "modelId", "itemId", "supplierId", "sourceQuoteId", "role", "effectiveFrom", "notes"],
  },
  inspections: {
    table: "inspections",
    fields: [
      "id", ...lifecycle, "supplierId", "projectId", "relatedQuoteId", "modelId", "drawingSetId", "itemId", "drawingItemId",
      "sampleRound", "sampleReceivedDate", "inspectionDate", "inspector", "result", "disposition", "problemPhotos",
      "photoFileIds", "notes", "signedDate",
    ],
  },
  incomingDefects: {
    table: "incoming_defects",
    fields: [
      "id", ...lifecycle, "supplierId", "modelId", "itemId", "poNumber", "poQty", "defectType", "defectDate", "defectQty",
      "receivedQty", "defectAction", "replacementQty", "replacementReceipts", "actionCompleted", "actionCompletedDate",
      "materialReturned", "returnDate", "notes", "photoFileIds", "attachmentFileIds",
    ],
    json: ["replacementReceipts"],
  },
  priceChanges: {
    table: "price_changes",
    fields: [
      "id", ...lifecycle, "supplierId", "modelId", "itemId", "sourceQuoteId", "previousQuoteId", "sourcePurchasePriceId",
      "previousPurchasePriceId", "sourceType", "oldPrice", "newPrice", "currency", "effectiveDate", "reason", "status",
    ],
  },
  purchasePrices: {
    table: "purchase_prices",
    fields: [
      "id", ...lifecycle, "supplierId", "modelId", "itemId", "poNumber", "orderDate", "unitPrice", "quantity", "currency",
      "uom", "sourceType", "linkedQuoteId", "buyer", "notes",
    ],
  },
} satisfies Record<string, TableDef>;

export function columnName(field: string): string {
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function toRow(def: TableDef, record: object): Row {
  const values = record as Record<string, unknown>;
  return def.fields.map((field) => values[field] ?? null);
}

/** A record from a row pg returned. A NULL column becomes an absent field. */
export function fromRow(def: TableDef, row: Record<string, unknown>): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const field of def.fields) {
    const value = row[columnName(field)];
    if (value === null || value === undefined) continue;
    record[field] = def.timestamps?.includes(field) ? (value as Date).toISOString() : value;
  }
  return record;
}

/** Drawing items as rows of their own table: each carries its set's ID and its place in the set. */
export function flattenDrawingItems(drawingSets: DrawingSet[]): StoredDrawingItem[] {
  return drawingSets.flatMap((drawingSet) =>
    drawingSet.drawingItems.map((drawingItem, position) => ({ ...drawingItem, drawingSetId: drawingSet.id, position })),
  );
}

/** Puts loaded drawing items back on their sets, in their stored order. */
export function attachDrawingItems(drawingSets: Array<Omit<DrawingSet, "drawingItems">>, drawingItems: StoredDrawingItem[]): DrawingSet[] {
  const bySet = new Map<string, DrawingItem[]>();
  for (const { drawingSetId, position: _position, ...drawingItem } of [...drawingItems].sort((a, b) => a.position - b.position)) {
    bySet.set(drawingSetId, [...(bySet.get(drawingSetId) ?? []), drawingItem]);
  }
  return drawingSets.map((drawingSet) => ({ ...drawingSet, drawingItems: bySet.get(drawingSet.id) ?? [] }));
}
```

- [ ] **Step 6: Run the mapping tests to verify they pass**

Run: `npx tsx --test server/storeTables.test.ts`
Expected: PASS, 9 tests. If "every field a request can set has a column" fails, a field list in `TABLES` differs from the schema: fix `TABLES` (and the migration, if the column is missing there too) rather than the test.

- [ ] **Step 7: Run the full offline suite and the server type check**

Run: `npm test && npm run typecheck:api`
Expected: all pass, exit 0.

- [ ] **Step 8: Commit**

```bash
git add server/storeShape.ts server/storeTables.ts server/storeTables.test.ts server/testFixtures.ts server/store.ts
git commit -F - <<'EOF'
Map each business record to its table row

storeTables lists every table's fields in column order and converts records
to rows and back, with NULL for an absent field. A test checks each table
against its request schema so a new field cannot be left without a column.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Work out which rows a request changed

**Files:**
- Create: `server/storeDiff.ts`
- Test: `server/storeDiff.test.ts`

**Interfaces:**
- Consumes: `TABLES`, `toRow`, `flattenDrawingItems`, `Row`, `TableDef` (Task 3); `Store`, `emptyStore` (Task 3).
- Produces: `interface TableChanges { def: TableDef; inserts: Row[]; updates: Row[]; deletes: string[] }`, `diffRecords(def, before, after): TableChanges`, `diffStore(before: Store, after: Store): TableChanges[]` (score weights are not included; Task 8 compares them separately).

- [ ] **Step 1: Write the failing tests**

Create `server/storeDiff.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { diffRecords, diffStore } from "./storeDiff";
import { emptyStore } from "./storeShape";
import { TABLES, toRow } from "./storeTables";
import { sampleStore } from "./testFixtures";

function changedTables(changes: ReturnType<typeof diffStore>) {
  return changes
    .filter((change) => change.inserts.length + change.updates.length + change.deletes.length > 0)
    .map((change) => change.def.table);
}

test("identical stores have no changes", () => {
  assert.deepEqual(changedTables(diffStore(sampleStore(), sampleStore())), []);
});

test("a new record is an insert of its full row", () => {
  const before = sampleStore();
  const after = sampleStore();
  const model = { id: "model-1003", name: "BTD", productFamily: "Solar Module", status: "Active" as const, notes: "" };
  after.models.push(model);
  const changes = diffRecords(TABLES.models, before.models, after.models);
  assert.deepEqual(changes.inserts, [toRow(TABLES.models, model)]);
  assert.deepEqual([changes.updates, changes.deletes], [[], []]);
});

test("a changed record is an update of its full row", () => {
  const before = sampleStore();
  const after = sampleStore();
  after.quotes[0].status = "Not Selected";
  const changes = diffRecords(TABLES.quotes, before.quotes, after.quotes);
  assert.deepEqual(changes.updates, [toRow(TABLES.quotes, after.quotes[0])]);
  assert.deepEqual([changes.inserts, changes.deletes], [[], []]);
});

test("a removed record is a delete by id", () => {
  const before = sampleStore();
  const after = sampleStore();
  after.priceChanges = after.priceChanges.filter((change) => change.id !== "pc-1002");
  assert.deepEqual(diffRecords(TABLES.priceChanges, before.priceChanges, after.priceChanges).deletes, ["pc-1002"]);
});

test("reordered keys inside a json field are not a change", () => {
  const before = sampleStore();
  const after = sampleStore();
  after.incomingDefects[0].replacementReceipts = [{ result: "Accepted", receivedQty: 5, receivedDate: "2026-04-10" }];
  assert.deepEqual(changedTables(diffStore(before, after)), []);
});

test("an explicit undefined is not a change from an absent field", () => {
  const before = sampleStore();
  const after = sampleStore();
  after.suppliers[1] = { ...after.suppliers[1], erpVendorId: undefined };
  assert.deepEqual(changedTables(diffStore(before, after)), []);
});

test("drawing items are compared as rows of their own", () => {
  const before = sampleStore();
  const after = sampleStore();
  after.drawingSets[0].drawingItems.shift();
  const changes = diffStore(before, after).find((change) => change.def.table === "drawing_items");
  assert.deepEqual(changes?.deletes, ["dwgitem-1001"]);
  // The remaining item moved from position 1 to 0.
  assert.deepEqual(changes?.updates.map((row) => [row[0], row[2]]), [["dwgitem-1002", 0]]);
  assert.deepEqual(changedTables(diffStore(before, after)), ["drawing_items"]);
});

test("saving a whole store from empty inserts every record", () => {
  const store = sampleStore();
  const inserted = Object.fromEntries(diffStore(emptyStore(), store).map((change) => [change.def.table, change.inserts.length]));
  assert.deepEqual(inserted, {
    files: 2, suppliers: 2, models: 2, items: 2, drawing_sets: 2, drawing_items: 2, projects: 1, quotes: 2,
    quote_case_links: 1, source_assignments: 1, inspections: 1, incoming_defects: 2, purchase_prices: 1, price_changes: 2,
  });
});

test("score weights are not part of the table changes", () => {
  const after = sampleStore();
  after.scoreWeights.pricing = 40;
  assert.deepEqual(changedTables(diffStore(sampleStore(), after)), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test server/storeDiff.test.ts`
Expected: FAIL — `Cannot find module './storeDiff'`.

- [ ] **Step 3: Implement the difference**

Create `server/storeDiff.ts`:

```ts
import { isDeepStrictEqual } from "node:util";

import type { Store } from "./storeShape";
import { TABLES, flattenDrawingItems, toRow, type Row, type TableDef } from "./storeTables";

export interface TableChanges {
  def: TableDef;
  inserts: Row[];
  updates: Row[];
  deletes: string[];
}

/**
 * The rows to insert, update and delete to turn `before` into `after`,
 * matching records by ID. Rows are compared as values, so an explicit
 * undefined equals an absent field and key order inside json fields is ignored.
 */
export function diffRecords(def: TableDef, before: readonly object[], after: readonly object[]): TableChanges {
  const beforeRows = new Map(before.map((record) => {
    const row = toRow(def, record);
    return [row[0] as string, row] as const;
  }));
  const afterIds = new Set<string>();
  const changes: TableChanges = { def, inserts: [], updates: [], deletes: [] };
  for (const record of after) {
    const row = toRow(def, record);
    const id = row[0] as string;
    afterIds.add(id);
    const previous = beforeRows.get(id);
    if (!previous) changes.inserts.push(row);
    else if (!isDeepStrictEqual(previous, row)) changes.updates.push(row);
  }
  for (const id of beforeRows.keys()) {
    if (!afterIds.has(id)) changes.deletes.push(id);
  }
  return changes;
}

/** Every table's changes between two versions of the store. Score weights are compared separately. */
export function diffStore(before: Store, after: Store): TableChanges[] {
  return [
    diffRecords(TABLES.files, before.files, after.files),
    diffRecords(TABLES.suppliers, before.suppliers, after.suppliers),
    diffRecords(TABLES.models, before.models, after.models),
    diffRecords(TABLES.items, before.items, after.items),
    diffRecords(TABLES.drawingSets, before.drawingSets, after.drawingSets),
    diffRecords(TABLES.drawingItems, flattenDrawingItems(before.drawingSets), flattenDrawingItems(after.drawingSets)),
    diffRecords(TABLES.projects, before.projects, after.projects),
    diffRecords(TABLES.quotes, before.quotes, after.quotes),
    diffRecords(TABLES.quoteCaseLinks, before.quoteCaseLinks, after.quoteCaseLinks),
    diffRecords(TABLES.sourceAssignments, before.sourceAssignments, after.sourceAssignments),
    diffRecords(TABLES.inspections, before.inspections, after.inspections),
    diffRecords(TABLES.incomingDefects, before.incomingDefects, after.incomingDefects),
    diffRecords(TABLES.purchasePrices, before.purchasePrices, after.purchasePrices),
    diffRecords(TABLES.priceChanges, before.priceChanges, after.priceChanges),
  ];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test server/storeDiff.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add server/storeDiff.ts server/storeDiff.test.ts
git commit -F - <<'EOF'
Work out which rows a change to the store touches

diffStore compares two versions of the store table by table and returns the
rows to insert, update and delete, so a request writes only what it changed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Name stored files and build their download headers

**Files:**
- Modify: `server/uploads.ts`
- Test: `server/uploads.test.ts`

**Interfaces:**
- Produces, in `server/uploads.ts`:
  - `storagePath(id: string, fileName: string): string` — `uploads/<id><lower-cased extension>`, the path the frontend links to.
  - `fileIdFromStoredName(name: string): string | undefined` — the ID in a download path's last segment.
  - `downloadHeaders(file: { fileName: string; mimeType: string }): Record<string, string>`.
- `setUploadHeaders` stays until Task 8 removes the static `/uploads` handler.

- [ ] **Step 1: Write the failing tests**

Add `downloadHeaders`, `fileIdFromStoredName` and `storagePath` to the import from `./uploads` in `server/uploads.test.ts`, then append:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test server/uploads.test.ts`
Expected: FAIL — `downloadHeaders` is not exported.

- [ ] **Step 3: Implement the helpers**

Append to `server/uploads.ts`:

```ts
/** Where the frontend links to a stored file: its ID plus the lower-cased extension of its name. */
export function storagePath(id: string, fileName: string): string {
  return `uploads/${id}${extname(fileName).toLowerCase()}`;
}

/** The file ID in a download path's last segment, such as `file-1004` for `file-1004.pdf`. */
export function fileIdFromStoredName(name: string): string | undefined {
  return /^(file-\d+)\.[a-z0-9]+$/.exec(name)?.[1];
}

/**
 * Headers for sending a stored file. The type comes from the server's own
 * list, PDFs and images open in the browser, and anything else downloads.
 * Content never changes under an ID and IDs are never reused, so the browser
 * may keep its copy.
 */
export function downloadHeaders(file: { fileName: string; mimeType: string }): Record<string, string> {
  const disposition = INLINE_EXTENSIONS.has(extname(file.fileName).toLowerCase()) ? "inline" : "attachment";
  return {
    "Content-Type": file.mimeType,
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${disposition}; ${fileNameParameters(file.fileName)}`,
    "Cache-Control": "private, max-age=31536000, immutable",
  };
}

// RFC 6266: an ASCII fallback for old clients, then the exact name as UTF-8 (RFC 5987).
function fileNameParameters(fileName: string) {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test server/uploads.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add server/uploads.ts server/uploads.test.ts
git commit -F - <<'EOF'
Name stored files and build their download headers

The download route added later reads files from Postgres. These helpers keep
today's link format and inline/attachment rule, and add the original file
name so a saved download is no longer called file-1004.pdf.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Load and save the store in Postgres

**Files:**
- Create: `server/storeRepository.ts`
- Test: `server/db/storeRepository.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5 (`TABLES`, `fromRow`, `columnName`, `attachDrawingItems`, `TableChanges`, `diffStore`, `storagePath`, `emptyStore`, `defaultScoreWeights`).
- Produces, all taking `db: Pick<PoolClient, "query">`:
  - `loadStore(db): Promise<Store>` — records in creation order, `storagePath` derived, no file content.
  - `saveChanges(db, changes: TableChanges[], fileContents?: ReadonlyMap<string, Buffer>): Promise<void>` — a new `files` row takes its content from `fileContents`; missing content throws.
  - `saveScoreWeights(db, weights: ScoreWeights): Promise<void>`
  - `loadCounters(db): Promise<Map<string, number>>`, `saveCounters(db, counters: Array<[string, number]>): Promise<void>`
  - `readFileContent(db, id): Promise<{ fileName: string; mimeType: string; content: Buffer } | undefined>`

- [ ] **Step 1: Write the failing tests**

Create `server/db/storeRepository.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";

import { diffStore } from "../storeDiff";
import { loadCounters, loadStore, readFileContent, saveChanges, saveCounters, saveScoreWeights } from "../storeRepository";
import { defaultScoreWeights, emptyStore, type Store } from "../storeShape";
import { sampleFileContents, sampleStore } from "../testFixtures";
import { withTestDatabase } from "../testDb";

// Writes go through a transaction, as in the app: foreign keys are checked at
// commit, and q-1001 refers to q-1002, which is inserted after it.
async function inTransaction(client: PoolClient, fn: () => Promise<void>) {
  await client.query("BEGIN");
  await fn();
  await client.query("COMMIT");
}

async function saveSample(client: PoolClient, store = sampleStore()): Promise<Store> {
  await inTransaction(client, async () => {
    await saveChanges(client, diffStore(emptyStore(), store), sampleFileContents());
    await saveScoreWeights(client, store.scoreWeights);
  });
  return store;
}

test("an empty database loads an empty store with the default weights", async () => {
  await withTestDatabase(async (client) => {
    assert.deepEqual(await loadStore(client), emptyStore());
  });
});

test("a store saved from empty loads back unchanged", async () => {
  await withTestDatabase(async (client) => {
    const store = await saveSample(client);
    assert.deepEqual(await loadStore(client), store);
  });
});

test("updates and deletes are applied", async () => {
  await withTestDatabase(async (client) => {
    await saveSample(client);
    const before = await loadStore(client);
    const after = structuredClone(before);
    after.suppliers[1].name = "UFP Renamed";
    after.priceChanges = after.priceChanges.filter((change) => change.id !== "pc-1002");
    after.drawingSets[0].drawingItems.reverse();
    after.incomingDefects[0].replacementReceipts = [];
    await inTransaction(client, () => saveChanges(client, diffStore(before, after)));
    assert.deepEqual(await loadStore(client), after);
  });
});

test("deleting a drawing set with the diff removes its items too", async () => {
  await withTestDatabase(async (client) => {
    const store = sampleStore();
    store.drawingSets[1].drawingItems.push({ id: "dwgitem-1003", itemId: "item-1002", revision: "1.0", status: "Active", drawingSource: "Package PDF" });
    await saveSample(client, store);
    const before = await loadStore(client);
    const after = structuredClone(before);
    after.drawingSets = after.drawingSets.filter((drawingSet) => drawingSet.id !== "dwgset-1002");
    await inTransaction(client, () => saveChanges(client, diffStore(before, after)));
    assert.deepEqual((await loadStore(client)).drawingSets.map((drawingSet) => drawingSet.id), ["dwgset-1001"]);
    const { rows } = await client.query("SELECT id FROM drawing_items ORDER BY id");
    assert.deepEqual(rows.map((row) => row.id), ["dwgitem-1001", "dwgitem-1002"]);
  });
});

test("records load in the order they were created", async () => {
  await withTestDatabase(async (client) => {
    const store = emptyStore();
    const model = { name: "BTA", productFamily: "Solar Module", status: "Active" as const, notes: "" };
    store.models.push({ ...model, id: "model-10000" }, { ...model, id: "model-9999" });
    await inTransaction(client, () => saveChanges(client, diffStore(emptyStore(), store)));
    assert.deepEqual((await loadStore(client)).models.map((record) => record.id), ["model-9999", "model-10000"]);
  });
});

test("counters keep the last value saved for each prefix", async () => {
  await withTestDatabase(async (client) => {
    await saveCounters(client, [["sup", 1004], ["q", 1010]]);
    await saveCounters(client, [["sup", 1005]]);
    assert.deepEqual(await loadCounters(client), new Map([["sup", 1005], ["q", 1010]]));
  });
});

test("score weights are saved, and a missing row loads as the defaults", async () => {
  await withTestDatabase(async (client) => {
    await client.query("DELETE FROM score_weights");
    assert.deepEqual((await loadStore(client)).scoreWeights, defaultScoreWeights());
    const weights = { ...defaultScoreWeights(), pricing: 30, setup: 0 };
    await saveScoreWeights(client, weights);
    await saveScoreWeights(client, weights);
    assert.deepEqual((await loadStore(client)).scoreWeights, weights);
  });
});

test("file content is stored with the file and read on its own", async () => {
  await withTestDatabase(async (client) => {
    await saveSample(client);
    assert.deepEqual(await readFileContent(client, "file-1001"), {
      fileName: "W9 2026.pdf",
      mimeType: "application/pdf",
      content: Buffer.from("pdf"),
    });
    assert.equal(await readFileContent(client, "file-9999"), undefined);
  });
});

test("a new file without content is refused", async () => {
  await withTestDatabase(async (client) => {
    const store = emptyStore();
    store.files.push(sampleStore().files[0]);
    await assert.rejects(saveChanges(client, diffStore(emptyStore(), store)), /No content for new file file-1001/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --env-file-if-exists=.env --test --test-concurrency=1 server/db/storeRepository.test.ts`
Expected: FAIL — `Cannot find module '../storeRepository'`.

- [ ] **Step 3: Implement the repository**

Create `server/storeRepository.ts`:

```ts
import type { PoolClient } from "pg";

import "./pgTypes";
import type {
  DrawingSet,
  IncomingDefectRecord,
  Model,
  PackagingItem,
  PriceChange,
  PurchasePriceRecord,
  Quote,
  QuoteCaseLink,
  SampleInspection,
  ScoreWeights,
  SourceAssignment,
  SourcingProject,
  Supplier,
  UploadedFileRecord,
} from "../src/types";
import type { TableChanges } from "./storeDiff";
import { defaultScoreWeights, type Store } from "./storeShape";
import { TABLES, attachDrawingItems, columnName, fromRow, type Row, type StoredDrawingItem, type TableDef } from "./storeTables";
import { storagePath } from "./uploads";

type Executor = Pick<PoolClient, "query">;

const WEIGHT_FIELDS = ["sampleQuality", "incomingQuality", "pricing", "responsiveness", "scopeFit", "setup"] as const;

// IDs within a table share a prefix, so shorter IDs are older: sup-9999 before sup-10000.
async function selectAll<T>(db: Executor, def: TableDef, orderBy = "length(id), id"): Promise<T[]> {
  const { rows } = await db.query(`SELECT ${def.fields.map(columnName).join(", ")} FROM ${def.table} ORDER BY ${orderBy}`);
  return rows.map((row) => fromRow(def, row)) as unknown as T[];
}

/** Every business record, in the order it was created. File contents are left out. */
export async function loadStore(db: Executor): Promise<Store> {
  const files = await selectAll<Omit<UploadedFileRecord, "storagePath">>(db, TABLES.files);
  const drawingSets = attachDrawingItems(
    await selectAll<Omit<DrawingSet, "drawingItems">>(db, TABLES.drawingSets),
    await selectAll<StoredDrawingItem>(db, TABLES.drawingItems, "drawing_set_id, position"),
  );
  const { rows: [weights] } = await db.query(`SELECT ${WEIGHT_FIELDS.map(columnName).join(", ")} FROM score_weights WHERE id = 1`);
  return {
    suppliers: await selectAll<Supplier>(db, TABLES.suppliers),
    models: await selectAll<Model>(db, TABLES.models),
    items: await selectAll<PackagingItem>(db, TABLES.items),
    drawingSets,
    projects: await selectAll<SourcingProject>(db, TABLES.projects),
    quotes: await selectAll<Quote>(db, TABLES.quotes),
    quoteCaseLinks: await selectAll<QuoteCaseLink>(db, TABLES.quoteCaseLinks),
    sourceAssignments: await selectAll<SourceAssignment>(db, TABLES.sourceAssignments),
    inspections: await selectAll<SampleInspection>(db, TABLES.inspections),
    incomingDefects: await selectAll<IncomingDefectRecord>(db, TABLES.incomingDefects),
    priceChanges: await selectAll<PriceChange>(db, TABLES.priceChanges),
    purchasePrices: await selectAll<PurchasePriceRecord>(db, TABLES.purchasePrices),
    files: files.map((file) => ({ ...file, storagePath: storagePath(file.id, file.fileName) })),
    scoreWeights: weights
      ? (Object.fromEntries(WEIGHT_FIELDS.map((field) => [field, weights[columnName(field)]])) as unknown as ScoreWeights)
      : defaultScoreWeights(),
  };
}

function parameters(def: TableDef, row: Row): unknown[] {
  return row.map((value, index) => (value !== null && def.json?.includes(def.fields[index]) ? JSON.stringify(value) : value));
}

/** Writes one request's changes. A new file row takes its content from `fileContents`. */
export async function saveChanges(db: Executor, changes: TableChanges[], fileContents: ReadonlyMap<string, Buffer> = new Map()): Promise<void> {
  for (const { def, inserts, updates, deletes } of changes) {
    if (deletes.length > 0) await db.query(`DELETE FROM ${def.table} WHERE id = ANY($1)`, [deletes]);
    for (const row of inserts) {
      const columns = def.fields.map(columnName);
      const values = parameters(def, row);
      if (def.table === "files") {
        const content = fileContents.get(row[0] as string);
        if (!content) throw new Error(`No content for new file ${row[0]}`);
        columns.push("content");
        values.push(content);
      }
      const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
      await db.query(`INSERT INTO ${def.table} (${columns.join(", ")}) VALUES (${placeholders})`, values);
    }
    for (const row of updates) {
      const assignments = def.fields.slice(1).map((field, index) => `${columnName(field)} = $${index + 2}`).join(", ");
      await db.query(`UPDATE ${def.table} SET ${assignments} WHERE id = $1`, parameters(def, row));
    }
  }
}

export async function saveScoreWeights(db: Executor, weights: ScoreWeights): Promise<void> {
  const columns = WEIGHT_FIELDS.map(columnName);
  await db.query(
    `INSERT INTO score_weights (id, ${columns.join(", ")}) VALUES (1, ${columns.map((_, index) => `$${index + 1}`).join(", ")})
     ON CONFLICT (id) DO UPDATE SET ${columns.map((column) => `${column} = EXCLUDED.${column}`).join(", ")}`,
    WEIGHT_FIELDS.map((field) => weights[field]),
  );
}

export async function loadCounters(db: Executor): Promise<Map<string, number>> {
  const { rows } = await db.query("SELECT prefix, value FROM id_counters");
  return new Map(rows.map((row) => [row.prefix as string, row.value as number]));
}

export async function saveCounters(db: Executor, counters: Array<[string, number]>): Promise<void> {
  for (const [prefix, value] of counters) {
    await db.query(
      "INSERT INTO id_counters (prefix, value) VALUES ($1, $2) ON CONFLICT (prefix) DO UPDATE SET value = EXCLUDED.value",
      [prefix, value],
    );
  }
}

export async function readFileContent(db: Executor, id: string): Promise<{ fileName: string; mimeType: string; content: Buffer } | undefined> {
  const { rows: [row] } = await db.query("SELECT file_name, mime_type, content FROM files WHERE id = $1", [id]);
  return row ? { fileName: row.file_name as string, mimeType: row.mime_type as string, content: row.content as Buffer } : undefined;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --env-file-if-exists=.env --test --test-concurrency=1 server/db/storeRepository.test.ts`
Expected: PASS, 9 tests. If "a store saved from empty loads back unchanged" fails, the assertion diff names the field: a mismatch there is a mapping bug in `TABLES` or a column type in the migration, not a test to relax.

- [ ] **Step 5: Run the offline suite and the server type check**

Run: `npm test && npm run typecheck:api`
Expected: all pass, exit 0.

- [ ] **Step 6: Commit**

```bash
git add server/storeRepository.ts server/db/storeRepository.test.ts
git commit -F - <<'EOF'
Load and save the business store in Postgres

The repository loads every business table into the store shape, in creation
order and without file contents, and applies a diff's inserts, updates and
deletes. Counters and score weights are stored alongside.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Pass the store to business rules through a request context

A behaviour-preserving refactor. The store is still the in-memory JSON store; what changes is that business functions receive it (or a context wrapping it) as a parameter, and the helpers that the sync passes need move out of `createApp`. Task 8 then swaps what backs the context.

**Files:**
- Create: `server/errors.ts`, `server/lookups.ts`, `server/auditEntry.ts`, `server/context.ts`, `server/workflow.ts`
- Modify: `server/business.ts`, `server/store.ts`, `server/app.ts`
- Test: `server/auditEntry.test.ts`, `server/context.test.ts`, `server/workflow.test.ts`

**Interfaces:**
- Consumes: `Store` (Task 3), `sampleStore` (Task 3), `priceWindowError` (existing).
- Produces:
  - `errors.ts`: `class ValidationError extends Error { status = 400 }`.
  - `lookups.ts`: `findSupplier(store, id)`, `findModel(store, id)`, `findItem(store, id)`, `findDrawingSet(store, id)`, `findDrawingItem(store, drawingSetId, drawingItemId)`, `findProject(store, id)`, `assertReferences(ids, finder, label)`.
  - `auditEntry.ts`: `type AuditAction`, `type AuditSource`, `isPlainRecord(value)`, `buildAuditEntry(user, action, entityType, entityId, entityLabel, before?, after?, reason?, linkedRecordId?, source = "UI"): AuditEntry`.
  - `context.ts`: `interface BusinessContext { readonly store: Store; nextId(prefix): string; audit(action, entityType, entityId, entityLabel, before?, after?, reason?, linkedRecordId?, source?): void; addFileContent(fileId, content: Buffer): void }`; `interface RequestContext extends BusinessContext { readonly auditEntries: AuditEntry[]; readonly fileContents: Map<string, Buffer>; changedCounters(): Array<[string, number]> }`; `createContext(store, counters: Map<string, number>, user: User | undefined, onAudit?: (entry: AuditEntry) => void): RequestContext`. `onAudit` exists only for this task's in-memory mode; Task 8 removes it.
  - `workflow.ts`: `cloneRecord`, `editAction`, `entityLabel(store, entityType, record)`, `checkPriceWindow(store, quote, before?, changeReason?)`, `nextDrawingSetRevision(store, modelId)`, `syncActivePackagingSetItems(ctx, modelIds, reason)`, `syncActiveCasesForModels(ctx, modelIds, reason)`, `syncQuoteStatusesFromPassedInspections(ctx)`, `syncQuoteStatusFromInspection(ctx, inspection)`, `ensureSourceAssignmentLinks(store, record)`, `demoteConflictingSourceRoles(ctx, current)`, `ensureUniqueItemCode(store, itemCode, currentItemId?)`, `ensureNoSupplierLinks(store, id)`, `ensureNoModelLinks(store, id)`, `ensureNoItemLinks(store, id)`, `ensureNoDrawingSetLinks(store, id)`, `ensureNoProjectLinks(store, id)`, `ensureNoQuoteLinks(store, id)`.
  - `business.ts`: new signatures in the table in Step 6.

- [ ] **Step 1: Write the failing tests**

Create `server/auditEntry.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAuditEntry } from "./auditEntry";
import type { User } from "./users";

const user = { id: 7, name: "Ann Lee", email: "ann@segsolar.com", role: "user", active: true } as User;

test("an edit records only the fields that changed, never the id", () => {
  const entry = buildAuditEntry(user, "Edit", "Supplier", "sup-1001", "Legacy Paper", { id: "sup-1001", name: "Old", phone: "1" }, { id: "sup-1001", name: "New", phone: "1" });
  assert.deepEqual([entry.before, entry.after], [{ name: "Old" }, { name: "New" }]);
  assert.deepEqual([entry.actorUserId, entry.actorLabel, entry.source], [7, "Ann Lee", "UI"]);
});

test("a system change stays anonymous even when a user's request caused it", () => {
  const entry = buildAuditEntry(user, "Edit", "Case", "proj-1001", "BTA 2026", undefined, { name: "BTA 2026" }, "Auto sync", "proj-1001", "System");
  assert.deepEqual([entry.actorUserId, entry.actorLabel], [null, "System"]);
  assert.equal(entry.linkedRecordId, "proj-1001");
});

test("long lists are shortened and a blank reason is dropped", () => {
  const ids = Array.from({ length: 10 }, (_, index) => `item-${index}`);
  const entry = buildAuditEntry(user, "Create", "Case", "proj-1001", "BTA 2026", undefined, { itemIds: ids }, "  ");
  assert.deepEqual((entry.after as { itemIds: string[] }).itemIds, [...ids.slice(0, 8), "+2 more"]);
  assert.equal(entry.reason, undefined);
});
```

Create `server/context.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { createContext } from "./context";
import { emptyStore } from "./storeShape";

test("nextId continues from the stored counter, and a new prefix starts after 1000", () => {
  const ctx = createContext(emptyStore(), new Map([["sup", 1004]]), undefined);
  assert.equal(ctx.nextId("sup"), "sup-1005");
  assert.equal(ctx.nextId("sup"), "sup-1006");
  assert.equal(ctx.nextId("q"), "q-1001");
  assert.deepEqual(ctx.changedCounters(), [["sup", 1006], ["q", 1001]]);
});

test("an untouched counter is not reported as changed", () => {
  assert.deepEqual(createContext(emptyStore(), new Map([["sup", 1004]]), undefined).changedCounters(), []);
});

test("audit entries are collected, or handed over as they happen when asked", () => {
  const ctx = createContext(emptyStore(), new Map(), undefined);
  ctx.audit("Create", "Model", "model-1001", "BTA");
  assert.equal(ctx.auditEntries.length, 1);

  const handedOver: string[] = [];
  const immediate = createContext(emptyStore(), new Map(), undefined, (entry) => handedOver.push(entry.entityId));
  immediate.audit("Create", "Model", "model-1002", "BTC");
  assert.deepEqual([handedOver, immediate.auditEntries.length], [["model-1002"], 0]);
});

test("file contents are kept for the save", () => {
  const ctx = createContext(emptyStore(), new Map(), undefined);
  ctx.addFileContent("file-1001", Buffer.from("pdf"));
  assert.deepEqual(ctx.fileContents.get("file-1001"), Buffer.from("pdf"));
});
```

Create `server/workflow.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { createContext } from "./context";
import { ValidationError } from "./errors";
import { sampleStore } from "./testFixtures";
import { demoteConflictingSourceRoles, ensureNoSupplierLinks, entityLabel, syncQuoteStatusFromInspection } from "./workflow";

test("a passed inspection selects its quote and records a system change", () => {
  const store = sampleStore();
  store.quotes[0].status = "Received";
  const ctx = createContext(store, new Map(), undefined);
  assert.equal(syncQuoteStatusFromInspection(ctx, store.inspections[0]), true);
  assert.equal(store.quotes[0].status, "Selected");
  const entry = ctx.auditEntries.find((candidate) => candidate.entityType === "Quote");
  assert.deepEqual([entry?.entityLabel, entry?.source, entry?.actorUserId], ["Legacy Paper / PAL-01", "System", null]);
});

test("a new Primary source demotes the existing Primary to Backup", () => {
  const store = sampleStore();
  const current = { ...store.sourceAssignments[0], id: "assign-1002", supplierId: "sup-1002" };
  store.sourceAssignments.push(current);
  const ctx = createContext(store, new Map(), undefined);
  demoteConflictingSourceRoles(ctx, current);
  assert.deepEqual(store.sourceAssignments.map((assignment) => assignment.role), ["Backup", "Primary"]);
  assert.equal(ctx.auditEntries[0].reason, "Demoted because another supplier was set as Primary");
});

test("a supplier with linked records cannot be deleted", () => {
  assert.throws(() => ensureNoSupplierLinks(sampleStore(), "sup-1001"), (error: Error) => error instanceof ValidationError && /quotes/.test(error.message));
});

test("labels name the supplier and item behind a record", () => {
  const store = sampleStore();
  assert.equal(entityLabel(store, "Inspection", store.inspections[0]), "Legacy Paper / PAL-01 / Round 2");
  assert.equal(entityLabel(store, "Quote", { supplierId: "sup-9999", itemId: "item-1001" }), "Unknown supplier / PAL-01");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test server/auditEntry.test.ts server/context.test.ts server/workflow.test.ts`
Expected: FAIL — `Cannot find module './auditEntry'` (and `./context`, `./workflow`).

- [ ] **Step 3: Create `errors.ts` and `lookups.ts`**

Create `server/errors.ts`:

```ts
/** A request that breaks a business rule. The error handler reports it as 400 with this message. */
export class ValidationError extends Error {
  status = 400;
}
```

Create `server/lookups.ts`:

```ts
import { ValidationError } from "./errors";
import type { Store } from "./storeShape";

export function findSupplier(store: Store, id: string) {
  return store.suppliers.find((supplier) => supplier.id === id);
}

export function findModel(store: Store, id: string) {
  return store.models.find((model) => model.id === id);
}

export function findItem(store: Store, id: string) {
  return store.items.find((item) => item.id === id);
}

export function findDrawingSet(store: Store, id: string) {
  return store.drawingSets.find((drawingSet) => drawingSet.id === id);
}

export function findDrawingItem(store: Store, drawingSetId: string, drawingItemId: string) {
  return findDrawingSet(store, drawingSetId)?.drawingItems.find((drawingItem) => drawingItem.id === drawingItemId);
}

export function findProject(store: Store, id: string) {
  return store.projects.find((project) => project.id === id);
}

export function assertReferences(ids: string[], finder: (id: string) => unknown, label: string) {
  const missing = ids.filter((id) => !finder(id));
  if (missing.length > 0) {
    throw new ValidationError(`${label} not found: ${missing.join(", ")}`);
  }
}
```

In `server/store.ts`, delete `findSupplier`, `findModel`, `findItem`, `findDrawingSet`, `findDrawingItem`, `findProject`, `assertReferences` and `class ValidationError` (everything after `nextId`), and change `const counters = new Map<string, number>();` to `export const counters = new Map<string, number>();`.

- [ ] **Step 4: Create `auditEntry.ts`**

The body of `buildAuditEntry` and its three helpers are moved from the `audit`, `compactDiff`, `summarizeRecord` and `isPlainRecord` functions in `createApp`, unchanged except that the actor comes from a `user` parameter.

Create `server/auditEntry.ts`:

```ts
import type { AuditEntry } from "./auditLog";
import type { User } from "./users";

export type AuditAction = "Create" | "Edit" | "Status Change" | "Upload" | "Void" | "Delete" | "Approve" | "Import";
export type AuditSource = "UI" | "Import" | "System";

/**
 * The audit trail entry for one change: who made it and the fields that
 * changed. A System change stays anonymous even when a signed-in user's
 * request triggered it.
 */
export function buildAuditEntry(
  user: User | undefined,
  action: AuditAction,
  entityType: string,
  entityId: string,
  entityLabel: string,
  before?: unknown,
  after?: unknown,
  reason?: string,
  linkedRecordId?: string,
  source: AuditSource = "UI",
): AuditEntry {
  const diff = compactDiff(before, after);
  const actor = source === "System" ? undefined : user;
  return {
    timestamp: new Date().toISOString(),
    actorUserId: actor?.id ?? null,
    actorLabel: actor?.name ?? "System",
    action,
    entityType,
    entityId,
    entityLabel,
    before: diff.before,
    after: diff.after,
    reason: String(reason ?? "").trim() || undefined,
    source,
    linkedRecordId,
  };
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compactDiff(before: unknown, after: unknown) {
  const beforeRecord = isPlainRecord(before) ? before : undefined;
  const afterRecord = isPlainRecord(after) ? after : undefined;
  if (!beforeRecord && !afterRecord) return {};
  if (!beforeRecord) return { after: summarizeRecord(afterRecord) };
  if (!afterRecord) return { before: summarizeRecord(beforeRecord) };

  const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
  const beforeDiff: Record<string, unknown> = {};
  const afterDiff: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === "id") continue;
    const beforeValue = beforeRecord[key];
    const afterValue = afterRecord[key];
    if (JSON.stringify(beforeValue) === JSON.stringify(afterValue)) continue;
    beforeDiff[key] = beforeValue;
    afterDiff[key] = afterValue;
  }
  return {
    before: Object.keys(beforeDiff).length > 0 ? summarizeRecord(beforeDiff) : undefined,
    after: Object.keys(afterDiff).length > 0 ? summarizeRecord(afterDiff) : undefined,
  };
}

function summarizeRecord(record: Record<string, unknown> | undefined) {
  if (!record) return undefined;
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      summary[key] = value.length > 8 ? [...value.slice(0, 8), `+${value.length - 8} more`] : value;
    } else if (isPlainRecord(value)) {
      summary[key] = "[object]";
    } else {
      summary[key] = value;
    }
  }
  return summary;
}
```

- [ ] **Step 5: Create `context.ts`**

Create `server/context.ts`:

```ts
import { buildAuditEntry, type AuditAction, type AuditSource } from "./auditEntry";
import type { AuditEntry } from "./auditLog";
import type { Store } from "./storeShape";
import type { User } from "./users";

/** What business rules work through during one request. */
export interface BusinessContext {
  readonly store: Store;
  nextId(prefix: string): string;
  audit(
    action: AuditAction,
    entityType: string,
    entityId: string,
    entityLabel: string,
    before?: unknown,
    after?: unknown,
    reason?: string,
    linkedRecordId?: string,
    source?: AuditSource,
  ): void;
  addFileContent(fileId: string, content: Buffer): void;
}

/** A context plus what the request must save when it finishes. */
export interface RequestContext extends BusinessContext {
  readonly auditEntries: AuditEntry[];
  readonly fileContents: Map<string, Buffer>;
  changedCounters(): Array<[string, number]>;
}

export function createContext(
  store: Store,
  counters: Map<string, number>,
  user: User | undefined,
  onAudit?: (entry: AuditEntry) => void,
): RequestContext {
  const initialCounters = new Map(counters);
  const auditEntries: AuditEntry[] = [];
  const fileContents = new Map<string, Buffer>();
  return {
    store,
    auditEntries,
    fileContents,
    nextId(prefix) {
      const next = (counters.get(prefix) ?? 1000) + 1;
      counters.set(prefix, next);
      return `${prefix}-${next}`;
    },
    audit(action, entityType, entityId, entityLabel, before, after, reason, linkedRecordId, source) {
      const entry = buildAuditEntry(user, action, entityType, entityId, entityLabel, before, after, reason, linkedRecordId, source);
      if (onAudit) onAudit(entry);
      else auditEntries.push(entry);
    },
    addFileContent(fileId, content) {
      fileContents.set(fileId, content);
    },
    changedCounters() {
      return [...counters].filter(([prefix, value]) => initialCounters.get(prefix) !== value);
    },
  };
}
```

- [ ] **Step 6: Give business functions the store or context as a parameter**

Edit `server/business.ts`:

1. Replace the import from `./store` with:

```ts
import type { BusinessContext } from "./context";
import { ValidationError } from "./errors";
import { assertReferences, findDrawingItem, findDrawingSet, findItem, findModel, findProject, findSupplier } from "./lookups";
import type { Store } from "./storeShape";
```

2. Change each function's first parameter as listed. Functions taking `store: Store` keep their bodies, since `store` is now the parameter. Functions taking `ctx: BusinessContext` get `const { store } = ctx;` as their first line wherever the body uses `store`.

| Function | New parameters |
| --- | --- |
| `validateProjectLinks` | `(store: Store, project: {...})` |
| `validateDrawingSetLinks` | `(store: Store, drawingSet: {...})` |
| `validateQuoteLinks` | `(store: Store, quote: Omit<Quote, "id">)` |
| `syncCaseFromQuote` | `(ctx: BusinessContext, quote: Quote)` |
| `syncReusableQuotesForProjects` | `(ctx: BusinessContext, projects = ctx.store.projects)` |
| `syncReusableQuotesForProject` | `(ctx: BusinessContext, project: SourcingProject)` |
| `upsertQuoteCaseLink` | `(ctx: BusinessContext, quote: Quote, project: SourcingProject, linkType: ...)` |
| `sampleRequirementForQuoteInProject` | `(store: Store, quote: Quote, project: SourcingProject)` |
| `validateInspectionLinks` | `(store: Store, inspection: Omit<SampleInspection, "id">)` |
| `validateIncomingDefectLinks` | `(store: Store, record: {...})` |
| `validateQuoteLikeLinks` | `(store: Store, record: {...})` |
| `validatePriceChangeLinks` | `(store: Store, record: {...})` |
| `validatePurchasePriceLinks` | `(store: Store, record: {...})` |
| `buildComparison` | `(ctx: BusinessContext, projectId: string)` |
| `buildPriceChangeFromQuote` | `(ctx: BusinessContext, quote: Quote)` |
| `reconcileQuotePriceChanges` | `(ctx: BusinessContext)` |
| `assignPreviousQuote` | `(store: Store, quote: Quote)` |
| `closePreviousSelectedQuote` | `(store: Store, quote: Quote)` |
| `buildPriceChangeFromPurchase` | `(ctx: BusinessContext, purchase: PurchasePriceRecord)` |
| `buildSupplierScorecard` | `(store: Store, supplierId: string)` |
| `buildScorecard` | `(store: Store)` |
| `scorePricingCompetitiveness` | `(store: Store, supplierQuotes: Quote[], max: number, paymentTerms = "")` |
| `quotePriceCompetitiveness` | `(store: Store, quote: Quote)` |
| `pricingDetail` | `(store: Store, supplierQuotes: Quote[], paymentTerms = "")` |

`quoteIsEffectiveForProject`, `assertNotVoided`, `ensureActiveDrawingSet`, `normalizeIncomingDefectCompletion`, `isSampleRequestedQuote`, `isSelectedQuote`, `dayBefore`, `clamp`, `isWithinRecentDays` and `recommendSupplier` are unchanged.

3. Update the calls inside the file:
   - every `findSupplier(x)`, `findModel(x)`, `findItem(x)`, `findDrawingSet(x)`, `findProject(x)` call becomes `findX(store, x)`, and `findDrawingItem(a, b)` becomes `findDrawingItem(store, a, b)`;
   - the four `assertReferences` calls pass a lambda: `assertReferences(project.modelIds, (id) => findModel(store, id), "Model")`, and likewise for suppliers, items and drawing items;
   - `nextId(` becomes `ctx.nextId(`;
   - calls between these functions pass the new first argument: `syncReusableQuotesForProjects(ctx)`, `syncReusableQuotesForProject(ctx, project)`, `upsertQuoteCaseLink(ctx, …)`, `sampleRequirementForQuoteInProject(store, …)`, `validateQuoteLikeLinks(store, …)`, `assignPreviousQuote(store, quote)`, `buildPriceChangeFromQuote(ctx, quote)`, `closePreviousSelectedQuote(store, quote)`, `buildSupplierScorecard(store, supplier.id)`, `scorePricingCompetitiveness(store, …)`, `pricingDetail(store, …)`, and `quotePriceCompetitiveness(store, quote)` (including inside the two `.map` / `.reduce` callbacks).

Run: `npx tsc -p tsconfig.server.json --noEmit 2>&1 | grep "server/business.ts"`
Expected: no output. Errors in `server/app.ts` are expected until Step 8.

- [ ] **Step 7: Create `workflow.ts`**

These are the helpers from `createApp` that the sync passes and routes share, moved unchanged apart from taking `store` or `ctx`: `audit(request, …)` becomes `ctx.audit(…)`, `nextId(` becomes `ctx.nextId(`, and business calls use the Step 6 signatures.

Create `server/workflow.ts`:

```ts
import type { Quote } from "../src/types";
import { isPlainRecord, type AuditAction } from "./auditEntry";
import {
  assignPreviousQuote,
  buildPriceChangeFromQuote,
  closePreviousSelectedQuote,
  syncCaseFromQuote,
  syncReusableQuotesForProject,
  syncReusableQuotesForProjects,
  validateDrawingSetLinks,
} from "./business";
import type { BusinessContext } from "./context";
import { ValidationError } from "./errors";
import { priceWindowError } from "./priceWindows";
import { latestInspection, qcAllowsSourceRole } from "./rules";
import type { Store } from "./storeShape";

export function cloneRecord<T>(record: T | undefined): T | undefined {
  return record ? structuredClone(record) : undefined;
}

export function editAction(before: unknown, after: unknown): AuditAction {
  const beforeRecord = isPlainRecord(before) ? before : undefined;
  const afterRecord = isPlainRecord(after) ? after : {};
  if (beforeRecord?.status !== afterRecord.status && afterRecord.status) return "Status Change";
  if (beforeRecord?.result !== afterRecord.result && afterRecord.result) return "Status Change";
  if (beforeRecord?.recordState === "Draft" && afterRecord.recordState === "Active") return "Approve";
  return "Edit";
}

export function entityLabel(store: Store, entityType: string, record: unknown) {
  const recordValue = isPlainRecord(record) ? record : {};
  if (entityType === "Supplier") return String(recordValue.name ?? recordValue.id);
  if (entityType === "Model") return String(recordValue.name ?? recordValue.id);
  if (entityType === "Item") return String(recordValue.itemCode ?? recordValue.id);
  if (entityType === "DrawingSet") return String(recordValue.name ?? recordValue.id);
  if (entityType === "Case") return String(recordValue.name ?? recordValue.id);
  if (entityType === "Quote") return `${findSupplierName(store, recordValue.supplierId)} / ${findItemCode(store, recordValue.itemId)}`;
  if (entityType === "Inspection") {
    return `${findSupplierName(store, recordValue.supplierId)} / ${findItemCode(store, recordValue.itemId)} / Round ${recordValue.sampleRound ?? 1}`;
  }
  if (entityType === "IncomingDefect") {
    return `${findSupplierName(store, recordValue.supplierId)} / ${findItemCode(store, recordValue.itemId)} / ${recordValue.defectDate}`;
  }
  if (entityType === "PriceChange") return `${findSupplierName(store, recordValue.supplierId)} / ${findItemCode(store, recordValue.itemId)} price change`;
  if (entityType === "SourceAssignment") {
    return `${findSupplierName(store, recordValue.supplierId)} / ${findItemCode(store, recordValue.itemId)} / ${recordValue.role ?? "source role"}`;
  }
  return String(recordValue.id ?? entityType);
}

function findSupplierName(store: Store, id: unknown) {
  return store.suppliers.find((supplier) => supplier.id === id)?.name ?? "Unknown supplier";
}

function findItemCode(store: Store, id: unknown) {
  return store.items.find((item) => item.id === id)?.itemCode ?? "Unknown item";
}

export function checkPriceWindow(store: Store, quote: Quote, before?: Quote, changeReason?: string) {
  const error = priceWindowError(quote, store.quotes, {
    before,
    changeReason,
    describe: (conflict) => `the ${conflict.currency} ${conflict.unitPrice} quote ${conflict.id}`,
  });
  if (error) throw new ValidationError(error);
}

export function nextDrawingSetRevision(store: Store, modelId: string) {
  const existingCount = store.drawingSets.filter(
    (drawingSet) => drawingSet.modelId === modelId && drawingSet.recordState !== "Void",
  ).length;
  return `${existingCount + 1}.0`;
}

export function syncActivePackagingSetItems(ctx: BusinessContext, modelIds: string[], reason: string) {
  const { store } = ctx;
  const targetModelIds = new Set(modelIds.filter(Boolean));
  if (targetModelIds.size === 0) return false;
  let changed = false;

  for (const drawingSet of store.drawingSets) {
    if (drawingSet.recordState === "Void" || drawingSet.status !== "Active" || !targetModelIds.has(drawingSet.modelId)) continue;
    const modelItems = store.items
      .filter((item) => item.recordState !== "Void" && item.status === "Active" && item.usedForModels.includes(drawingSet.modelId))
      .sort((a, b) => a.itemCode.localeCompare(b.itemCode));
    const nextItemIds = modelItems.map((item) => item.id);
    const currentItemIds = drawingSet.drawingItems.map((drawingItem) => drawingItem.itemId);
    if (JSON.stringify(currentItemIds) === JSON.stringify(nextItemIds)) continue;

    const before = cloneRecord(drawingSet);
    drawingSet.drawingItems = modelItems.map((item) => {
      const existing = drawingSet.drawingItems.find((drawingItem) => drawingItem.itemId === item.id);
      return {
        id: existing?.id ?? ctx.nextId("dwgitem"),
        itemId: item.id,
        revision: drawingSet.revision,
        status: "Active",
        drawingSource: "Package PDF",
        fileName: undefined,
        fileId: undefined,
      };
    });
    validateDrawingSetLinks(store, drawingSet);
    ctx.audit(
      "Edit",
      "DrawingSet",
      drawingSet.id,
      drawingSet.name,
      before,
      drawingSet,
      `${reason}: synced package coverage to active items for ${entityLabel(store, "Model", store.models.find((model) => model.id === drawingSet.modelId))}`,
      undefined,
      "System",
    );
    changed = true;
  }

  return changed;
}

export function syncActiveCasesForModels(ctx: BusinessContext, modelIds: string[], reason: string) {
  const { store } = ctx;
  const targetModelIds = new Set(modelIds.filter(Boolean));
  if (targetModelIds.size === 0) return false;
  let changed = false;

  for (const project of store.projects) {
    if (project.recordState === "Void" || project.status === "Closed") continue;
    if (!project.modelIds.some((modelId) => targetModelIds.has(modelId))) continue;
    const drawingSet = store.drawingSets.find(
      (candidate) =>
        candidate.id === project.drawingSetId &&
        candidate.recordState !== "Void" &&
        candidate.status === "Active",
    );
    if (!drawingSet) continue;
    const activeDrawingItemIds = drawingSet.drawingItems
      .filter((drawingItem) => drawingItem.status === "Active")
      .map((drawingItem) => drawingItem.itemId)
      .filter((itemId) => {
        const item = store.items.find((candidate) => candidate.id === itemId);
        return item?.recordState !== "Void" && item?.status === "Active";
      });
    const missingItemIds = activeDrawingItemIds.filter((itemId) => !project.itemIds.includes(itemId));
    if (missingItemIds.length === 0) {
      syncReusableQuotesForProject(ctx, project);
      continue;
    }

    const before = cloneRecord(project);
    project.itemIds = Array.from(new Set([...project.itemIds, ...missingItemIds]));
    syncReusableQuotesForProject(ctx, project);
    ctx.audit("Edit", "Case", project.id, project.name, before, project, `${reason}: synced case items from active packaging set`, project.id, "System");
    changed = true;
  }

  return changed;
}

export function syncQuoteStatusesFromPassedInspections(ctx: BusinessContext) {
  let changed = false;
  for (const inspection of ctx.store.inspections) {
    if (inspection.recordState !== "Void") changed = syncQuoteStatusFromInspection(ctx, inspection) || changed;
  }
  return changed;
}

export function syncQuoteStatusFromInspection(ctx: BusinessContext, inspection: { relatedQuoteId?: string; result: string }) {
  const { store } = ctx;
  if (!inspection.relatedQuoteId || inspection.result !== "Pass") return false;
  const quote = store.quotes.find((candidate) => candidate.id === inspection.relatedQuoteId && candidate.recordState !== "Void");
  if (!quote || quote.status === "Selected") return false;
  const before = cloneRecord(quote);
  quote.status = "Selected";
  assignPreviousQuote(store, quote);
  buildPriceChangeFromQuote(ctx, quote);
  closePreviousSelectedQuote(store, quote);
  syncCaseFromQuote(ctx, quote);
  syncReusableQuotesForProjects(ctx);
  ctx.audit(
    "Status Change",
    "Quote",
    quote.id,
    entityLabel(store, "Quote", quote),
    before,
    quote,
    "Sample inspection passed; quote selected automatically.",
    quote.projectId,
    "System",
  );
  return true;
}

export function ensureSourceAssignmentLinks(store: Store, record: {
  projectId?: string;
  modelId: string;
  itemId: string;
  supplierId: string;
  sourceQuoteId?: string;
}) {
  const supplier = store.suppliers.find((candidate) => candidate.id === record.supplierId && candidate.recordState !== "Void");
  if (!supplier) {
    throw new ValidationError(`Supplier not found: ${record.supplierId}`);
  }
  if (!store.models.some((model) => model.id === record.modelId && model.recordState !== "Void")) {
    throw new ValidationError(`Model not found: ${record.modelId}`);
  }
  const item = store.items.find((candidate) => candidate.id === record.itemId && candidate.recordState !== "Void");
  if (!item) {
    throw new ValidationError(`Item not found: ${record.itemId}`);
  }
  if (!item.usedForModels.includes(record.modelId)) {
    throw new ValidationError("Item is not linked to the selected model.");
  }
  if (!supplier.capableItems.includes(item.type)) {
    throw new ValidationError("Supplier is not capable for the selected item type.");
  }
  if (record.projectId && !store.projects.some((project) => project.id === record.projectId && project.recordState !== "Void")) {
    throw new ValidationError(`Case not found: ${record.projectId}`);
  }
  if (record.sourceQuoteId) {
    const quote = store.quotes.find((candidate) => candidate.id === record.sourceQuoteId && candidate.recordState !== "Void");
    if (!quote) throw new ValidationError(`Quote not found: ${record.sourceQuoteId}`);
    if (quote.supplierId !== record.supplierId || quote.itemId !== record.itemId) {
      throw new ValidationError("Source quote must match assignment supplier and item.");
    }
    if (quote.modelId !== record.modelId && !store.items.find((candidate) => candidate.id === record.itemId)?.usedForModels.includes(record.modelId)) {
      throw new ValidationError("Source quote item must be valid for the assignment model.");
    }
    if (
      record.projectId &&
      quote.projectId !== record.projectId &&
      !store.quoteCaseLinks.some((link) => link.recordState !== "Void" && link.projectId === record.projectId && link.quoteId === quote.id)
    ) {
      throw new ValidationError("Source quote must be linked to the assignment case.");
    }
  }

  const project = record.projectId ? store.projects.find((candidate) => candidate.id === record.projectId) : undefined;
  const inspection = latestInspection(store.inspections, {
    supplierId: record.supplierId,
    itemId: record.itemId,
    drawingSetId: project?.drawingSetId,
    sourceQuoteId: record.sourceQuoteId,
  });
  if (!qcAllowsSourceRole(inspection)) {
    throw new ValidationError("QC must pass or be conditional before assigning source role.");
  }
}

export function demoteConflictingSourceRoles(ctx: BusinessContext, current: {
  id: string;
  projectId?: string;
  modelId: string;
  itemId: string;
  role: string;
}) {
  if (!["Primary", "Secondary", "Tertiary"].includes(current.role)) return;
  for (const assignment of ctx.store.sourceAssignments) {
    if (
      assignment.id !== current.id &&
      assignment.recordState !== "Void" &&
      (assignment.projectId ?? "") === (current.projectId ?? "") &&
      assignment.modelId === current.modelId &&
      assignment.itemId === current.itemId &&
      assignment.role === current.role
    ) {
      const before = cloneRecord(assignment);
      assignment.role = "Backup";
      ctx.audit(
        "Edit",
        "SourceAssignment",
        assignment.id,
        entityLabel(ctx.store, "SourceAssignment", assignment),
        before,
        assignment,
        `Demoted because another supplier was set as ${current.role}`,
        assignment.projectId,
        "System",
      );
    }
  }
}

export function ensureUniqueItemCode(store: Store, itemCode: string, currentItemId?: string) {
  const normalizedCode = itemCode.trim().toLowerCase();
  const duplicate = store.items.find(
    (item) =>
      item.id !== currentItemId &&
      item.recordState !== "Void" &&
      item.itemCode.trim().toLowerCase() === normalizedCode,
  );
  if (duplicate) {
    throw new ValidationError("Item Code already exists. Edit the existing item and add additional models instead of creating a duplicate.");
  }
}

function blockDelete(label: string, links: string[]) {
  const activeLinks = links.filter(Boolean);
  if (activeLinks.length > 0) {
    throw new ValidationError(`Cannot delete ${label}: linked to ${activeLinks.join(", ")}.`);
  }
}

export function ensureNoSupplierLinks(store: Store, id: string) {
  blockDelete("supplier", [
    store.projects.some((project) => project.supplierIds.includes(id)) ? "development cases" : "",
    store.quotes.some((quote) => quote.supplierId === id) ? "quotes" : "",
    store.quoteCaseLinks.some((link) => link.supplierId === id) ? "case quote links" : "",
    store.inspections.some((inspection) => inspection.supplierId === id) ? "sample inspections" : "",
    store.incomingDefects.some((defect) => defect.supplierId === id) ? "incoming defects" : "",
    store.priceChanges.some((change) => change.supplierId === id) ? "price changes" : "",
    store.purchasePrices.some((purchase) => purchase.supplierId === id) ? "purchase prices" : "",
    store.sourceAssignments.some((assignment) => assignment.supplierId === id) ? "source assignments" : "",
  ]);
}

export function ensureNoModelLinks(store: Store, id: string) {
  blockDelete("model", [
    store.items.some((item) => item.usedForModels.includes(id)) ? "items" : "",
    store.drawingSets.some((drawingSet) => drawingSet.modelId === id) ? "drawing sets" : "",
    store.projects.some((project) => project.modelIds.includes(id)) ? "development cases" : "",
    store.quotes.some((quote) => quote.modelId === id) ? "quotes" : "",
    store.quoteCaseLinks.some((link) => link.modelId === id) ? "case quote links" : "",
    store.inspections.some((inspection) => inspection.modelId === id) ? "sample inspections" : "",
    store.incomingDefects.some((defect) => defect.modelId === id) ? "incoming defects" : "",
    store.priceChanges.some((change) => change.modelId === id) ? "price changes" : "",
    store.purchasePrices.some((purchase) => purchase.modelId === id) ? "purchase prices" : "",
    store.sourceAssignments.some((assignment) => assignment.modelId === id) ? "source assignments" : "",
  ]);
}

export function ensureNoItemLinks(store: Store, id: string) {
  blockDelete("item", [
    store.drawingSets.some((drawingSet) => drawingSet.drawingItems.some((drawingItem) => drawingItem.itemId === id))
      ? "drawing sets"
      : "",
    store.projects.some((project) => project.itemIds.includes(id)) ? "development cases" : "",
    store.quotes.some((quote) => quote.itemId === id) ? "quotes" : "",
    store.quoteCaseLinks.some((link) => link.itemId === id) ? "case quote links" : "",
    store.inspections.some((inspection) => inspection.itemId === id) ? "sample inspections" : "",
    store.incomingDefects.some((defect) => defect.itemId === id) ? "incoming defects" : "",
    store.priceChanges.some((change) => change.itemId === id) ? "price changes" : "",
    store.purchasePrices.some((purchase) => purchase.itemId === id) ? "purchase prices" : "",
    store.sourceAssignments.some((assignment) => assignment.itemId === id) ? "source assignments" : "",
  ]);
}

export function ensureNoDrawingSetLinks(store: Store, id: string) {
  blockDelete("drawing set", [
    store.projects.some((project) => project.drawingSetId === id) ? "development cases" : "",
    store.quotes.some((quote) => quote.drawingSetId === id) ? "quotes" : "",
    store.inspections.some((inspection) => inspection.drawingSetId === id) ? "sample inspections" : "",
  ]);
}

export function ensureNoProjectLinks(store: Store, id: string) {
  blockDelete("case", [
    store.quotes.some((quote) => quote.projectId === id) ? "quotes" : "",
    store.quoteCaseLinks.some((link) => link.projectId === id) ? "case quote links" : "",
    store.inspections.some((inspection) => inspection.projectId === id) ? "sample inspections" : "",
    store.sourceAssignments.some((assignment) => assignment.projectId === id) ? "source assignments" : "",
  ]);
}

export function ensureNoQuoteLinks(store: Store, id: string) {
  blockDelete("quote", [
    store.quotes.some((quote) => quote.previousQuoteId === id) ? "later quotes" : "",
    store.quoteCaseLinks.some((link) => link.quoteId === id) ? "case quote links" : "",
    store.inspections.some((inspection) => inspection.relatedQuoteId === id) ? "sample inspections" : "",
    store.priceChanges.some((change) => change.sourceQuoteId === id || change.previousQuoteId === id) ? "price changes" : "",
    store.purchasePrices.some((purchase) => purchase.linkedQuoteId === id) ? "purchase prices" : "",
    store.sourceAssignments.some((assignment) => assignment.sourceQuoteId === id) ? "source assignments" : "",
  ]);
}
```

- [ ] **Step 8: Point `server/app.ts` at the moved helpers**

1. Imports: change `import { nextId, saveStore, store, ValidationError } from "./store";` to `import { counters, nextId, saveStore, store } from "./store";`; add `import { ValidationError } from "./errors";`, `import { createContext } from "./context";`, and an import of every `workflow.ts` export listed under **Interfaces**. Remove the `./rules` and `./priceWindows` imports.

2. Delete these functions from `createApp`, now in `workflow.ts` or `auditEntry.ts`: `syncQuoteStatusesFromPassedInspections`, `syncQuoteStatusFromInspection`, `type AuditAction`, `audit`, `cloneRecord`, `editAction`, `compactDiff`, `summarizeRecord`, `isPlainRecord`, `checkPriceWindow`, `entityLabel`, `findSupplierName`, `findItemCode`, `nextDrawingSetRevision`, `syncActivePackagingSetItems`, `syncActiveCasesForModels`, `ensureSourceAssignmentLinks`, `demoteConflictingSourceRoles`, `ensureUniqueItemCode`, `blockDelete` and the six `ensureNo…Links`. Keep `deleteById`, `updateById` and `voidById`.

3. Directly after `const app = express();` add:

```ts
  // Handlers work through a context over the in-memory store. Audit entries
  // are still written as they happen, fire and forget.
  const contextFor = (request: Request) =>
    createContext(store, counters, request.user, (entry) => {
      void appendAuditEntry(pool, entry).catch((error) => console.error("Failed to write audit entry:", error));
    });
```

4. In every route handler that calls `audit(`, a `workflow.ts` function or a business function that now takes a context, add `const ctx = contextFor(request);` as the first statement inside its `try` block (in `/api/bootstrap`, which has no `try`, as its first statement).

5. Update the calls in `createApp`:

| Before | After |
| --- | --- |
| `audit(request, ` | `ctx.audit(` |
| `syncActivePackagingSetItems(request, ` / `syncActiveCasesForModels(request, ` | `…(ctx, ` |
| `syncQuoteStatusFromInspection(request, ` / `syncQuoteStatusesFromPassedInspections(request)` | `…(ctx, ` / `…(ctx)` |
| `demoteConflictingSourceRoles(request, ` | `demoteConflictingSourceRoles(ctx, ` |
| `entityLabel("` | `entityLabel(store, "` |
| `ensureNoSupplierLinks(` and the other five, `ensureSourceAssignmentLinks(`, `ensureUniqueItemCode(`, `nextDrawingSetRevision(`, `checkPriceWindow(` | same name, `store, ` added as the first argument |
| `validateProjectLinks(`, `validateDrawingSetLinks(`, `validateQuoteLinks(`, `validateInspectionLinks(`, `validateIncomingDefectLinks(`, `validatePriceChangeLinks(`, `validatePurchasePriceLinks(`, `assignPreviousQuote(`, `closePreviousSelectedQuote(` | same name, `store, ` added as the first argument |
| `syncCaseFromQuote(`, `syncReusableQuotesForProject(`, `buildPriceChangeFromQuote(`, `buildPriceChangeFromPurchase(`, `buildComparison(` | same name, `ctx, ` added as the first argument |
| `syncReusableQuotesForProjects()`, `reconcileQuotePriceChanges()` | `syncReusableQuotesForProjects(ctx)`, `reconcileQuotePriceChanges(ctx)` |
| `buildScorecard()` | `buildScorecard(store)` |

`nextId(` calls in `app.ts` stay as they are: `store.ts`'s `nextId` and the context share the same `counters` map.

- [ ] **Step 9: Type-check and run every test**

Run: `npm run typecheck:api && npm test && npm run test:db`
Expected: exit 0; every test passes, including the 11 new ones in `auditEntry.test.ts`, `context.test.ts` and `workflow.test.ts`. The database suite exercises item creation and the packaging-set sync end to end (`auditActor.test.ts`).

- [ ] **Step 10: Commit**

```bash
git add server/errors.ts server/lookups.ts server/auditEntry.ts server/auditEntry.test.ts server/context.ts server/context.test.ts server/workflow.ts server/workflow.test.ts server/business.ts server/store.ts server/app.ts
git commit -F - <<'EOF'
Pass the store to business rules through a request context

Business functions and the route helpers the sync passes share now take the
store, or a context with the store, an ID source and an audit sink, instead
of reading module globals. Behaviour is unchanged; the next change swaps the
in-memory store behind the context for Postgres.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Run every business request in a Postgres transaction

This is the switch. After it, nothing reads or writes `data/store.json` or `uploads/`.

**Files:**
- Create: `server/unitOfWork.ts`, `server/db/http.ts`, `server/db/seed.ts`, `server/db/businessRoutes.test.ts`
- Modify: `server/app.ts` (replaced in full), `server/context.ts`, `server/workflow.ts`, `server/business.ts`, `server/uploads.ts`, `server/uploads.test.ts`
- Modify: `server/db/uploadRoutes.test.ts`, `server/db/scoreSettingsRoutes.test.ts`, `server/db/auditActor.test.ts`
- Delete: `server/store.ts`, `server/storeFile.ts`, `server/storeFile.test.ts`

**Interfaces:**
- Consumes: `loadStore`, `saveChanges`, `saveScoreWeights`, `loadCounters`, `saveCounters`, `readFileContent` (Task 6); `diffStore` (Task 4); `downloadHeaders`, `fileIdFromStoredName`, `storagePath` (Task 5); `createContext`, `RequestContext` and the `workflow.ts` helpers (Task 7); `mergePatch` (Task 1); `transaction`, `pool` (`server/db.ts`).
- Produces:
  - `unitOfWork.ts`: `interface HandlerResult { status: number; body: unknown }`, `ok(body)`, `created(body)`, `write(handler: (ctx: RequestContext, request: Request) => HandlerResult): RequestHandler`, `read(handler: (store: Store, request: Request) => unknown): RequestHandler`.
  - `workflow.ts` gains `deleteById(records, id, label)`, `updateById(records, id, patch, parse)`, `voidById(records, id, reason?)` (none of them save) and `reconcile(ctx)`.
  - `business.ts`: `buildComparison(store: Store, projectId: string)` — no longer syncs.
  - `context.ts`: `createContext(store, counters, user)` — the `onAudit` parameter is gone.
  - `db/http.ts`: `call(app, path, init?)`, `interface Session { cookie: string; csrfToken: string; userId: number }`, `signIn(app): Promise<Session>`, `send(app, session, method, path, body?)`, `expectJson(response, status)`.
  - `db/seed.ts`: `seedSourcingCase(app, session)` returning `{ model, item, drawingSet, supplier, project, quote }`; `snapshotTables(pool)`.

- [ ] **Step 1: Add the database test helpers**

Create `server/db/http.ts`:

```ts
import assert from "node:assert/strict";
import type { Express } from "express";

/** Sends one request to the app on a throwaway port. */
export async function call(app: Express, path: string, init?: RequestInit & { cookie?: string }) {
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      redirect: "manual",
      headers: { ...(init?.headers ?? {}), ...(init?.cookie ? { cookie: init.cookie } : {}) },
    });
  } finally {
    server.close();
  }
}

export interface Session {
  cookie: string;
  csrfToken: string;
  userId: number;
}

/** Signs in the AUTH_MODE=dev account. */
export async function signIn(app: Express): Promise<Session> {
  const login = await call(app, "/api/auth/login");
  const cookie = login.headers.get("set-cookie") ?? "";
  const me = await (await call(app, "/api/auth/me", { cookie })).json();
  return { cookie, csrfToken: me.csrfToken, userId: me.id };
}

/** A JSON request as the signed-in user. */
export function send(app: Express, session: Session, method: string, path: string, body?: unknown) {
  return call(app, path, {
    method,
    cookie: session.cookie,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The parsed body, failing the test with the body in the message unless the status matches. */
export async function expectJson(response: Response | Promise<Response>, status: number) {
  const resolved = await response;
  const body = await resolved.json();
  assert.equal(resolved.status, status, JSON.stringify(body));
  return body;
}
```

Create `server/db/seed.ts`:

```ts
import type { Express } from "express";
import type { Pool } from "pg";

import { expectJson, send, type Session } from "./http";

const BUSINESS_TABLES = [
  "files", "suppliers", "models", "items", "drawing_sets", "drawing_items", "projects", "quotes", "quote_case_links",
  "source_assignments", "inspections", "incoming_defects", "purchase_prices", "price_changes", "score_weights", "id_counters",
];

/** Every business row and the audit trail's size, to assert that a request changed nothing. */
export async function snapshotTables(pool: Pool) {
  const snapshot: Record<string, unknown[]> = {};
  for (const table of BUSINESS_TABLES) snapshot[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;
  snapshot.audit_logs = (await pool.query("SELECT count(*)::int AS count FROM audit_logs")).rows;
  return snapshot;
}

/** A model, an item, an active packaging set, a supplier, a case and one case-linked quote, created through the API. */
export async function seedSourcingCase(app: Express, session: Session) {
  const post = (path: string, body: unknown) => expectJson(send(app, session, "POST", path, body), 201);
  const model = await post("/api/models", { name: "BTA", recordState: "Active" });
  const item = await post("/api/items", { itemCode: "PAL-01", itemName: "Pallet", type: "Pallet", usedForModels: [model.id], recordState: "Active" });
  const drawingSet = await post("/api/drawing-sets", {
    modelId: model.id,
    name: "BTA packaging",
    status: "Active",
    effectiveDate: "2026-01-01",
    recordState: "Active",
    drawingItems: [{ itemId: item.id }],
  });
  const supplier = await post("/api/suppliers", { name: "Legacy Paper", capableItems: ["Pallet"], recordState: "Active" });
  const project = await post("/api/projects", {
    name: "BTA 2026",
    modelIds: [model.id],
    drawingSetId: drawingSet.id,
    type: "New Supplier Development",
    supplierIds: [supplier.id],
    itemIds: [item.id],
    openDate: "2026-02-01",
  });
  const quote = await post("/api/quotes", {
    supplierId: supplier.id,
    projectId: project.id,
    quoteType: "Case-linked",
    modelId: model.id,
    itemId: item.id,
    drawingSetId: drawingSet.id,
    drawingItemId: drawingSet.drawingItems[0].id,
    quoteDate: "2026-02-10",
    effectiveFrom: "2026-02-10",
    unitPrice: 12,
    moq: "100",
    leadTime: "14 days",
  });
  return { model, item, drawingSet, supplier, project, quote };
}
```

- [ ] **Step 2: Write the failing route tests**

Create `server/db/businessRoutes.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { withTestApp } from "../testDb";
import { expectJson, send, signIn } from "./http";
import { seedSourcingCase, snapshotTables } from "./seed";

test("a rejected edit changes nothing", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const { project } = await seedSourcingCase(app, session);
    const before = await snapshotTables(pool);
    assert.equal(before.projects.length, 1);

    const response = await send(app, session, "PATCH", `/api/projects/${project.id}`, { drawingSetId: "dwgset-9999" });
    assert.equal(response.status, 400);
    assert.deepEqual(await snapshotTables(pool), before);
  });
});

test("passing an inspection stores the quote as Selected with its price change", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const seed = await seedSourcingCase(app, session);
    const { id: _seedQuoteId, ...quoteFields } = seed.quote;
    const earlier = await expectJson(
      send(app, session, "POST", "/api/quotes", { ...quoteFields, quoteDate: "2026-01-10", effectiveFrom: "2026-01-10", unitPrice: 10, status: "Selected" }),
      201,
    );
    const inspection = await expectJson(
      send(app, session, "POST", "/api/inspections", {
        supplierId: seed.supplier.id,
        projectId: seed.project.id,
        relatedQuoteId: seed.quote.id,
        modelId: seed.model.id,
        drawingSetId: seed.drawingSet.id,
        itemId: seed.item.id,
        drawingItemId: seed.drawingSet.drawingItems[0].id,
        sampleReceivedDate: "2026-02-15",
        result: "Not Submitted",
      }),
      201,
    );

    await expectJson(send(app, session, "PATCH", `/api/inspections/${inspection.id}`, { result: "Pass" }), 200);

    const { rows: [quote] } = await pool.query("SELECT status, previous_quote_id FROM quotes WHERE id = $1", [seed.quote.id]);
    assert.deepEqual(quote, { status: "Selected", previous_quote_id: earlier.id });
    const { rows: changes } = await pool.query("SELECT source_quote_id, previous_quote_id, old_price, new_price FROM price_changes");
    assert.deepEqual(changes, [{ source_quote_id: seed.quote.id, previous_quote_id: earlier.id, old_price: 10, new_price: 12 }]);
    const { rows: [closed] } = await pool.query("SELECT effective_to FROM quotes WHERE id = $1", [earlier.id]);
    assert.notEqual(closed.effective_to, null);
  });
});

test("two edits to one record at the same time both take effect", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const supplier = await expectJson(send(app, session, "POST", "/api/suppliers", { name: "Legacy Paper", recordState: "Active" }), 201);
    const [first, second] = await Promise.all([
      send(app, session, "PATCH", `/api/suppliers/${supplier.id}`, { phone: "555-0100" }),
      send(app, session, "PATCH", `/api/suppliers/${supplier.id}`, { region: "TX" }),
    ]);
    assert.deepEqual([first.status, second.status], [200, 200]);
    const { rows } = await pool.query("SELECT phone, region FROM suppliers WHERE id = $1", [supplier.id]);
    assert.deepEqual(rows, [{ phone: "555-0100", region: "TX" }]);
  });
});

test("opening the app writes nothing, even when a sync pass would change data", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const seed = await seedSourcingCase(app, session);
    await expectJson(
      send(app, session, "POST", "/api/inspections", {
        supplierId: seed.supplier.id,
        projectId: seed.project.id,
        relatedQuoteId: seed.quote.id,
        modelId: seed.model.id,
        drawingSetId: seed.drawingSet.id,
        itemId: seed.item.id,
        drawingItemId: seed.drawingSet.drawingItems[0].id,
        sampleReceivedDate: "2026-02-15",
        result: "Pass",
      }),
      201,
    );
    // A passed inspection whose quote is not Selected: the old bootstrap sync rewrote this on read.
    await pool.query("UPDATE quotes SET status = 'Under Review' WHERE id = $1", [seed.quote.id]);
    const before = await snapshotTables(pool);

    for (const path of ["/api/bootstrap", "/api/scorecard", `/api/projects/${seed.project.id}/comparison`, "/api/files", "/api/score-settings"]) {
      await expectJson(send(app, session, "GET", path), 200);
    }
    assert.deepEqual(await snapshotTables(pool), before);
  });
});

test("an edit can clear a quote's Effective To", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const { quote } = await seedSourcingCase(app, session);
    await expectJson(send(app, session, "PATCH", `/api/quotes/${quote.id}`, { effectiveTo: "2026-06-30", changeReason: "Supplier notice" }), 200);
    await expectJson(send(app, session, "PATCH", `/api/quotes/${quote.id}`, { effectiveTo: null, changeReason: "Open-ended again" }), 200);
    const { rows } = await pool.query("SELECT effective_to FROM quotes WHERE id = $1", [quote.id]);
    assert.deepEqual(rows, [{ effective_to: null }]);
  });
});

test("a defect can be switched from replacement to credit", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const { supplier, item } = await seedSourcingCase(app, session);
    const defect = await expectJson(
      send(app, session, "POST", "/api/incoming-defects", {
        supplierId: supplier.id,
        itemId: item.id,
        defectDate: "2026-04-01",
        defectQty: 5,
        defectAction: "Request Replacement",
        replacementQty: 5,
      }),
      201,
    );
    await expectJson(send(app, session, "PATCH", `/api/incoming-defects/${defect.id}`, { defectAction: "Request Credit", replacementQty: null }), 200);
    const { rows } = await pool.query("SELECT defect_action, replacement_qty, action_completed FROM incoming_defects WHERE id = $1", [defect.id]);
    assert.deepEqual(rows, [{ defect_action: "Request Credit", replacement_qty: null, action_completed: true }]);
  });
});

test("editing a packaging set to drop an item a quote uses still saves", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const { drawingSet, quote } = await seedSourcingCase(app, session);
    await expectJson(send(app, session, "PATCH", `/api/drawing-sets/${drawingSet.id}`, { drawingItems: [] }), 200);
    const { rows } = await pool.query("SELECT id FROM drawing_items WHERE id = $1", [quote.drawingItemId]);
    assert.deepEqual(rows, []);
  });
});

test("deleting an unused packaging set deletes its items and nothing else", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const seed = await seedSourcingCase(app, session);
    const post = (path: string, body: unknown) => expectJson(send(app, session, "POST", path, body), 201);
    const model = await post("/api/models", { name: "BTC 620", recordState: "Active" });
    const item = await post("/api/items", { itemCode: "STR-01", itemName: "Strap", type: "Strapping", usedForModels: [model.id], recordState: "Active" });
    const unused = await post("/api/drawing-sets", {
      modelId: model.id,
      name: "BTC packaging",
      status: "Active",
      effectiveDate: "2026-03-01",
      recordState: "Active",
      drawingItems: [{ itemId: item.id }],
    });

    await expectJson(send(app, session, "DELETE", `/api/drawing-sets/${unused.id}`), 200);

    const { rows: sets } = await pool.query("SELECT id FROM drawing_sets");
    assert.deepEqual(sets, [{ id: seed.drawingSet.id }]);
    const { rows: items } = await pool.query("SELECT drawing_set_id FROM drawing_items");
    assert.deepEqual(items, [{ drawing_set_id: seed.drawingSet.id }]);
    const { rows: quotes } = await pool.query("SELECT id FROM quotes");
    assert.deepEqual(quotes, [{ id: seed.quote.id }]);
  });
});

test("a deleted record's ID is not issued again", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    const session = await signIn(app);
    const first = await expectJson(send(app, session, "POST", "/api/suppliers", { name: "First" }), 201);
    await expectJson(send(app, session, "DELETE", `/api/suppliers/${first.id}`), 200);
    const second = await expectJson(send(app, session, "POST", "/api/suppliers", { name: "Second" }), 201);
    assert.deepEqual([first.id, second.id], ["sup-1001", "sup-1002"]);
  });
});
```

Replace `server/db/uploadRoutes.test.ts` with:

```ts
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
```

In `server/db/scoreSettingsRoutes.test.ts`, delete the comment above `call` ("Only the refused change is exercised…") and append:

```ts
test("an admin's new weights are stored", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const login = await call(app, "/api/auth/login");
    const cookie = login.headers.get("set-cookie") ?? "";
    const me = await (await call(app, "/api/auth/me", { cookie })).json();
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [me.id]);
    const weights = { sampleQuality: 30, incomingQuality: 20, pricing: 20, responsiveness: 10, scopeFit: 10, setup: 10 };

    const change = await call(app, "/api/score-settings", {
      method: "PATCH",
      cookie,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken },
      body: JSON.stringify(weights),
    });
    assert.equal(change.status, 200);
    const { rows } = await pool.query("SELECT sample_quality, responsiveness FROM score_weights");
    assert.deepEqual(rows, [{ sample_quality: 30, responsiveness: 10 }]);
    assert.deepEqual(await (await call(app, "/api/score-settings", { cookie })).json(), weights);
  });
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `npx tsx --env-file-if-exists=.env --test --test-concurrency=1 server/db/businessRoutes.test.ts server/db/uploadRoutes.test.ts server/db/scoreSettingsRoutes.test.ts`
Expected: FAIL. Records still go to the JSON store (in the temporary directory from Task 2), so the assertions on Postgres rows fail — for example `before.projects.length` is 0, not 1 — and the upload tests fail on the file count and on the missing original file name in `Content-Disposition`.

- [ ] **Step 4: Collect audit entries in the context instead of writing them**

In `server/context.ts`, remove the `onAudit` parameter from `createContext`, and change the body of `audit` to:

```ts
    audit(action, entityType, entityId, entityLabel, before, after, reason, linkedRecordId, source) {
      auditEntries.push(buildAuditEntry(user, action, entityType, entityId, entityLabel, before, after, reason, linkedRecordId, source));
    },
```

In `server/context.test.ts`, replace the test "audit entries are collected, or handed over as they happen when asked" with:

```ts
test("audit entries are collected for the save", () => {
  const ctx = createContext(emptyStore(), new Map(), undefined);
  ctx.audit("Create", "Model", "model-1001", "BTA");
  assert.deepEqual(ctx.auditEntries.map((entry) => entry.entityId), ["model-1001"]);
});
```

- [ ] **Step 5: Move the record helpers into `workflow.ts` and add `reconcile`**

In `server/workflow.ts`, add `reconcileQuotePriceChanges` to the import from `./business`, add `import { mergePatch } from "./patch";`, and append:

```ts
export function deleteById<T extends { id: string }>(records: T[], id: string, label: string) {
  const index = records.findIndex((record) => record.id === id);
  if (index === -1) throw new ValidationError(`${label} not found: ${id}`);
  records.splice(index, 1);
}

/** Replaces a record with the edit laid over it, validated by `parse`. A null in the patch clears that field. */
export function updateById<T extends { id: string }>(
  records: T[],
  id: string,
  patch: unknown,
  parse: (value: unknown) => Omit<T, "id">,
) {
  const index = records.findIndex((record) => record.id === id);
  if (index === -1) throw new ValidationError(`Record not found: ${id}`);
  records[index] = { id, ...parse({ ...mergePatch(records[index], patch), id }) } as T;
  return records[index];
}

export function voidById<T extends { id: string; recordState?: "Draft" | "Active" | "Void"; voidReason?: string }>(
  records: T[],
  id: string,
  reason?: string,
) {
  const record = records.find((candidate) => candidate.id === id);
  if (!record) throw new ValidationError(`Record not found: ${id}`);
  record.recordState = "Void";
  record.voidReason = String(reason ?? "").trim() || "Entered in error";
}

/**
 * The passes that keep derived records consistent: packaging-set coverage,
 * case items, reusable quotes, quotes selected by a passed inspection, and
 * price changes. Every write runs them before it commits, so reads never need to.
 */
export function reconcile(ctx: BusinessContext) {
  const modelIds = ctx.store.models.map((model) => model.id);
  syncActivePackagingSetItems(ctx, modelIds, "Auto sync");
  syncActiveCasesForModels(ctx, modelIds, "Auto sync");
  syncReusableQuotesForProjects(ctx);
  syncQuoteStatusesFromPassedInspections(ctx);
  reconcileQuotePriceChanges(ctx);
}
```

- [ ] **Step 6: Stop the comparison from syncing on read**

In `server/business.ts`, change `buildComparison` to take `(store: Store, projectId: string)`, delete its `const { store } = ctx;` line and delete the `syncReusableQuotesForProject(ctx, project);` line.

- [ ] **Step 7: Create the read and write wrappers**

Create `server/unitOfWork.ts`:

```ts
import { isDeepStrictEqual } from "node:util";
import type { Request, RequestHandler } from "express";

import { appendAuditEntry } from "./auditLog";
import { createContext, type RequestContext } from "./context";
import { pool, transaction } from "./db";
import { diffStore } from "./storeDiff";
import { loadCounters, loadStore, saveChanges, saveCounters, saveScoreWeights } from "./storeRepository";
import type { Store } from "./storeShape";
import { reconcile } from "./workflow";

export interface HandlerResult {
  status: number;
  body: unknown;
}

export const ok = (body: unknown): HandlerResult => ({ status: 200, body });
export const created = (body: unknown): HandlerResult => ({ status: 201, body });

/**
 * Runs a create, edit, void, delete or upload as one transaction: load the
 * store, run the handler and the sync passes, then save the rows that changed,
 * the ID counters and the audit entries. Writes take one advisory lock, so
 * they run one at a time even across app instances. Any error rolls
 * everything back, and nothing is sent until the commit succeeds.
 */
export function write(handler: (ctx: RequestContext, request: Request) => HandlerResult): RequestHandler {
  return async (request, response, next) => {
    let result: HandlerResult;
    try {
      result = await transaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('business-data'))");
        const store = await loadStore(client);
        const before = structuredClone(store);
        const ctx = createContext(store, await loadCounters(client), request.user);
        const value = handler(ctx, request);
        reconcile(ctx);
        await saveChanges(client, diffStore(before, store), ctx.fileContents);
        if (!isDeepStrictEqual(before.scoreWeights, store.scoreWeights)) await saveScoreWeights(client, store.scoreWeights);
        await saveCounters(client, ctx.changedCounters());
        for (const entry of ctx.auditEntries) await appendAuditEntry(client, entry);
        return value;
      });
    } catch (error) {
      next(error);
      return;
    }
    response.status(result.status).json(result.body);
  };
}

/** Runs a read against one consistent snapshot. It takes no lock and never writes. */
export function read(handler: (store: Store, request: Request) => unknown): RequestHandler {
  return async (request, response, next) => {
    let body: unknown;
    try {
      const client = await pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        body = handler(await loadStore(client), request);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
      return;
    }
    response.json(body);
  };
}
```

- [ ] **Step 8: Replace `server/app.ts`**

Replace the whole file with:

```ts
import cors from "cors";
import express, { type Express } from "express";
import { join } from "node:path";
import {
  assignPreviousQuote,
  buildComparison,
  buildPriceChangeFromPurchase,
  buildPriceChangeFromQuote,
  buildScorecard,
  closePreviousSelectedQuote,
  normalizeIncomingDefectCompletion,
  syncCaseFromQuote,
  syncReusableQuotesForProject,
  syncReusableQuotesForProjects,
  validateDrawingSetLinks,
  validateIncomingDefectLinks,
  validateInspectionLinks,
  validatePriceChangeLinks,
  validateProjectLinks,
  validatePurchasePriceLinks,
  validateQuoteLinks,
} from "./business";
import {
  drawingSetSchema,
  fileUploadSchema,
  incomingDefectSchema,
  inspectionSchema,
  itemImportSchema,
  itemSchema,
  modelSchema,
  priceChangeSchema,
  projectSchema,
  purchasePriceSchema,
  quoteSchema,
  scoreWeightsSchema,
  sourceAssignmentSchema,
  supplierSchema,
} from "./schemas";
import { ValidationError } from "./errors";
import { errorHandler } from "./errorHandler";
import { authRouter } from "./routes/auth";
import { adminRouter } from "./routes/admin";
import { requireAdmin, requireAuth, sessionMiddleware, verifyCsrf } from "./session";
import { listAuditEntries } from "./auditLog";
import { pool } from "./db";
import { mergePatch } from "./patch";
import { readFileContent } from "./storeRepository";
import { downloadHeaders, fileIdFromStoredName, storagePath, uploadFileType } from "./uploads";
import { serveFrontend } from "./frontend";
import { created, ok, read, write } from "./unitOfWork";
import {
  checkPriceWindow,
  cloneRecord,
  deleteById,
  demoteConflictingSourceRoles,
  editAction,
  ensureNoDrawingSetLinks,
  ensureNoItemLinks,
  ensureNoModelLinks,
  ensureNoProjectLinks,
  ensureNoQuoteLinks,
  ensureNoSupplierLinks,
  ensureSourceAssignmentLinks,
  ensureUniqueItemCode,
  entityLabel,
  nextDrawingSetRevision,
  syncActiveCasesForModels,
  syncActivePackagingSetItems,
  syncQuoteStatusFromInspection,
  updateById,
  voidById,
} from "./workflow";

export function createApp(): Express {
  const app = express();

  app.use(cors({ origin: ["http://127.0.0.1:5173", "http://localhost:5173"] }));
  app.use(express.json({ limit: "10mb" }));
  app.set("trust proxy", 1);
  app.use(sessionMiddleware);
  app.use("/api/auth", authRouter);

  // Mounted before the /api guard on purpose: infrastructure and load
  // balancers that cannot authenticate must still be able to probe
  // liveness, and the payload here is just an ok flag plus two descriptive
  // strings — nothing worth protecting.
  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      service: "global-sourcing-api",
      language: "TypeScript",
      storage: "postgres",
    });
  });

  app.use("/api", requireAuth, verifyCsrf);
  app.use("/uploads", requireAuth);
  app.get("/uploads/:name", async (request, response, next) => {
    try {
      const id = fileIdFromStoredName(request.params.name);
      const file = id ? await readFileContent(pool, id) : undefined;
      if (!id || !file || storagePath(id, file.fileName) !== `uploads/${request.params.name}`) {
        response.status(404).json({ message: "File not found" });
        return;
      }
      response.set(downloadHeaders(file)).send(file.content);
    } catch (error) {
      next(error);
    }
  });
  app.use("/api/admin", adminRouter);

  // Only reads: every write has already run the sync passes before it committed.
  app.get("/api/bootstrap", read((store) => store));

  app.get("/api/audit-logs", requireAdmin, async (request, response, next) => {
    try {
      response.json(await listAuditEntries(pool, {
        entityType: request.query.entityType as string | undefined,
        entityId: request.query.entityId as string | undefined,
        actorUserId: request.query.actorUserId ? Number(request.query.actorUserId) : undefined,
        limit: request.query.limit ? Number(request.query.limit) : undefined,
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/files", read((store) => store.files));
  app.post("/api/files", write((ctx, request) => {
    const parsed = fileUploadSchema.parse(request.body);
    const { mimeType } = uploadFileType(parsed.fileName);
    const content = Buffer.from(parsed.contentBase64, "base64");
    const id = ctx.nextId("file");
    const file = {
      id,
      fileName: parsed.fileName,
      mimeType,
      size: content.length,
      storagePath: storagePath(id, parsed.fileName),
      uploadedAt: new Date().toISOString(),
      purpose: parsed.purpose,
      linkedRecordType: parsed.linkedRecordType,
      linkedRecordId: parsed.linkedRecordId,
    };
    ctx.store.files.push(file);
    ctx.addFileContent(file.id, content);
    ctx.audit("Upload", "File", file.id, file.fileName, undefined, file, undefined, parsed.linkedRecordId);
    return created(file);
  }));

  app.get("/api/suppliers", read((store) => store.suppliers));
  app.post("/api/suppliers", write((ctx, request) => {
    const supplier = { id: ctx.nextId("sup"), ...supplierSchema.parse(request.body) };
    ctx.store.suppliers.push(supplier);
    ctx.audit("Create", "Supplier", supplier.id, supplier.name, undefined, supplier);
    return created(supplier);
  }));
  app.delete("/api/suppliers/:id", write((ctx, request) => {
    const { store } = ctx;
    ensureNoSupplierLinks(store, request.params.id);
    const before = store.suppliers.find((record) => record.id === request.params.id);
    deleteById(store.suppliers, request.params.id, "Supplier");
    ctx.audit("Delete", "Supplier", request.params.id, before ? entityLabel(store, "Supplier", before) : request.params.id, before);
    return ok({ ok: true });
  }));
  app.patch("/api/suppliers/:id", write((ctx, request) => {
    const { store } = ctx;
    const before = cloneRecord(store.suppliers.find((record) => record.id === request.params.id));
    const supplier = updateById(store.suppliers, request.params.id, request.body, supplierSchema.parse);
    ctx.audit(editAction(before, supplier), "Supplier", supplier.id, supplier.name, before, supplier);
    return ok(supplier);
  }));
  app.post("/api/suppliers/:id/void", write((ctx, request) => {
    const { store } = ctx;
    const before = cloneRecord(store.suppliers.find((record) => record.id === request.params.id));
    voidById(store.suppliers, request.params.id, request.body?.reason);
    const after = store.suppliers.find((record) => record.id === request.params.id);
    ctx.audit("Void", "Supplier", request.params.id, after ? entityLabel(store, "Supplier", after) : request.params.id, before, after, request.body?.reason);
    return ok({ ok: true });
  }));

  app.get("/api/models", read((store) => store.models));
  app.post("/api/models", write((ctx, request) => {
    const model = { id: ctx.nextId("model"), ...modelSchema.parse(request.body) };
    ctx.store.models.push(model);
    ctx.audit("Create", "Model", model.id, model.name, undefined, model);
    return created(model);
  }));
  app.delete("/api/models/:id", write((ctx, request) => {
    const { store } = ctx;
    ensureNoModelLinks(store, request.params.id);
    const before = store.models.find((record) => record.id === request.params.id);
    deleteById(store.models, request.params.id, "Model");
    ctx.audit("Delete", "Model", request.params.id, before ? entityLabel(store, "Model", before) : request.params.id, before);
    return ok({ ok: true });
  }));
  app.patch("/api/models/:id", write((ctx, request) => {
    const { store } = ctx;
    const before = cloneRecord(store.models.find((record) => record.id === request.params.id));
    const model = updateById(store.models, request.params.id, request.body, modelSchema.parse);
    ctx.audit(editAction(before, model), "Model", model.id, model.name, before, model);
    return ok(model);
  }));
  app.post("/api/models/:id/void", write((ctx, request) => {
    const { store } = ctx;
    const before = cloneRecord(store.models.find((record) => record.id === request.params.id));
    voidById(store.models, request.params.id, request.body?.reason);
    const after = store.models.find((record) => record.id === request.params.id);
    ctx.audit("Void", "Model", request.params.id, after ? entityLabel(store, "Model", after) : request.params.id, before, after, request.body?.reason);
    return ok({ ok: true });
  }));

  app.get("/api/items", read((store) => store.items));
  app.post("/api/items", write((ctx, request) => {
    const { store } = ctx;
    const parsed = itemSchema.parse(request.body);
    ensureUniqueItemCode(store, parsed.itemCode);
    const item = { id: ctx.nextId("item"), ...parsed };
    store.items.push(item);
    syncActivePackagingSetItems(ctx, item.usedForModels, "Item create");
    syncActiveCasesForModels(ctx, item.usedForModels, "Item create");
    ctx.audit("Create", "Item", item.id, item.itemCode, undefined, item);
    return created(item);
  }));
  app.post("/api/items/import", write((ctx, request) => {
    const { store } = ctx;
    const parsed = itemImportSchema.parse(request.body);
    const existingItemCodes = new Set(
      store.items
        .filter((item) => item.recordState !== "Void")
        .map((item) => item.itemCode.trim().toLowerCase()),
    );
    const importedItemCodes = new Set<string>();
    const imported = parsed.rows.map((row) => {
      const modelIds = row.usedFor.map((modelNameOrId) => {
        const match = store.models.find(
          (model) =>
            model.id.toLowerCase() === modelNameOrId.trim().toLowerCase() ||
            model.name.toLowerCase() === modelNameOrId.trim().toLowerCase(),
        );
        if (!match) throw new ValidationError(`Model not found for Used for: ${modelNameOrId}`);
        return match.id;
      });
      const normalizedItemCode = row.itemCode.trim().toLowerCase();
      if (existingItemCodes.has(normalizedItemCode)) {
        return { action: "duplicated", itemCode: row.itemCode };
      }
      if (importedItemCodes.has(normalizedItemCode)) {
        return { action: "skipped", itemCode: row.itemCode, reason: "Duplicate row in this import" };
      }
      const itemBody = itemSchema.parse({
        itemCode: row.itemCode,
        itemName: row.description,
        type: row.type,
        usedForModels: Array.from(new Set(modelIds)),
        uom: "pcs",
        status: "Active",
        recordState: "Active",
      });

      const item = { id: ctx.nextId("item"), ...itemBody };
      store.items.push(item);
      importedItemCodes.add(normalizedItemCode);
      ctx.audit("Import", "Item", item.id, item.itemCode, undefined, item, "Created from item import", item.id, "Import");
      return { action: "created", item };
    });
    const affectedModelIds = Array.from(
      new Set(
        imported
          .flatMap((row) => (row.action === "created" && row.item ? row.item.usedForModels : [])),
      ),
    );
    syncActivePackagingSetItems(ctx, affectedModelIds, "Item import");
    syncActiveCasesForModels(ctx, affectedModelIds, "Item import");
    return created({
      totalRows: parsed.rows.length,
      created: imported.filter((row) => row.action === "created").length,
      duplicated: imported.filter((row) => row.action === "duplicated").length,
      skipped: imported.filter((row) => row.action === "skipped").length,
      duplicateItemCodes: imported.filter((row) => row.action === "duplicated").map((row) => row.itemCode),
      rows: imported,
    });
  }));
  app.delete("/api/items/:id", write((ctx, request) => {
    const { store } = ctx;
    ensureNoItemLinks(store, request.params.id);
    const before = store.items.find((record) => record.id === request.params.id);
    deleteById(store.items, request.params.id, "Item");
    ctx.audit("Delete", "Item", request.params.id, before ? entityLabel(store, "Item", before) : request.params.id, before);
    return ok({ ok: true });
  }));
  app.patch("/api/items/:id", write((ctx, request) => {
    const { store } = ctx;
    const before = cloneRecord(store.items.find((record) => record.id === request.params.id));
    if (request.body?.itemCode) ensureUniqueItemCode(store, String(request.body.itemCode), request.params.id);
    const item = updateById(store.items, request.params.id, request.body, itemSchema.parse);
    const affectedModelIds = Array.from(new Set([...(before?.usedForModels ?? []), ...item.usedForModels]));
    syncActivePackagingSetItems(ctx, affectedModelIds, "Item edit");
    syncActiveCasesForModels(ctx, affectedModelIds, "Item edit");
    ctx.audit(before?.recordState === "Draft" && item.recordState === "Active" ? "Approve" : editAction(before, item), "Item", item.id, item.itemCode, before, item);
    return ok(item);
  }));
  app.post("/api/items/:id/void", write((ctx, request) => {
    const { store } = ctx;
    const before = cloneRecord(store.items.find((record) => record.id === request.params.id));
    voidById(store.items, request.params.id, request.body?.reason);
    const after = store.items.find((record) => record.id === request.params.id);
    syncActivePackagingSetItems(ctx, before?.usedForModels ?? after?.usedForModels ?? [], "Item void");
    syncActiveCasesForModels(ctx, before?.usedForModels ?? after?.usedForModels ?? [], "Item void");
    ctx.audit("Void", "Item", request.params.id, after ? entityLabel(store, "Item", after) : request.params.id, before, after, request.body?.reason);
    return ok({ ok: true });
  }));

  app.get("/api/drawing-sets", read((store) => store.drawingSets));
  app.post("/api/drawing-sets", write((ctx, request) => {
    const { store } = ctx;
    const modelId = String(request.body?.modelId ?? "");
    const generatedRevision = nextDrawingSetRevision(store, modelId);
    const parsed = drawingSetSchema.parse({
      ...request.body,
      revision: generatedRevision,
      drawingItems: (request.body?.drawingItems ?? []).map((drawingItem: Record<string, unknown>) => ({
        ...drawingItem,
        revision: generatedRevision,
      })),
    });
    validateDrawingSetLinks(store, parsed);
    if (request.body?.replaceActive && parsed.status === "Active") {
      for (const drawingSet of store.drawingSets) {
        if (drawingSet.modelId === parsed.modelId && drawingSet.status === "Active") {
          const before = cloneRecord(drawingSet);
          drawingSet.status = "Superseded";
          ctx.audit("Status Change", "DrawingSet", drawingSet.id, drawingSet.name, before, drawingSet, "Replaced by newer active drawing set");
        }
      }
    }
    const drawingSet = {
      id: ctx.nextId("dwgset"),
      ...parsed,
      drawingItems: parsed.drawingItems.map((drawingItem) => ({
        id: ctx.nextId("dwgitem"),
        ...drawingItem,
      })),
    };
    store.drawingSets.push(drawingSet);
    ctx.audit("Create", "DrawingSet", drawingSet.id, drawingSet.name, undefined, drawingSet);
    return created(drawingSet);
  }));
  app.delete("/api/drawing-sets/:id", write((ctx, request) => {
    const { store } = ctx;
    ensureNoDrawingSetLinks(store, request.params.id);
    const before = store.drawingSets.find((record) => record.id === request.params.id);
    deleteById(store.drawingSets, request.params.id, "Drawing set");
    ctx.audit("Delete", "DrawingSet", request.params.id, before ? entityLabel(store, "DrawingSet", before) : request.params.id, before);
    return ok({ ok: true });
  }));
  app.patch("/api/drawing-sets/:id", write((ctx, request) => {
    const { store } = ctx;
    const current = store.drawingSets.find((record) => record.id === request.params.id);
    if (!current) throw new ValidationError(`Record not found: ${request.params.id}`);
    const before = cloneRecord(current);
    const requestedDrawingItems = Array.isArray(request.body?.drawingItems)
      ? request.body.drawingItems
      : current.drawingItems;
    const parsed = drawingSetSchema.parse({
      ...mergePatch(current, request.body),
      drawingItems: requestedDrawingItems.map(({ itemId, revision, status, drawingSource, fileName, fileId }: Record<string, unknown>) => ({
        itemId,
        revision: String(revision ?? current.revision),
        status,
        drawingSource,
        fileName,
        fileId,
      })),
    });
    const nextDrawingItems = parsed.drawingItems.map((drawingItem) => {
      const existing = current.drawingItems.find((candidate) => candidate.itemId === drawingItem.itemId);
      return {
        id: existing?.id ?? ctx.nextId("dwgitem"),
        ...drawingItem,
      };
    });
    const drawingSet = Object.assign(current, {
      ...parsed,
      drawingItems: nextDrawingItems,
    });
    validateDrawingSetLinks(store, drawingSet);
    ctx.audit(editAction(before, drawingSet), "DrawingSet", drawingSet.id, drawingSet.name, before, drawingSet);
    return ok(drawingSet);
  }));
  app.post("/api/drawing-sets/:id/void", write((ctx, request) => {
    const { store } = ctx;
    const before = cloneRecord(store.drawingSets.find((record) => record.id === request.params.id));
    voidById(store.drawingSets, request.params.id, request.body?.reason);
    const after = store.drawingSets.find((record) => record.id === request.params.id);
    ctx.audit("Void", "DrawingSet", request.params.id, after ? entityLabel(store, "DrawingSet", after) : request.params.id, before, after, request.body?.reason);
    return ok({ ok: true });
  }));

  app.get("/api/projects", read((store) => store.projects));
  app.post("/api/projects", write((ctx, request) => {
    const { store } = ctx;
    const parsed = projectSchema.parse({ ...request.body, recordState: "Active" });
    validateProjectLinks(store, parsed);
    const project = { id: ctx.nextId("proj"), ...parsed };
    store.projects.push(project);
    syncReusableQuotesForProject(ctx, project);
    ctx.audit("Create", "Case", project.id, project.name, undefined, project);
    return created(project);
  }));
  app.delete("/api/projects/:id", write((ctx, request) => {
    const { store } = ctx;
    ensureNoProjectLinks(store, request.params.id);
    const before = store.projects.find((record) => record.id === request.params.id);
    deleteById(store.projects, request.params.id, "Case");
    ctx.audit("Delete", "Case", request.params.id, before ? entityLabel(store, "Case", before) : request.params.id, before);
    return ok({ ok: true });
  }));
  app.patch("/api/projects/:id", write((ctx, request) => {
    const { store } = ctx;
    const before = cloneRecord(store.projects.find((record) => record.id === request.params.id));
    const project = updateById(store.projects, request.params.id, request.body, projectSchema.parse);
    validateProjectLinks(store, project);
    syncReusableQuotesForProject(ctx, project);
    ctx.audit(editAction(before, project), "Case", project.id, project.name, before, project);
    return ok(project);
  }));
  app.post("/api/projects/:id/void", write((ctx, request) => {
    const { store } = ctx;
    const before = cloneRecord(store.projects.find((record) => record.id === request.params.id));
    voidById(store.projects, request.params.id, request.body?.reason);
    const after = store.projects.find((record) => record.id === request.params.id);
    ctx.audit("Void", "Case", request.params.id, after ? entityLabel(store, "Case", after) : request.params.id, before, after, request.body?.reason);
    return ok({ ok: true });
  }));

  app.get("/api/quotes", read((store) => store.quotes));
  app.post("/api/quotes", write((ctx, request) => {
    const { store } = ctx;
    const parsed = quoteSchema.parse({ ...request.body, recordState: "Active" });
    validateQuoteLinks(store, parsed);
    checkPriceWindow(store, { id: "", ...parsed });
    const quote = { id: ctx.nextId("q"), ...parsed };
    store.quotes.push(quote);
    assignPreviousQuote(store, quote);
    syncCaseFromQuote(ctx, quote);
    buildPriceChangeFromQuote(ctx, quote);
    closePreviousSelectedQuote(store, quote);
    syncReusableQuotesForProjects(ctx);
    ctx.audit("Create", "Quote", quote.id, entityLabel(store, "Quote", quote), undefined, quote, undefined, quote.projectId);
    return created(quote);
  }));
  app.delete("/api/quotes/:id", write((ctx, request) => {
    const { store } = ctx;
    ensureNoQuoteLinks(store, request.params.id);
    const before = store.quotes.find((record) => record.id === request.params.id);
    deleteById(store.quotes, request.params.id, "Quote");
    ctx.audit("Delete", "Quote", request.params.id, before ? entityLabel(store, "Quote", before) : request.params.id, before);
    return ok({ ok: true });
  }));
  app.patch("/api/quotes/:id", write((ctx, request) => {
    const { store } = ctx;
    // changeReason explains a changed Effective To in the audit trail; it is not stored on the quote.
    const { changeReason, ...patch } = request.body ?? {};
    const reason = typeof changeReason === "string" && changeReason.trim() ? changeReason.trim() : undefined;
    const before = cloneRecord(store.quotes.find((record) => record.id === request.params.id));
    if (before) checkPriceWindow(store, { ...quoteSchema.parse(mergePatch(before, patch)), id: before.id }, before, reason);
    const quote = updateById(store.quotes, request.params.id, patch, quoteSchema.parse);
    validateQuoteLinks(store, quote);
    assignPreviousQuote(store, quote);
    syncCaseFromQuote(ctx, quote);
    buildPriceChangeFromQuote(ctx, quote);
    closePreviousSelectedQuote(store, quote);
    syncReusableQuotesForProjects(ctx);
    ctx.audit(editAction(before, quote), "Quote", quote.id, entityLabel(store, "Quote", quote), before, quote, reason, quote.projectId);
    return ok(quote);
  }));
  app.post("/api/quotes/:id/void", write((ctx, request) => {
    const { store } = ctx;
    const before = cloneRecord(store.quotes.find((record) => record.id === request.params.id));
    voidById(store.quotes, request.params.id, request.body?.reason);
    const after = store.quotes.find((record) => record.id === request.params.id);
    ctx.audit("Void", "Quote", request.params.id, after ? entityLabel(store, "Quote", after) : request.params.id, before, after, request.body?.reason, after?.projectId);
    return ok({ ok: true });
  }));

  app.get("/api/source-assignments", read((store) => store.sourceAssignments));
  app.post("/api/source-assignments", write((ctx, request) => {
    const { store } = ctx;
    const parsed = sourceAssignmentSchema.parse({ ...request.body, recordState: "Active" });
    ensureSourceAssignmentLinks(store, parsed);
    const current = store.sourceAssignments.find(
      (assignment) =>
        assignment.recordState !== "Void" &&
        (assignment.projectId ?? "") === (parsed.projectId ?? "") &&
        assignment.modelId === parsed.modelId &&
        assignment.itemId === parsed.itemId &&
        assignment.supplierId === parsed.supplierId,
    );

    if (current) {
      const before = cloneRecord(current);
      Object.assign(current, parsed);
      demoteConflictingSourceRoles(ctx, current);
      ctx.audit("Edit", "SourceAssignment", current.id, entityLabel(store, "SourceAssignment", current), before, current, undefined, current.projectId);
      return ok(current);
    }

    const assignment = { id: ctx.nextId("assign"), ...parsed };
    store.sourceAssignments.push(assignment);
    demoteConflictingSourceRoles(ctx, assignment);
    ctx.audit("Create", "SourceAssignment", assignment.id, entityLabel(store, "SourceAssignment", assignment), undefined, assignment, undefined, assignment.projectId);
    return created(assignment);
  }));

  app.get("/api/inspections", read((store) => store.inspections));
  app.post("/api/inspections", write((ctx, request) => {
    const { store } = ctx;
    const parsed = inspectionSchema.parse({ ...request.body, recordState: "Active" });
    validateInspectionLinks(store, parsed);
    const inspection = { id: ctx.nextId("ins"), ...parsed };
    store.inspections.push(inspection);
    syncQuoteStatusFromInspection(ctx, inspection);
    ctx.audit("Create", "Inspection", inspection.id, entityLabel(store, "Inspection", inspection), undefined, inspection, undefined, inspection.relatedQuoteId);
    return created(inspection);
  }));
  app.delete("/api/inspections/:id", write((ctx, request) => {
    const { store } = ctx;
    const before = store.inspections.find((record) => record.id === request.params.id);
    deleteById(store.inspections, request.params.id, "Inspection");
    ctx.audit("Delete", "Inspection", request.params.id, before ? entityLabel(store, "Inspection", before) : request.params.id, before);
    return ok({ ok: true });
  }));
  app.patch("/api/inspections/:id", write((ctx, request) => {
    const { store } = ctx;
    const before = cloneRecord(store.inspections.find((record) => record.id === request.params.id));
    const inspection = updateById(store.inspections, request.params.id, request.body, inspectionSchema.parse);
    validateInspectionLinks(store, inspection);
    syncQuoteStatusFromInspection(ctx, inspection);
    ctx.audit(editAction(before, inspection), "Inspection", inspection.id, entityLabel(store, "Inspection", inspection), before, inspection, undefined, inspection.relatedQuoteId);
    return ok(inspection);
  }));
  app.post("/api/inspections/:id/void", write((ctx, request) => {
    const { store } = ctx;
    const before = cloneRecord(store.inspections.find((record) => record.id === request.params.id));
    voidById(store.inspections, request.params.id, request.body?.reason);
    const after = store.inspections.find((record) => record.id === request.params.id);
    ctx.audit("Void", "Inspection", request.params.id, after ? entityLabel(store, "Inspection", after) : request.params.id, before, after, request.body?.reason, after?.relatedQuoteId);
    return ok({ ok: true });
  }));

  app.get("/api/incoming-defects", read((store) => store.incomingDefects));
  app.post("/api/incoming-defects", write((ctx, request) => {
    const { store } = ctx;
    const parsed = incomingDefectSchema.parse({ ...request.body, recordState: "Active" });
    normalizeIncomingDefectCompletion(parsed);
    validateIncomingDefectLinks(store, parsed);
    const defect = { id: ctx.nextId("def"), ...parsed };
    store.incomingDefects.push(defect);
    ctx.audit("Create", "IncomingDefect", defect.id, entityLabel(store, "IncomingDefect", defect), undefined, defect);
    return created(defect);
  }));
  app.delete("/api/incoming-defects/:id", write((ctx, request) => {
    const { store } = ctx;
    const before = store.incomingDefects.find((record) => record.id === request.params.id);
    deleteById(store.incomingDefects, request.params.id, "Incoming defect");
    ctx.audit("Delete", "IncomingDefect", request.params.id, before ? entityLabel(store, "IncomingDefect", before) : request.params.id, before);
    return ok({ ok: true });
  }));
  app.patch("/api/incoming-defects/:id", write((ctx, request) => {
    const { store } = ctx;
    const before = cloneRecord(store.incomingDefects.find((record) => record.id === request.params.id));
    const defect = updateById(store.incomingDefects, request.params.id, request.body, incomingDefectSchema.parse);
    normalizeIncomingDefectCompletion(defect);
    validateIncomingDefectLinks(store, defect);
    ctx.audit(editAction(before, defect), "IncomingDefect", defect.id, entityLabel(store, "IncomingDefect", defect), before, defect);
    return ok(defect);
  }));
  app.post("/api/incoming-defects/:id/void", write((ctx, request) => {
    const { store } = ctx;
    const before = cloneRecord(store.incomingDefects.find((record) => record.id === request.params.id));
    voidById(store.incomingDefects, request.params.id, request.body?.reason);
    const after = store.incomingDefects.find((record) => record.id === request.params.id);
    ctx.audit("Void", "IncomingDefect", request.params.id, after ? entityLabel(store, "IncomingDefect", after) : request.params.id, before, after, request.body?.reason);
    return ok({ ok: true });
  }));

  app.get("/api/price-changes", read((store) => store.priceChanges));
  app.post("/api/price-changes", write((ctx, request) => {
    const { store } = ctx;
    const parsed = priceChangeSchema.parse(request.body);
    validatePriceChangeLinks(store, parsed);
    const priceChange = { id: ctx.nextId("pc"), ...parsed };
    store.priceChanges.push(priceChange);
    ctx.audit("Create", "PriceChange", priceChange.id, entityLabel(store, "PriceChange", priceChange), undefined, priceChange, undefined, priceChange.sourceQuoteId);
    return created(priceChange);
  }));
  app.delete("/api/price-changes/:id", write((ctx, request) => {
    const { store } = ctx;
    const before = store.priceChanges.find((record) => record.id === request.params.id);
    deleteById(store.priceChanges, request.params.id, "Price change");
    ctx.audit("Delete", "PriceChange", request.params.id, before ? entityLabel(store, "PriceChange", before) : request.params.id, before);
    return ok({ ok: true });
  }));
  app.patch("/api/price-changes/:id", write((ctx, request) => {
    const { store } = ctx;
    const before = cloneRecord(store.priceChanges.find((record) => record.id === request.params.id));
    const priceChange = updateById(store.priceChanges, request.params.id, request.body, priceChangeSchema.parse);
    validatePriceChangeLinks(store, priceChange);
    ctx.audit(editAction(before, priceChange), "PriceChange", priceChange.id, entityLabel(store, "PriceChange", priceChange), before, priceChange, undefined, priceChange.sourceQuoteId);
    return ok(priceChange);
  }));
  app.post("/api/price-changes/:id/void", write((ctx, request) => {
    const { store } = ctx;
    const before = cloneRecord(store.priceChanges.find((record) => record.id === request.params.id));
    voidById(store.priceChanges, request.params.id, request.body?.reason);
    const after = store.priceChanges.find((record) => record.id === request.params.id);
    ctx.audit("Void", "PriceChange", request.params.id, after ? entityLabel(store, "PriceChange", after) : request.params.id, before, after, request.body?.reason, after?.sourceQuoteId);
    return ok({ ok: true });
  }));

  app.get("/api/purchase-prices", read((store) => store.purchasePrices));
  app.post("/api/purchase-prices", write((ctx, request) => {
    const { store } = ctx;
    const parsed = purchasePriceSchema.parse(request.body);
    validatePurchasePriceLinks(store, parsed);
    const purchasePrice = { id: ctx.nextId("po"), ...parsed };
    store.purchasePrices.push(purchasePrice);
    buildPriceChangeFromPurchase(ctx, purchasePrice);
    return created(purchasePrice);
  }));
  app.patch("/api/purchase-prices/:id", write((ctx, request) => {
    const { store } = ctx;
    const purchasePrice = updateById(store.purchasePrices, request.params.id, request.body, purchasePriceSchema.parse);
    validatePurchasePriceLinks(store, purchasePrice);
    return ok(purchasePrice);
  }));
  app.post("/api/purchase-prices/:id/void", write((ctx, request) => {
    voidById(ctx.store.purchasePrices, request.params.id, request.body?.reason);
    return ok({ ok: true });
  }));
  app.delete("/api/purchase-prices/:id", write((ctx, request) => {
    deleteById(ctx.store.purchasePrices, request.params.id, "Purchase price");
    return ok({ ok: true });
  }));

  app.get("/api/projects/:projectId/comparison", read((store, request) => buildComparison(store, request.params.projectId)));

  app.get("/api/scorecard", read((store) => buildScorecard(store)));

  app.get("/api/score-settings", read((store) => store.scoreWeights));

  app.patch("/api/score-settings", requireAdmin, write((ctx, request) => {
    const weights = scoreWeightsSchema.parse(request.body);
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    if (total !== 100) throw new ValidationError("Score weights must add up to 100.");
    const before = cloneRecord(ctx.store.scoreWeights);
    ctx.store.scoreWeights = weights;
    ctx.audit("Edit", "ScoreSettings", "score-settings", "Score settings", before, ctx.store.scoreWeights);
    return ok(ctx.store.scoreWeights);
  }));

  serveFrontend(app, join(process.cwd(), "dist"));
  app.use(errorHandler);

  return app;
}
```

- [ ] **Step 9: Remove the JSON store and the static upload handler**

```bash
git rm server/store.ts server/storeFile.ts server/storeFile.test.ts
```

In `server/uploads.ts`, delete `setUploadHeaders` and the `import type { Response } from "express";` line. In `server/uploads.test.ts`, delete `fakeResponse`, `setUploadHeaders` from the import, and the three tests that call it ("every stored file is served without content sniffing", "PDFs and photos open in the browser", "anything else is sent as a download…"); `downloadHeaders` covers the same rules.

Run: `grep -rn "from \"./store\"\|storeFile\|saveStore" server scripts`
Expected: no output.

- [ ] **Step 10: Drop the JSON-store workarounds from the audit actor test**

Each test now gets a fresh database, so the clean-up deletes are no longer needed. Replace `server/db/auditActor.test.ts` with:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { listAuditEntries } from "../auditLog";
import { withTestApp } from "../testDb";
import { expectJson, send, signIn } from "./http";

// Read the audit trail through the pool withTestApp hands back: it is the
// app's own pool, bound to the test database. Do not import "../app",
// "../db" or "../session" statically here.

test("a create records the signed-in user", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    await expectJson(send(app, session, "POST", "/api/suppliers", { name: "Audit Actor Test" }), 201);
    const [entry] = await listAuditEntries(pool, { entityType: "Supplier" });
    assert.equal(entry.actorLabel, "Dev User");
    assert.equal(entry.actorUserId, session.userId);
  });
});

test("a system-generated sync stays anonymous even though a signed-in user triggered it", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const model = await expectJson(send(app, session, "POST", "/api/models", { name: "Audit Actor Test Model", recordState: "Active" }), 201);
    await expectJson(
      send(app, session, "POST", "/api/drawing-sets", {
        modelId: model.id,
        name: "Audit Actor Test Set",
        status: "Active",
        effectiveDate: "2026-01-01",
        drawingItems: [],
      }),
      201,
    );

    // Creating an Active item used by this model makes syncActivePackagingSetItems
    // add it to the packaging set: a system change caused by the user's request.
    await expectJson(
      send(app, session, "POST", "/api/items", {
        itemCode: "AUDIT-ITEM-1",
        itemName: "Audit Item",
        type: "Pallet",
        usedForModels: [model.id],
        uom: "pcs",
        status: "Active",
        recordState: "Active",
      }),
      201,
    );

    const [syncEntry] = await listAuditEntries(pool, { entityType: "DrawingSet" });
    assert.equal(syncEntry.source, "System");
    assert.equal(syncEntry.actorLabel, "System");
    assert.equal(syncEntry.actorUserId, null);

    const [itemEntry] = await listAuditEntries(pool, { entityType: "Item" });
    assert.equal(itemEntry.actorLabel, "Dev User");
    assert.equal(itemEntry.actorUserId, session.userId);
  });
});
```

- [ ] **Step 11: Run every test and both type checks**

Run: `npm run typecheck:api && npx tsc -p tsconfig.json --noEmit && npm test && npm run test:db`
Expected: exit 0 throughout. All `businessRoutes`, `uploadRoutes`, `scoreSettingsRoutes` and `auditActor` tests pass.

- [ ] **Step 12: Confirm the working tree is untouched**

Run: `git status --short data uploads`
Expected: no output — no test wrote to either directory.

- [ ] **Step 13: Commit**

```bash
git add -A server
git commit -F - <<'EOF'
Run every business request in a Postgres transaction

Business records, score weights and uploaded files now live in Postgres. A
write loads the store under an advisory lock, runs its handler and the sync
passes, and saves the changed rows, counters and audit entries in one
transaction; any error rolls all of it back. Reads use a read-only snapshot,
so opening the app no longer writes. Files are served from the database
under their original names. data/store.json and uploads/ are no longer used.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Report database refusals as 400 and guard purchase-price deletes

**Files:**
- Modify: `server/schemas.ts`, `server/errorHandler.ts`, `server/workflow.ts`, `server/app.ts`
- Test: `server/schemas.test.ts` (new), `server/errorHandler.test.ts` (new), `server/db/businessRoutes.test.ts`

**Interfaces:**
- Consumes: `blockDelete` (private) in `workflow.ts`; `seedSourcingCase`, `snapshotTables`, `send`, `expectJson`, `signIn` (Task 8).
- Produces: `ensureNoPurchasePriceLinks(store, id)` in `workflow.ts`; the error handler's 400 for Postgres codes `23503`, `22007` and `22008`.

- [ ] **Step 1: Write the failing offline tests**

Create `server/schemas.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { incomingDefectSchema, quoteSchema } from "./schemas";

const quote = {
  supplierId: "sup-1001",
  modelId: "model-1001",
  itemId: "item-1001",
  drawingSetId: "dwgset-1001",
  drawingItemId: "dwgitem-1001",
  quoteDate: "2026-02-10",
  effectiveFrom: "2026-02-10",
  unitPrice: 12,
  moq: "100",
  leadTime: "14 days",
};

test("dates must be written as YYYY-MM-DD", () => {
  assert.equal(quoteSchema.safeParse(quote).success, true);
  assert.equal(quoteSchema.safeParse({ ...quote, effectiveFrom: "02/10/2026" }).success, false);
  assert.equal(quoteSchema.safeParse({ ...quote, effectiveTo: "2026-2-1" }).success, false);
  assert.equal(quoteSchema.safeParse({ ...quote, effectiveTo: "" }).success, false);
});

test("replacement receipt dates are checked too", () => {
  const defect = { supplierId: "sup-1001", itemId: "item-1001", defectDate: "2026-04-01", defectQty: 5, defectAction: "Request Credit" };
  assert.equal(incomingDefectSchema.safeParse(defect).success, true);
  const receipts = [{ receivedDate: "April 10", receivedQty: 5, result: "Accepted" }];
  assert.equal(incomingDefectSchema.safeParse({ ...defect, replacementReceipts: receipts }).success, false);
});
```

Create `server/errorHandler.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";

import { errorHandler } from "./errorHandler";

function respond(error: unknown) {
  const sent: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  } as unknown as Response;
  errorHandler(error, {} as Request, response, () => {});
  return sent;
}

const databaseError = (code: string, message: string) => Object.assign(new Error(message), { code });

test("a foreign key refusal from Postgres is a 400 with a plain message", () => {
  assert.deepEqual(respond(databaseError("23503", 'insert or update on table "suppliers" violates foreign key constraint')), {
    status: 400,
    body: { message: "This change refers to a record that does not exist, or removes one that other records still use." },
  });
});

test("an impossible date from Postgres is a 400", () => {
  assert.deepEqual(respond(databaseError("22008", "date/time field value out of range")), {
    status: 400,
    body: { message: "A date is not valid." },
  });
});

test("any other error stays a 500 without detail", () => {
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(respond(databaseError("ECONNREFUSED", "connect ECONNREFUSED")), { status: 500, body: { message: "Internal server error" } });
  } finally {
    console.error = original;
  }
});
```

- [ ] **Step 2: Write the failing route tests**

Append to `server/db/businessRoutes.test.ts`:

```ts
test("a reference to a missing file is refused with 400 and nothing is stored", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const before = await snapshotTables(pool);
    const response = await send(app, session, "POST", "/api/suppliers", { name: "Legacy Paper", w9FileId: "file-9999" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /refers to a record that does not exist/);
    assert.deepEqual(await snapshotTables(pool), before);
  });
});

test("an impossible date is refused with 400", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    const session = await signIn(app);
    const { quote } = await seedSourcingCase(app, session);
    const response = await send(app, session, "PATCH", `/api/quotes/${quote.id}`, { effectiveTo: "2026-02-30", changeReason: "Typo test" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).message, "A date is not valid.");
  });
});

test("a purchase price that a price change refers to cannot be deleted", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    const session = await signIn(app);
    const { supplier, model, item } = await seedSourcingCase(app, session);
    const purchase = { supplierId: supplier.id, modelId: model.id, itemId: item.id, poNumber: "PO-1", orderDate: "2026-03-01", unitPrice: 10, quantity: 100 };
    const first = await expectJson(send(app, session, "POST", "/api/purchase-prices", purchase), 201);
    await expectJson(send(app, session, "POST", "/api/purchase-prices", { ...purchase, poNumber: "PO-2", orderDate: "2026-04-01", unitPrice: 11 }), 201);

    const response = await send(app, session, "DELETE", `/api/purchase-prices/${first.id}`);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).message, "Cannot delete purchase price: linked to price changes.");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx tsx --test server/schemas.test.ts server/errorHandler.test.ts`
Expected: FAIL — `02/10/2026` is accepted, and the database errors get a 500.

Run: `npx tsx --env-file-if-exists=.env --test --test-concurrency=1 server/db/businessRoutes.test.ts`
Expected: the three new tests FAIL with status 500; the earlier tests pass.

- [ ] **Step 4: Check date format in the schemas**

In `server/schemas.ts`, add below `packagingItemTypes`:

```ts
// Calendar days as date inputs send them; the database stores them as date.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");
```

Then replace each date field's type:

| Schema | Field | New type |
| --- | --- | --- |
| `drawingSetSchema` | `effectiveDate` | `isoDate` |
| `projectSchema` | `openDate` | `isoDate` |
| `projectSchema` | `targetCloseDate` | `isoDate.optional()` |
| `quoteSchema` | `quoteDate`, `effectiveFrom` | `isoDate` |
| `quoteSchema` | `effectiveTo`, `validUntil` | `isoDate.optional()` |
| `sourceAssignmentSchema` | `effectiveFrom` | `isoDate` |
| `inspectionSchema` | `sampleReceivedDate` | `isoDate` |
| `inspectionSchema` | `inspectionDate`, `signedDate` | `isoDate.optional()` |
| `incomingDefectSchema` | `defectDate` | `isoDate` |
| `incomingDefectSchema` | `actionCompletedDate`, `returnDate` | `isoDate.optional()` |
| `incomingDefectSchema` | `replacementReceipts[].receivedDate` | `isoDate` |
| `priceChangeSchema` | `effectiveDate` | `isoDate` |
| `purchasePriceSchema` | `orderDate` | `isoDate` |

- [ ] **Step 5: Map Postgres refusals to 400**

In `server/errorHandler.ts`, add above `errorHandler`:

```ts
// Postgres refusals a request can cause. Checks in code normally catch these
// first with a more specific message; this is the backstop.
const DATABASE_REFUSALS: Record<string, string> = {
  "23503": "This change refers to a record that does not exist, or removes one that other records still use.",
  "22007": "A date is not valid.",
  "22008": "A date is not valid.",
};
```

and inside `errorHandler`, after the `"issues" in error` block:

```ts
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (typeof code === "string" && DATABASE_REFUSALS[code]) {
    response.status(400).json({ message: DATABASE_REFUSALS[code] });
    return;
  }
```

- [ ] **Step 6: Guard the purchase-price delete**

Append to `server/workflow.ts`:

```ts
export function ensureNoPurchasePriceLinks(store: Store, id: string) {
  blockDelete("purchase price", [
    store.priceChanges.some((change) => change.sourcePurchasePriceId === id || change.previousPurchasePriceId === id) ? "price changes" : "",
  ]);
}
```

In `server/app.ts`, add `ensureNoPurchasePriceLinks` to the `./workflow` import and make the purchase-price delete route:

```ts
  app.delete("/api/purchase-prices/:id", write((ctx, request) => {
    ensureNoPurchasePriceLinks(ctx.store, request.params.id);
    deleteById(ctx.store.purchasePrices, request.params.id, "Purchase price");
    return ok({ ok: true });
  }));
```

- [ ] **Step 7: Run everything**

Run: `npm run typecheck:api && npm test && npm run test:db`
Expected: exit 0; the new tests pass.

- [ ] **Step 8: Commit**

```bash
git add server/schemas.ts server/schemas.test.ts server/errorHandler.ts server/errorHandler.test.ts server/workflow.ts server/app.ts server/db/businessRoutes.test.ts
git commit -F - <<'EOF'
Report database refusals as 400 and guard purchase-price deletes

Dates must now be YYYY-MM-DD. A foreign key or date refusal from Postgres is
reported as a 400 instead of a server error, and deleting a purchase price
that a price change refers to is refused with the same message as the other
delete guards.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: Update the deployment, the docs, and remove the file-store leftovers

**Files:**
- Modify: `Dockerfile`, `compose.intranet.yml`, `docs/deployment.md`, `README.md`, `server/README.md`, `docs/frontend-implementation.md`, `.gitignore`
- Delete: `scripts/import-audit-logs.ts`

**Interfaces:** none; no code consumes these files.

- [ ] **Step 1: Drop the data volumes from the image and compose file**

In `Dockerfile`, delete these three lines:

```dockerfile
# data/ holds the business records (store.json) and uploads/ the uploaded
# files; both are mounted as volumes by compose.intranet.yml.
RUN mkdir -p data uploads && chown node:node data uploads
```

In `compose.intranet.yml`, delete the `volumes:` block of the `app` service (the `app-data` and `app-uploads` mounts) and the `app-data:` and `app-uploads:` entries under the top-level `volumes:`, leaving `pgdata:`.

Run: `POSTGRES_PASSWORD=check SESSION_SECRET=0123456789abcdef0123456789abcdef APP_ORIGIN=http://127.0.0.1:18080 docker compose -f compose.intranet.yml config --quiet`
Expected: exit 0, no output.

- [ ] **Step 2: Remove the audit import script**

```bash
git rm scripts/import-audit-logs.ts
grep -rn "import-audit-logs" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.superpowers .
```

Expected from the grep: matches only in `README.md` (fixed in Step 4) and `docs/superpowers/` (historical plans; leave them).

- [ ] **Step 3: Rewrite `docs/deployment.md`**

Replace the file with:

````markdown
# Intranet deployment

The workbench runs as two containers on one host, defined in `compose.intranet.yml`:

| Container | Purpose | Data volume |
| --- | --- | --- |
| `postgres` | All data: business records, uploaded files, users, sessions and the audit trail | `pgdata` |
| `app` | The API, which also serves the built frontend | none |

The app listens on `HOST_PORT` (default 8080). On every start it applies pending migrations, so a new release needs no separate migration step. Postgres is not published to the host.

## Requirements

- Docker with Compose v2 (`docker compose version`).

If the server cannot reach Docker Hub and the npm registry, build on a machine that can and copy the images across:

```bash
# On the connected machine, from the repository
docker compose -f compose.intranet.yml --env-file deploy.env build
docker pull postgres:17
docker save sourcing-workbench-app postgres:17 | gzip > sourcing-images.tar.gz

# On the server
docker load < sourcing-images.tar.gz
docker compose -f compose.intranet.yml --env-file deploy.env up -d   # no --build
```

## First deployment

```bash
cp deploy.env.example deploy.env
```

Fill in `deploy.env`:

- `APP_ORIGIN`: the address people will type, such as `http://sourcing-srv:8080`.
- `POSTGRES_PASSWORD`: `openssl rand -hex 24`.
- `SESSION_SECRET`: `openssl rand -hex 32`.

`deploy.env` holds secrets and is ignored by git. Then start the containers:

```bash
docker compose -f compose.intranet.yml --env-file deploy.env up -d --build
```

Open `APP_ORIGIN` and sign in. The system starts empty.

## Sign-in modes

### `AUTH_MODE=dev` (trial use)

No Microsoft sign-in: everyone who opens the page is signed in as one shared account, **Dev User** (`dev@segsolar.com`). Every change in the audit trail is recorded as Dev User, and anyone who can reach the host can read and change all data. Use it only on the intranet, for a short trial with a small group.

The shared account starts with the `user` role, which cannot open Admin or change KPI weights. To allow that, promote it after the first sign-in. Everyone then has admin rights:

```bash
docker compose -f compose.intranet.yml --env-file deploy.env exec app npm run admin -- dev@segsolar.com
```

`dev` mode is refused when `NODE_ENV=production`.

### `AUTH_MODE=entra` (named accounts)

Each person signs in with their SEG account, and the audit trail records who made each change. This mode needs:

1. **An Entra app registration.** IT registers one app with the redirect URI `<APP_ORIGIN>/api/auth/callback` and the delegated `openid`, `profile` and `email` scopes; no other permissions are needed. The client secret expires, so note its expiry date.
2. **HTTPS.** Entra accepts `http` redirect URIs only for `localhost`, so `APP_ORIGIN` must be an `https://` address. Put a reverse proxy with a certificate (an internal CA is fine) in front of `HOST_PORT`. The frontend and the API must stay on that one origin, because the session cookie is not sent cross-site.
3. **Settings in `deploy.env`.** Set `AUTH_MODE=entra`, `NODE_ENV=production` and the three `ENTRA_` values, then run `up -d` again.

Accounts are created with the `user` role on first sign-in. Promote the first admin with the `npm run admin` command above, using their email address. Further admins can then be promoted from **Admin → Users**.

## Updating

```bash
git pull
docker compose -f compose.intranet.yml --env-file deploy.env up -d --build
```

Data is kept in the `pgdata` volume, and pending migrations run when the app starts.

### Upgrading from a release that stored business data in files

Earlier releases kept business records and uploads in two more volumes. This release does not read them. After upgrading, check they are empty, then remove them:

```bash
docker run --rm -v sourcing-workbench_app-data:/data -v sourcing-workbench_app-uploads:/uploads alpine ls -A /data /uploads
docker volume rm sourcing-workbench_app-data sourcing-workbench_app-uploads
```

If the listing shows files, stop and keep the volumes: their records would need importing, which this release does not do.

## Backups

The database holds everything, uploaded files included. Schedule this with cron on the host:

```bash
cd /path/to/Supplier-Management-System
docker compose -f compose.intranet.yml --env-file deploy.env exec -T postgres pg_dump -U sourcing sourcing | gzip > backup-db-$(date +%F).sql.gz
```

Uploaded PDFs and images are already compressed, so the dump grows by roughly the size of the files uploaded.

To restore, stop the app, replace the database with the dump, and start again. On a new host, run `up -d postgres` first so the database container exists.

```bash
docker compose -f compose.intranet.yml --env-file deploy.env stop app
docker compose -f compose.intranet.yml --env-file deploy.env exec -T postgres dropdb -U sourcing sourcing
docker compose -f compose.intranet.yml --env-file deploy.env exec -T postgres createdb -U sourcing sourcing
gunzip -c backup-db-<date>.sql.gz | docker compose -f compose.intranet.yml --env-file deploy.env exec -T postgres psql -q -U sourcing sourcing
docker compose -f compose.intranet.yml --env-file deploy.env up -d
```

## Operations

```bash
docker compose -f compose.intranet.yml --env-file deploy.env ps          # status and health
docker compose -f compose.intranet.yml --env-file deploy.env logs -f app # logs
curl http://<host>:<HOST_PORT>/api/health                                  # liveness, no sign-in needed
```
````

- [ ] **Step 4: Update `README.md`**

1. In **Stack**, replace the Storage line with:

```markdown
- Storage: PostgreSQL for everything — business records, uploaded files, users, sessions and the audit trail
```

2. Replace the whole **Data** section (from `## Data` up to `## Project Layout`) with:

```markdown
## Data

Everything is stored in Postgres, uploaded file contents included; `npm run migrate` creates the tables and a new database starts with no records. Each write request is one transaction, so a rejected change leaves nothing behind.

`data/` and `uploads/` held business records and files before they moved to Postgres. The app no longer reads them; delete them if they are still in your checkout.
```

3. In **Project Layout**, replace the `business.ts` and `store.ts` lines under `server/` with:

```text
  unitOfWork.ts Read and write wrappers: one transaction per write
  context.ts    What business rules work through during a request
  workflow.ts   Route helpers and the sync passes run after every write
  business.ts   Validation, comparison, scorecard, and sync rules
  store*.ts     Store shape, table mapping, change detection and Postgres access
```

and change the `scripts/` line to `scripts/     Migration, admin promotion and write-time measurement scripts`.

- [ ] **Step 5: Update `server/README.md`**

1. In the stack list, change the Postgres line to `- PostgreSQL (`pg`) for all data`.
2. Replace the two paragraphs beginning `Users, sessions (`connect-pg-simple`)` and `Business records are still a JSON file prototype` with:

```markdown
All data is stored in Postgres; the schema is in `migrations/` and applied with `npm run migrate` (and on every start of the Docker image). Each business record type has its own table, and uploaded files are stored in `files`.

A write request is one transaction: it loads the business data, applies the change and the sync passes, then saves the changed rows, the ID counters and the audit entries together, so a rejected request changes nothing. Writes take an advisory lock and run one at a time. Reads use a read-only snapshot and never write.
```

3. Replace the `GET/POST /api/files` bullet with:

```markdown
- `GET/POST /api/files`: uploads are sent as base64 JSON (the request limit is 10 MB). Only the types in `server/uploads.ts` are accepted (PDF, common image, Excel, CSV and Word files), and the server sets the MIME type. `GET /uploads/<id>.<ext>` returns the file with `X-Content-Type-Options: nosniff`: PDFs and images open in the browser, anything else downloads, under the original file name.
```

4. After the sentence `Records. Each supports …`, add:

```markdown
A `PATCH` sets only the fields in its body; a field sent as `null` is cleared. Dates are `YYYY-MM-DD`. A record that other records refer to cannot be deleted.
```

- [ ] **Step 6: Tidy the remaining references**

In `docs/frontend-implementation.md`, delete the bullet `- Bootstrap reconciliation can write to the JSON store on the backend. All smoke testing was performed on a copy to keep the original data untouched.`

In `.gitignore`, change the comment `# Runtime data (server re-seeds store.json when missing)` to `# Business data and uploads from before the move to Postgres`.

Run: `grep -rn "store\.json\|JSON file prototype\|app-data\|app-uploads" README.md server/README.md docs/deployment.md Dockerfile compose.intranet.yml`
Expected: matches only in `docs/deployment.md`'s upgrade section and `README.md`'s note about the old `data/` directory.

- [ ] **Step 7: Build the image**

Run: `docker build -t sourcing-workbench-check .`
Expected: the build completes.

- [ ] **Step 8: Commit**

```bash
git add -A Dockerfile compose.intranet.yml docs/deployment.md README.md server/README.md docs/frontend-implementation.md .gitignore scripts
git commit -F - <<'EOF'
Document Postgres-only storage and drop the data volumes

The app container no longer needs the store.json and uploads volumes, and a
backup is one pg_dump. The deployment guide explains how to remove the old
volumes after upgrading. The audit import script only read old store.json
files and is removed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: Measure write time against a large data set

**Files:**
- Create: `scripts/measure-write-time.ts`
- Modify (only if Step 3 finds the budget exceeded): `server/business.ts` (`reconcileQuotePriceChanges`)

**Interfaces:**
- Consumes: `saveChanges`, `saveScoreWeights` (Task 6), `diffStore` (Task 4), `emptyStore` (Task 3), `createApp` (Task 8), `runMigrations`.

- [ ] **Step 1: Write the measurement script**

Create `scripts/measure-write-time.ts`:

```ts
// Times quote edits against a large synthetic data set in the TEST database:
//   npx tsx --env-file-if-exists=.env scripts/measure-write-time.ts
// It empties the business tables of DATABASE_URL_TEST first. The budget is a
// median of 200 ms per edit.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { Store } from "../server/storeShape";

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) throw new Error("DATABASE_URL_TEST is not set.");
process.env.DATABASE_URL = testUrl;
process.chdir(mkdtempSync(join(tmpdir(), "sourcing-measure-")));

const { pool } = await import("../server/db");
const { runMigrations } = await import("./migrate");
const { saveChanges, saveScoreWeights } = await import("../server/storeRepository");
const { diffStore } = await import("../server/storeDiff");
const { emptyStore } = await import("../server/storeShape");
const { createApp } = await import("../server/app");

const pad = (value: number) => String(value).padStart(4, "0");

function syntheticStore(): Store {
  const store = emptyStore();
  const types = ["Pallet", "Strapping", "Upper Cover", "Paper Plate"] as const;
  for (let s = 0; s < 50; s += 1) {
    store.suppliers.push({
      id: `sup-${1001 + s}`, recordState: "Active", name: `Supplier ${s}`, status: "Active", type: "Manufacturer", country: "United States",
      region: "", capableItems: [...types], primaryContact: "", email: "", phone: "", paymentTerms: "Net 30", hasW9: true, hasPaymentInfo: true, notes: "",
    });
  }
  for (let m = 0; m < 20; m += 1) {
    const modelId = `model-${1001 + m}`;
    store.models.push({ id: modelId, recordState: "Active", name: `Model ${m}`, productFamily: "Solar Module", status: "Active", notes: "" });
    const itemIds: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const id = `item-${1001 + m * 10 + i}`;
      itemIds.push(id);
      store.items.push({ id, recordState: "Active", itemCode: `ITEM-${pad(m * 10 + i)}`, itemName: `Item ${m}-${i}`, type: types[i % types.length], usedForModels: [modelId], uom: "pcs", status: "Active" });
    }
    const drawingSetId = `dwgset-${1001 + m}`;
    store.drawingSets.push({
      id: drawingSetId, recordState: "Active", modelId, name: `Model ${m} packaging`, revision: "1.0", status: "Active", effectiveDate: "2026-01-01",
      maintainedBy: "Process Engineering",
      drawingItems: itemIds.map((itemId, i) => ({ id: `dwgitem-${1001 + m * 10 + i}`, itemId, revision: "1.0", status: "Active", drawingSource: "Package PDF" })),
    });
    for (let p = 0; p < 5; p += 1) {
      store.projects.push({
        id: `proj-${1001 + m * 5 + p}`, recordState: "Active", name: `Case ${m}-${p}`, modelIds: [modelId], drawingSetId,
        type: "New Supplier Development", caseReason: "New Supplier Intro", status: "Quoting",
        supplierIds: Array.from({ length: 5 }, (_, k) => `sup-${1001 + ((p * 5 + k) % 50)}`), itemIds, owner: "Purchasing", openDate: "2026-01-01",
      });
    }
  }
  for (let q = 0; q < 3000; q += 1) {
    const project = store.projects[q % store.projects.length];
    const drawingSet = store.drawingSets.find((candidate) => candidate.id === project.drawingSetId)!;
    const drawingItem = drawingSet.drawingItems[q % drawingSet.drawingItems.length];
    const id = `q-${1001 + q}`;
    const supplierId = project.supplierIds[q % project.supplierIds.length];
    store.quotes.push({
      id, recordState: "Active", supplierId, projectId: project.id, quoteType: "Case-linked", quoteReason: "New Quote", modelId: project.modelIds[0],
      itemId: drawingItem.itemId, drawingSetId: drawingSet.id, drawingItemId: drawingItem.id, quoteDate: "2026-02-01", effectiveFrom: "2026-02-01",
      currency: "USD", uom: "pcs", unitPrice: 10 + (q % 7), moq: "100", leadTime: `${7 + (q % 21)} days`, extraCostType: "None", extraCostAmount: 0,
      status: "Received", notes: "",
    });
    store.quoteCaseLinks.push({
      id: `ql-${1001 + q}`, recordState: "Active", quoteId: id, projectId: project.id, supplierId, itemId: drawingItem.itemId,
      modelId: project.modelIds[0], linkType: "Origin Case", sampleRequirement: "Not Reviewed",
    });
  }
  for (let n = 0; n < 1000; n += 1) {
    const quote = store.quotes[n * 3];
    store.inspections.push({
      id: `ins-${1001 + n}`, recordState: "Active", supplierId: quote.supplierId, projectId: quote.projectId, relatedQuoteId: quote.id, modelId: quote.modelId,
      drawingSetId: quote.drawingSetId, itemId: quote.itemId, drawingItemId: quote.drawingItemId, sampleRound: 1, sampleReceivedDate: "2026-02-15",
      result: "Fail", disposition: "Re-sample Required", problemPhotos: 0, photoFileIds: [], notes: "",
    });
  }
  for (let c = 0; c < 500; c += 1) {
    const quote = store.quotes[c * 5];
    store.priceChanges.push({
      id: `pc-${1001 + c}`, recordState: "Active", supplierId: quote.supplierId, modelId: quote.modelId, itemId: quote.itemId, sourceType: "Manual",
      oldPrice: 10, newPrice: 11, currency: "USD", effectiveDate: "2026-03-01", reason: "Material", status: "Approved",
    });
  }
  return store;
}

async function seed() {
  const client = await pool.connect();
  try {
    await runMigrations(client);
    const { rows } = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations', 'users', 'session')`);
    await client.query(`TRUNCATE TABLE ${rows.map((row) => `"${row.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
    const store = syntheticStore();
    await client.query("BEGIN");
    await saveChanges(client, diffStore(emptyStore(), store));
    await saveScoreWeights(client, store.scoreWeights);
    // Counters past every seeded ID, as the app would have left them.
    await client.query(`INSERT INTO id_counters (prefix, value) VALUES
      ('sup', 1050), ('model', 1020), ('item', 1200), ('dwgset', 1020), ('dwgitem', 1200), ('proj', 1100),
      ('q', 4000), ('ql', 4000), ('ins', 2000), ('pc', 1500)
      ON CONFLICT (prefix) DO UPDATE SET value = EXCLUDED.value`);
    await client.query("COMMIT");
    return store;
  } finally {
    client.release();
  }
}

async function time(label: string, runs: number, request: (run: number) => Promise<Response>) {
  const durations: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    const response = await request(run);
    await response.arrayBuffer();
    if (!response.ok) throw new Error(`${label} failed with ${response.status}`);
    durations.push(performance.now() - started);
  }
  durations.sort((a, b) => a - b);
  console.log(`${label}: median ${Math.round(durations[Math.floor(runs / 2)])} ms, max ${Math.round(durations[runs - 1])} ms over ${runs} runs`);
  return durations[Math.floor(runs / 2)];
}

const store = await seed();
const server = createApp().listen(0);
const { port } = server.address() as { port: number };
const base = `http://127.0.0.1:${port}`;
try {
  const login = await fetch(`${base}/api/auth/login`, { redirect: "manual" });
  const cookie = login.headers.get("set-cookie") ?? "";
  const me = await (await fetch(`${base}/api/auth/me`, { headers: { cookie } })).json();
  const headers = { cookie, "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken };
  const quoteId = store.quotes[0].id;
  const edit = (run: number) => fetch(`${base}/api/quotes/${quoteId}`, { method: "PATCH", headers, body: JSON.stringify({ notes: `Edit ${run}` }) });

  await edit(-1); // the first write runs every sync pass over fresh data
  const median = await time("Quote edit", 20, edit);
  await time("Bootstrap read", 10, () => fetch(`${base}/api/bootstrap`, { headers }));
  console.log(median <= 200 ? "Within the 200 ms budget." : "OVER the 200 ms budget.");
} finally {
  server.close();
  await pool.end();
}
```

- [ ] **Step 2: Run it**

Run: `npx tsx --env-file-if-exists=.env scripts/measure-write-time.ts`
Expected: two timing lines and a budget line. Record the numbers for the final report.

- [ ] **Step 3: If the median edit is over 200 ms, remove the quadratic change check**

Skip this step when the script printed `Within the 200 ms budget.`

`reconcileQuotePriceChanges` serialises every price change twice for each effective quote. Replace the function in `server/business.ts` with one that compares once:

```ts
export function reconcileQuotePriceChanges(ctx: BusinessContext) {
  const { store } = ctx;
  const before = JSON.stringify([store.quotes, store.priceChanges]);
  const effectiveQuotes = [...store.quotes]
    .filter((quote) => quote.recordState !== "Void" && isEffectivePriceQuote(quote))
    .sort((a, b) => (a.effectiveFrom ?? a.quoteDate).localeCompare(b.effectiveFrom ?? b.quoteDate));

  for (const quote of effectiveQuotes) {
    assignPreviousQuote(store, quote);
    buildPriceChangeFromQuote(ctx, quote);
    closePreviousSelectedQuote(store, quote);
  }

  return before !== JSON.stringify([store.quotes, store.priceChanges]);
}
```

Run: `npm test && npm run test:db && npx tsx --env-file-if-exists=.env scripts/measure-write-time.ts`
Expected: tests pass. If the median is still over 200 ms, stop and report both measurements instead of optimising further; the next step is a decision for the user.

- [ ] **Step 4: Commit**

```bash
git add scripts/measure-write-time.ts server/business.ts
git commit -F - <<'EOF'
Add a write-time measurement against a large synthetic data set

Every write loads the store and runs the sync passes, so its cost grows with
the data. The script seeds 3,000 quotes with cases, inspections and price
changes in the test database and times quote edits against a 200 ms budget.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

(If Step 3 was skipped, `server/business.ts` is unchanged and `git add` ignores it.)

---

### Task 12: Verify the whole branch

**Files:** none changed unless a check fails.

- [ ] **Step 1: Run every automated check**

Run: `npm run typecheck:api && npm test && npm run test:db && npm run build`
Expected: exit 0 throughout.

- [ ] **Step 2: Run the intranet compose stack in isolation**

The env file goes in a temporary directory, not the repository:

```bash
CHECK_DIR=$(mktemp -d)
cat > "$CHECK_DIR/deploy-check.env" <<'EOF'
POSTGRES_PASSWORD=check-only
SESSION_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef
APP_ORIGIN=http://127.0.0.1:18080
HOST_PORT=18080
AUTH_MODE=dev
EOF
check() { docker compose -p sourcing-check -f compose.intranet.yml --env-file "$CHECK_DIR/deploy-check.env" "$@"; }
check up -d --build
check ps
curl -s http://127.0.0.1:18080/api/health
check exec -T postgres psql -U sourcing -c '\dt'
check down -v
```

Expected: both containers healthy; the health response ends `"storage":"postgres"}`; `\dt` lists 20 tables (the 16 business tables plus `audit_logs`, `schema_migrations`, `session`, `users`); `down -v` removes the check stack and its volume. `-p sourcing-check` keeps it apart from any real deployment on the machine.

- [ ] **Step 3: Walk through the app in a browser**

Run `npm run migrate`, then `npm run dev:api` and `npm run dev` in two terminals, and open http://127.0.0.1:5173. The development database starts with no business records. Check each of these and note anything that differs:

1. Create a supplier and attach a W9 PDF. Its link opens the PDF in the browser; saving it from the viewer offers the original file name.
2. Create a model, an item used for it, and an active packaging set with a PDF.
3. Create a development case, then a case-linked quote.
4. Record a sample inspection that passes for that quote. The quote shows as Selected.
5. Edit the quote: set Effective To with a reason and save; edit again, empty Effective To with a reason and save. The field is empty after reloading.
6. Record an incoming defect with Request Replacement, then edit it to Request Credit. It saves.
7. Upload an Excel file as a quote attachment. Clicking it downloads the file under its original name.
8. Stop and restart `npm run dev:api`, reload the page: every record above is still there.

- [ ] **Step 4: Hand over**

Use superpowers:finishing-a-development-branch to decide how to integrate the branch.
