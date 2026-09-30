import cors from "cors";
import express, { type Express, type Request } from "express";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Quote } from "../src/types";
import {
  buildComparison,
  buildPriceChangeFromPurchase,
  buildPriceChangeFromQuote,
  buildScorecard,
  closePreviousSelectedQuote,
  normalizeIncomingDefectCompletion,
  assignPreviousQuote,
  reconcileQuotePriceChanges,
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
import { createContext } from "./context";
import { ValidationError } from "./errors";
import { counters, nextId, saveStore, store } from "./store";
import {
  checkPriceWindow,
  cloneRecord,
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
  syncQuoteStatusesFromPassedInspections,
} from "./workflow";
import { errorHandler } from "./errorHandler";
import { authRouter } from "./routes/auth";
import { adminRouter } from "./routes/admin";
import { requireAdmin, requireAuth, sessionMiddleware, verifyCsrf } from "./session";
import { appendAuditEntry, listAuditEntries } from "./auditLog";
import { pool } from "./db";
import { setUploadHeaders, uploadFileType } from "./uploads";
import { mergePatch } from "./patch";
import { serveFrontend } from "./frontend";

export function createApp(): Express {
  const app = express();

  // Handlers work through a context over the in-memory store. Audit entries
  // are still written as they happen, fire and forget.
  const contextFor = (request: Request) =>
    createContext(store, counters, request.user, (entry) => {
      void appendAuditEntry(pool, entry).catch((error) => console.error("Failed to write audit entry:", error));
    });

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
      storage: "json-file prototype",
    });
  });

  app.use("/api", requireAuth, verifyCsrf);
  app.use("/uploads", requireAuth, express.static(join(process.cwd(), "uploads"), { setHeaders: setUploadHeaders }));
  app.use("/api/admin", adminRouter);

  app.get("/api/bootstrap", (request, response) => {
    const ctx = contextFor(request);
    if (syncActivePackagingSetItems(ctx, store.models.map((model) => model.id), "Bootstrap")) saveStore();
    if (syncActiveCasesForModels(ctx, store.models.map((model) => model.id), "Bootstrap")) saveStore();
    if (syncReusableQuotesForProjects(ctx)) saveStore();
    if (syncQuoteStatusesFromPassedInspections(ctx)) saveStore();
    if (reconcileQuotePriceChanges(ctx)) saveStore();
    response.json(store);
  });

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

  app.get("/api/files", (_request, response) => response.json(store.files));
  app.post("/api/files", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const parsed = fileUploadSchema.parse(request.body);
      const { extension, mimeType } = uploadFileType(parsed.fileName);
      const file = {
        id: nextId("file"),
        fileName: parsed.fileName,
        mimeType,
        size: Buffer.byteLength(parsed.contentBase64, "base64"),
        storagePath: "",
        uploadedAt: new Date().toISOString(),
        purpose: parsed.purpose,
        linkedRecordType: parsed.linkedRecordType,
        linkedRecordId: parsed.linkedRecordId,
      };
      const uploadDir = join(process.cwd(), "uploads");
      mkdirSync(uploadDir, { recursive: true });
      file.storagePath = join("uploads", `${file.id}${extension}`);
      writeFileSync(join(process.cwd(), file.storagePath), Buffer.from(parsed.contentBase64, "base64"));
      store.files.push(file);
      ctx.audit("Upload", "File", file.id, file.fileName, undefined, file, undefined, parsed.linkedRecordId);
      saveStore();
      response.status(201).json(file);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/suppliers", (_request, response) => response.json(store.suppliers));
  app.post("/api/suppliers", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const supplier = { id: nextId("sup"), ...supplierSchema.parse(request.body) };
      store.suppliers.push(supplier);
      ctx.audit("Create", "Supplier", supplier.id, supplier.name, undefined, supplier);
      saveStore();
      response.status(201).json(supplier);
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/suppliers/:id", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      ensureNoSupplierLinks(store, request.params.id);
      const before = store.suppliers.find((record) => record.id === request.params.id);
      deleteById(store.suppliers, request.params.id, "Supplier");
      ctx.audit("Delete", "Supplier", request.params.id, before ? entityLabel(store, "Supplier", before) : request.params.id, before);
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/suppliers/:id", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const before = cloneRecord(store.suppliers.find((record) => record.id === request.params.id));
      const supplier = updateById(store.suppliers, request.params.id, request.body, supplierSchema.parse);
      ctx.audit(editAction(before, supplier), "Supplier", supplier.id, supplier.name, before, supplier);
      response.json(supplier);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/suppliers/:id/void", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const before = cloneRecord(store.suppliers.find((record) => record.id === request.params.id));
      voidById(store.suppliers, request.params.id, request.body?.reason);
      const after = store.suppliers.find((record) => record.id === request.params.id);
      ctx.audit("Void", "Supplier", request.params.id, after ? entityLabel(store, "Supplier", after) : request.params.id, before, after, request.body?.reason);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/models", (_request, response) => response.json(store.models));
  app.post("/api/models", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const model = { id: nextId("model"), ...modelSchema.parse(request.body) };
      store.models.push(model);
      ctx.audit("Create", "Model", model.id, model.name, undefined, model);
      saveStore();
      response.status(201).json(model);
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/models/:id", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      ensureNoModelLinks(store, request.params.id);
      const before = store.models.find((record) => record.id === request.params.id);
      deleteById(store.models, request.params.id, "Model");
      ctx.audit("Delete", "Model", request.params.id, before ? entityLabel(store, "Model", before) : request.params.id, before);
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/models/:id", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const before = cloneRecord(store.models.find((record) => record.id === request.params.id));
      const model = updateById(store.models, request.params.id, request.body, modelSchema.parse);
      ctx.audit(editAction(before, model), "Model", model.id, model.name, before, model);
      response.json(model);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/models/:id/void", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const before = cloneRecord(store.models.find((record) => record.id === request.params.id));
      voidById(store.models, request.params.id, request.body?.reason);
      const after = store.models.find((record) => record.id === request.params.id);
      ctx.audit("Void", "Model", request.params.id, after ? entityLabel(store, "Model", after) : request.params.id, before, after, request.body?.reason);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/items", (_request, response) => response.json(store.items));
  app.post("/api/items", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const parsed = itemSchema.parse(request.body);
      ensureUniqueItemCode(store, parsed.itemCode);
      const item = { id: nextId("item"), ...parsed };
      store.items.push(item);
      syncActivePackagingSetItems(ctx, item.usedForModels, "Item create");
      syncActiveCasesForModels(ctx, item.usedForModels, "Item create");
      ctx.audit("Create", "Item", item.id, item.itemCode, undefined, item);
      saveStore();
      response.status(201).json(item);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/items/import", (request, response, next) => {
    try {
      const ctx = contextFor(request);
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

        const item = { id: nextId("item"), ...itemBody };
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
      saveStore();
      response.status(201).json({
        totalRows: parsed.rows.length,
        created: imported.filter((row) => row.action === "created").length,
        duplicated: imported.filter((row) => row.action === "duplicated").length,
        skipped: imported.filter((row) => row.action === "skipped").length,
        duplicateItemCodes: imported.filter((row) => row.action === "duplicated").map((row) => row.itemCode),
        rows: imported,
      });
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/items/:id", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      ensureNoItemLinks(store, request.params.id);
      const before = store.items.find((record) => record.id === request.params.id);
      deleteById(store.items, request.params.id, "Item");
      ctx.audit("Delete", "Item", request.params.id, before ? entityLabel(store, "Item", before) : request.params.id, before);
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/items/:id", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const before = cloneRecord(store.items.find((record) => record.id === request.params.id));
      if (request.body?.itemCode) ensureUniqueItemCode(store, String(request.body.itemCode), request.params.id);
      const item = updateById(store.items, request.params.id, request.body, itemSchema.parse);
      const affectedModelIds = Array.from(new Set([...(before?.usedForModels ?? []), ...item.usedForModels]));
      syncActivePackagingSetItems(ctx, affectedModelIds, "Item edit");
      syncActiveCasesForModels(ctx, affectedModelIds, "Item edit");
      ctx.audit(before?.recordState === "Draft" && item.recordState === "Active" ? "Approve" : editAction(before, item), "Item", item.id, item.itemCode, before, item);
      saveStore();
      response.json(item);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/items/:id/void", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const before = cloneRecord(store.items.find((record) => record.id === request.params.id));
      voidById(store.items, request.params.id, request.body?.reason);
      const after = store.items.find((record) => record.id === request.params.id);
      syncActivePackagingSetItems(ctx, before?.usedForModels ?? after?.usedForModels ?? [], "Item void");
      syncActiveCasesForModels(ctx, before?.usedForModels ?? after?.usedForModels ?? [], "Item void");
      ctx.audit("Void", "Item", request.params.id, after ? entityLabel(store, "Item", after) : request.params.id, before, after, request.body?.reason);
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/drawing-sets", (_request, response) => response.json(store.drawingSets));
  app.post("/api/drawing-sets", (request, response, next) => {
    try {
      const ctx = contextFor(request);
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
        id: nextId("dwgset"),
        ...parsed,
        drawingItems: parsed.drawingItems.map((drawingItem) => ({
          id: nextId("dwgitem"),
          ...drawingItem,
        })),
      };
      store.drawingSets.push(drawingSet);
      ctx.audit("Create", "DrawingSet", drawingSet.id, drawingSet.name, undefined, drawingSet);
      saveStore();
      response.status(201).json(drawingSet);
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/drawing-sets/:id", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      ensureNoDrawingSetLinks(store, request.params.id);
      const before = store.drawingSets.find((record) => record.id === request.params.id);
      deleteById(store.drawingSets, request.params.id, "Drawing set");
      ctx.audit("Delete", "DrawingSet", request.params.id, before ? entityLabel(store, "DrawingSet", before) : request.params.id, before);
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/drawing-sets/:id", (request, response, next) => {
    try {
      const ctx = contextFor(request);
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
          id: existing?.id ?? nextId("dwgitem"),
          ...drawingItem,
        };
      });
      const drawingSet = Object.assign(current, {
        ...parsed,
        drawingItems: nextDrawingItems,
      });
      validateDrawingSetLinks(store, drawingSet);
      ctx.audit(editAction(before, drawingSet), "DrawingSet", drawingSet.id, drawingSet.name, before, drawingSet);
      saveStore();
      response.json(drawingSet);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/drawing-sets/:id/void", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const before = cloneRecord(store.drawingSets.find((record) => record.id === request.params.id));
      voidById(store.drawingSets, request.params.id, request.body?.reason);
      const after = store.drawingSets.find((record) => record.id === request.params.id);
      ctx.audit("Void", "DrawingSet", request.params.id, after ? entityLabel(store, "DrawingSet", after) : request.params.id, before, after, request.body?.reason);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects", (_request, response) => response.json(store.projects));
  app.post("/api/projects", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const parsed = projectSchema.parse({ ...request.body, recordState: "Active" });
      validateProjectLinks(store, parsed);
      const project = { id: nextId("proj"), ...parsed };
      store.projects.push(project);
      syncReusableQuotesForProject(ctx, project);
      ctx.audit("Create", "Case", project.id, project.name, undefined, project);
      saveStore();
      response.status(201).json(project);
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/projects/:id", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      ensureNoProjectLinks(store, request.params.id);
      const before = store.projects.find((record) => record.id === request.params.id);
      deleteById(store.projects, request.params.id, "Case");
      ctx.audit("Delete", "Case", request.params.id, before ? entityLabel(store, "Case", before) : request.params.id, before);
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/projects/:id", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const before = cloneRecord(store.projects.find((record) => record.id === request.params.id));
      const project = updateById(store.projects, request.params.id, request.body, projectSchema.parse);
      validateProjectLinks(store, project);
      syncReusableQuotesForProject(ctx, project);
      ctx.audit(editAction(before, project), "Case", project.id, project.name, before, project);
      response.json(project);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/projects/:id/void", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const before = cloneRecord(store.projects.find((record) => record.id === request.params.id));
      voidById(store.projects, request.params.id, request.body?.reason);
      const after = store.projects.find((record) => record.id === request.params.id);
      ctx.audit("Void", "Case", request.params.id, after ? entityLabel(store, "Case", after) : request.params.id, before, after, request.body?.reason);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/quotes", (_request, response) => response.json(store.quotes));
  app.post("/api/quotes", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const parsed = quoteSchema.parse({ ...request.body, recordState: "Active" });
      validateQuoteLinks(store, parsed);
      checkPriceWindow(store, { id: "", ...parsed });
      const quote = { id: nextId("q"), ...parsed };
      store.quotes.push(quote);
      assignPreviousQuote(store, quote);
      syncCaseFromQuote(ctx, quote);
      buildPriceChangeFromQuote(ctx, quote);
      closePreviousSelectedQuote(store, quote);
      syncReusableQuotesForProjects(ctx);
      ctx.audit("Create", "Quote", quote.id, entityLabel(store, "Quote", quote), undefined, quote, undefined, quote.projectId);
      saveStore();
      response.status(201).json(quote);
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/quotes/:id", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      ensureNoQuoteLinks(store, request.params.id);
      const before = store.quotes.find((record) => record.id === request.params.id);
      deleteById(store.quotes, request.params.id, "Quote");
      ctx.audit("Delete", "Quote", request.params.id, before ? entityLabel(store, "Quote", before) : request.params.id, before);
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/quotes/:id", (request, response, next) => {
    try {
      const ctx = contextFor(request);
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
      saveStore();
      response.json(quote);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/quotes/:id/void", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const before = cloneRecord(store.quotes.find((record) => record.id === request.params.id));
      voidById(store.quotes, request.params.id, request.body?.reason);
      const after = store.quotes.find((record) => record.id === request.params.id);
      ctx.audit("Void", "Quote", request.params.id, after ? entityLabel(store, "Quote", after) : request.params.id, before, after, request.body?.reason, after?.projectId);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/source-assignments", (_request, response) => response.json(store.sourceAssignments));
  app.post("/api/source-assignments", (request, response, next) => {
    try {
      const ctx = contextFor(request);
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
        saveStore();
        response.json(current);
        return;
      }

      const assignment = { id: nextId("assign"), ...parsed };
      store.sourceAssignments.push(assignment);
      demoteConflictingSourceRoles(ctx, assignment);
      ctx.audit("Create", "SourceAssignment", assignment.id, entityLabel(store, "SourceAssignment", assignment), undefined, assignment, undefined, assignment.projectId);
      saveStore();
      response.status(201).json(assignment);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/inspections", (_request, response) => response.json(store.inspections));
  app.post("/api/inspections", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const parsed = inspectionSchema.parse({ ...request.body, recordState: "Active" });
      validateInspectionLinks(store, parsed);
      const inspection = { id: nextId("ins"), ...parsed };
      store.inspections.push(inspection);
      syncQuoteStatusFromInspection(ctx, inspection);
      ctx.audit("Create", "Inspection", inspection.id, entityLabel(store, "Inspection", inspection), undefined, inspection, undefined, inspection.relatedQuoteId);
      saveStore();
      response.status(201).json(inspection);
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/inspections/:id", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const before = store.inspections.find((record) => record.id === request.params.id);
      deleteById(store.inspections, request.params.id, "Inspection");
      ctx.audit("Delete", "Inspection", request.params.id, before ? entityLabel(store, "Inspection", before) : request.params.id, before);
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/inspections/:id", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const before = cloneRecord(store.inspections.find((record) => record.id === request.params.id));
      const inspection = updateById(store.inspections, request.params.id, request.body, inspectionSchema.parse);
      validateInspectionLinks(store, inspection);
      syncQuoteStatusFromInspection(ctx, inspection);
      ctx.audit(editAction(before, inspection), "Inspection", inspection.id, entityLabel(store, "Inspection", inspection), before, inspection, undefined, inspection.relatedQuoteId);
      response.json(inspection);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/inspections/:id/void", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const before = cloneRecord(store.inspections.find((record) => record.id === request.params.id));
      voidById(store.inspections, request.params.id, request.body?.reason);
      const after = store.inspections.find((record) => record.id === request.params.id);
      ctx.audit("Void", "Inspection", request.params.id, after ? entityLabel(store, "Inspection", after) : request.params.id, before, after, request.body?.reason, after?.relatedQuoteId);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/incoming-defects", (_request, response) => response.json(store.incomingDefects));
  app.post("/api/incoming-defects", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const parsed = incomingDefectSchema.parse({ ...request.body, recordState: "Active" });
      normalizeIncomingDefectCompletion(parsed);
      validateIncomingDefectLinks(store, parsed);
      const defect = { id: nextId("def"), ...parsed };
      store.incomingDefects.push(defect);
      ctx.audit("Create", "IncomingDefect", defect.id, entityLabel(store, "IncomingDefect", defect), undefined, defect);
      saveStore();
      response.status(201).json(defect);
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/incoming-defects/:id", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const before = store.incomingDefects.find((record) => record.id === request.params.id);
      deleteById(store.incomingDefects, request.params.id, "Incoming defect");
      ctx.audit("Delete", "IncomingDefect", request.params.id, before ? entityLabel(store, "IncomingDefect", before) : request.params.id, before);
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/incoming-defects/:id", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const before = cloneRecord(store.incomingDefects.find((record) => record.id === request.params.id));
      const defect = updateById(store.incomingDefects, request.params.id, request.body, incomingDefectSchema.parse);
      normalizeIncomingDefectCompletion(defect);
      validateIncomingDefectLinks(store, defect);
      ctx.audit(editAction(before, defect), "IncomingDefect", defect.id, entityLabel(store, "IncomingDefect", defect), before, defect);
      response.json(defect);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/incoming-defects/:id/void", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const before = cloneRecord(store.incomingDefects.find((record) => record.id === request.params.id));
      voidById(store.incomingDefects, request.params.id, request.body?.reason);
      const after = store.incomingDefects.find((record) => record.id === request.params.id);
      ctx.audit("Void", "IncomingDefect", request.params.id, after ? entityLabel(store, "IncomingDefect", after) : request.params.id, before, after, request.body?.reason);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/price-changes", (_request, response) => response.json(store.priceChanges));
  app.post("/api/price-changes", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const parsed = priceChangeSchema.parse(request.body);
      validatePriceChangeLinks(store, parsed);
      const priceChange = { id: nextId("pc"), ...parsed };
      store.priceChanges.push(priceChange);
      ctx.audit("Create", "PriceChange", priceChange.id, entityLabel(store, "PriceChange", priceChange), undefined, priceChange, undefined, priceChange.sourceQuoteId);
      saveStore();
      response.status(201).json(priceChange);
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/price-changes/:id", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const before = store.priceChanges.find((record) => record.id === request.params.id);
      deleteById(store.priceChanges, request.params.id, "Price change");
      ctx.audit("Delete", "PriceChange", request.params.id, before ? entityLabel(store, "PriceChange", before) : request.params.id, before);
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/price-changes/:id", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const before = cloneRecord(store.priceChanges.find((record) => record.id === request.params.id));
      const priceChange = updateById(store.priceChanges, request.params.id, request.body, priceChangeSchema.parse);
      validatePriceChangeLinks(store, priceChange);
      ctx.audit(editAction(before, priceChange), "PriceChange", priceChange.id, entityLabel(store, "PriceChange", priceChange), before, priceChange, undefined, priceChange.sourceQuoteId);
      response.json(priceChange);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/price-changes/:id/void", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const before = cloneRecord(store.priceChanges.find((record) => record.id === request.params.id));
      voidById(store.priceChanges, request.params.id, request.body?.reason);
      const after = store.priceChanges.find((record) => record.id === request.params.id);
      ctx.audit("Void", "PriceChange", request.params.id, after ? entityLabel(store, "PriceChange", after) : request.params.id, before, after, request.body?.reason, after?.sourceQuoteId);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/purchase-prices", (_request, response) => response.json(store.purchasePrices));
  app.post("/api/purchase-prices", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const parsed = purchasePriceSchema.parse(request.body);
      validatePurchasePriceLinks(store, parsed);
      const purchasePrice = { id: nextId("po"), ...parsed };
      store.purchasePrices.push(purchasePrice);
      buildPriceChangeFromPurchase(ctx, purchasePrice);
      saveStore();
      response.status(201).json(purchasePrice);
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/purchase-prices/:id", (request, response, next) => {
    try {
      const purchasePrice = updateById(store.purchasePrices, request.params.id, request.body, purchasePriceSchema.parse);
      validatePurchasePriceLinks(store, purchasePrice);
      response.json(purchasePrice);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/purchase-prices/:id/void", (request, response, next) => {
    try {
      voidById(store.purchasePrices, request.params.id, request.body?.reason);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/purchase-prices/:id", (request, response, next) => {
    try {
      deleteById(store.purchasePrices, request.params.id, "Purchase price");
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:projectId/comparison", (request, response, next) => {
    try {
      const ctx = contextFor(request);
      response.json(buildComparison(ctx, request.params.projectId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/scorecard", (_request, response) => {
    response.json(buildScorecard(store));
  });

  app.get("/api/score-settings", (_request, response) => {
    response.json(store.scoreWeights);
  });

  app.patch("/api/score-settings", requireAdmin, (request, response, next) => {
    try {
      const ctx = contextFor(request);
      const weights = scoreWeightsSchema.parse(request.body);
      const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
      if (total !== 100) throw new ValidationError("Score weights must add up to 100.");
      const before = cloneRecord(store.scoreWeights);
      store.scoreWeights = weights;
      ctx.audit("Edit", "ScoreSettings", "score-settings", "Score settings", before, store.scoreWeights);
      saveStore();
      response.json(store.scoreWeights);
    } catch (error) {
      next(error);
    }
  });

  function deleteById<T extends { id: string }>(records: T[], id: string, label: string) {
    const index = records.findIndex((record) => record.id === id);
    if (index === -1) throw new ValidationError(`${label} not found: ${id}`);
    records.splice(index, 1);
  }

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

  function voidById<T extends { id: string; recordState?: "Draft" | "Active" | "Void"; voidReason?: string }>(
    records: T[],
    id: string,
    reason?: string,
  ) {
    const record = records.find((candidate) => candidate.id === id);
    if (!record) throw new ValidationError(`Record not found: ${id}`);
    record.recordState = "Void";
    record.voidReason = String(reason ?? "").trim() || "Entered in error";
    saveStore();
  }

  serveFrontend(app, join(process.cwd(), "dist"));
  app.use(errorHandler);

  return app;
}
