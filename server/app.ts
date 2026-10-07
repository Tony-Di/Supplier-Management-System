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
  validateSupplierFileLinks,
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
  ensureNoPurchasePriceLinks,
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
    validateSupplierFileLinks(ctx.store, supplier);
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
    validateSupplierFileLinks(store, supplier);
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
    const index = store.drawingSets.findIndex((record) => record.id === request.params.id);
    if (index === -1) throw new ValidationError(`Record not found: ${request.params.id}`);
    const current = store.drawingSets[index];
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
    // Replaced, not assigned onto: Object.assign would keep a field the patch cleared with null.
    const drawingSet = { id: current.id, ...parsed, drawingItems: nextDrawingItems };
    store.drawingSets[index] = drawingSet;
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
    // Only a later selection records which quote closed this price.
    const { closedByQuoteId: _closedByQuoteId, ...parsed } = quoteSchema.parse({ ...request.body, recordState: "Active" });
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
    ensureNoPurchasePriceLinks(ctx.store, request.params.id);
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
