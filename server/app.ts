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
import { latestInspection, qcAllowsSourceRole } from "./rules";
import { nextId, saveStore, store, ValidationError } from "./store";
import { errorHandler } from "./errorHandler";
import { authRouter } from "./routes/auth";
import { adminRouter } from "./routes/admin";
import { requireAdmin, requireAuth, sessionMiddleware, verifyCsrf } from "./session";
import { appendAuditEntry, listAuditEntries } from "./auditLog";
import { pool } from "./db";
import { setUploadHeaders, uploadFileType } from "./uploads";
import { priceWindowError } from "./priceWindows";

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
      storage: "json-file prototype",
    });
  });

  app.use("/api", requireAuth, verifyCsrf);
  app.use("/uploads", requireAuth, express.static(join(process.cwd(), "uploads"), { setHeaders: setUploadHeaders }));
  app.use("/api/admin", adminRouter);

  app.get("/api/bootstrap", (request, response) => {
    if (syncActivePackagingSetItems(request, store.models.map((model) => model.id), "Bootstrap")) saveStore();
    if (syncActiveCasesForModels(request, store.models.map((model) => model.id), "Bootstrap")) saveStore();
    if (syncReusableQuotesForProjects()) saveStore();
    if (syncQuoteStatusesFromPassedInspections(request)) saveStore();
    if (reconcileQuotePriceChanges()) saveStore();
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
      audit(request, "Upload", "File", file.id, file.fileName, undefined, file, undefined, parsed.linkedRecordId);
      saveStore();
      response.status(201).json(file);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/suppliers", (_request, response) => response.json(store.suppliers));
  app.post("/api/suppliers", (request, response, next) => {
    try {
      const supplier = { id: nextId("sup"), ...supplierSchema.parse(request.body) };
      store.suppliers.push(supplier);
      audit(request, "Create", "Supplier", supplier.id, supplier.name, undefined, supplier);
      saveStore();
      response.status(201).json(supplier);
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/suppliers/:id", (request, response, next) => {
    try {
      ensureNoSupplierLinks(request.params.id);
      const before = store.suppliers.find((record) => record.id === request.params.id);
      deleteById(store.suppliers, request.params.id, "Supplier");
      audit(request, "Delete", "Supplier", request.params.id, before ? entityLabel("Supplier", before) : request.params.id, before);
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/suppliers/:id", (request, response, next) => {
    try {
      const before = cloneRecord(store.suppliers.find((record) => record.id === request.params.id));
      const supplier = updateById(store.suppliers, request.params.id, request.body, supplierSchema.parse);
      audit(request, editAction(before, supplier), "Supplier", supplier.id, supplier.name, before, supplier);
      response.json(supplier);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/suppliers/:id/void", (request, response, next) => {
    try {
      const before = cloneRecord(store.suppliers.find((record) => record.id === request.params.id));
      voidById(store.suppliers, request.params.id, request.body?.reason);
      const after = store.suppliers.find((record) => record.id === request.params.id);
      audit(request, "Void", "Supplier", request.params.id, after ? entityLabel("Supplier", after) : request.params.id, before, after, request.body?.reason);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/models", (_request, response) => response.json(store.models));
  app.post("/api/models", (request, response, next) => {
    try {
      const model = { id: nextId("model"), ...modelSchema.parse(request.body) };
      store.models.push(model);
      audit(request, "Create", "Model", model.id, model.name, undefined, model);
      saveStore();
      response.status(201).json(model);
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/models/:id", (request, response, next) => {
    try {
      ensureNoModelLinks(request.params.id);
      const before = store.models.find((record) => record.id === request.params.id);
      deleteById(store.models, request.params.id, "Model");
      audit(request, "Delete", "Model", request.params.id, before ? entityLabel("Model", before) : request.params.id, before);
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/models/:id", (request, response, next) => {
    try {
      const before = cloneRecord(store.models.find((record) => record.id === request.params.id));
      const model = updateById(store.models, request.params.id, request.body, modelSchema.parse);
      audit(request, editAction(before, model), "Model", model.id, model.name, before, model);
      response.json(model);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/models/:id/void", (request, response, next) => {
    try {
      const before = cloneRecord(store.models.find((record) => record.id === request.params.id));
      voidById(store.models, request.params.id, request.body?.reason);
      const after = store.models.find((record) => record.id === request.params.id);
      audit(request, "Void", "Model", request.params.id, after ? entityLabel("Model", after) : request.params.id, before, after, request.body?.reason);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/items", (_request, response) => response.json(store.items));
  app.post("/api/items", (request, response, next) => {
    try {
      const parsed = itemSchema.parse(request.body);
      ensureUniqueItemCode(parsed.itemCode);
      const item = { id: nextId("item"), ...parsed };
      store.items.push(item);
      syncActivePackagingSetItems(request, item.usedForModels, "Item create");
      syncActiveCasesForModels(request, item.usedForModels, "Item create");
      audit(request, "Create", "Item", item.id, item.itemCode, undefined, item);
      saveStore();
      response.status(201).json(item);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/items/import", (request, response, next) => {
    try {
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
        audit(request, "Import", "Item", item.id, item.itemCode, undefined, item, "Created from item import", item.id, "Import");
        return { action: "created", item };
      });
      const affectedModelIds = Array.from(
        new Set(
          imported
            .flatMap((row) => (row.action === "created" && row.item ? row.item.usedForModels : [])),
        ),
      );
      syncActivePackagingSetItems(request, affectedModelIds, "Item import");
      syncActiveCasesForModels(request, affectedModelIds, "Item import");
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
      ensureNoItemLinks(request.params.id);
      const before = store.items.find((record) => record.id === request.params.id);
      deleteById(store.items, request.params.id, "Item");
      audit(request, "Delete", "Item", request.params.id, before ? entityLabel("Item", before) : request.params.id, before);
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/items/:id", (request, response, next) => {
    try {
      const before = cloneRecord(store.items.find((record) => record.id === request.params.id));
      if (request.body?.itemCode) ensureUniqueItemCode(String(request.body.itemCode), request.params.id);
      const item = updateById(store.items, request.params.id, request.body, itemSchema.parse);
      const affectedModelIds = Array.from(new Set([...(before?.usedForModels ?? []), ...item.usedForModels]));
      syncActivePackagingSetItems(request, affectedModelIds, "Item edit");
      syncActiveCasesForModels(request, affectedModelIds, "Item edit");
      audit(request, before?.recordState === "Draft" && item.recordState === "Active" ? "Approve" : editAction(before, item), "Item", item.id, item.itemCode, before, item);
      saveStore();
      response.json(item);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/items/:id/void", (request, response, next) => {
    try {
      const before = cloneRecord(store.items.find((record) => record.id === request.params.id));
      voidById(store.items, request.params.id, request.body?.reason);
      const after = store.items.find((record) => record.id === request.params.id);
      syncActivePackagingSetItems(request, before?.usedForModels ?? after?.usedForModels ?? [], "Item void");
      syncActiveCasesForModels(request, before?.usedForModels ?? after?.usedForModels ?? [], "Item void");
      audit(request, "Void", "Item", request.params.id, after ? entityLabel("Item", after) : request.params.id, before, after, request.body?.reason);
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/drawing-sets", (_request, response) => response.json(store.drawingSets));
  app.post("/api/drawing-sets", (request, response, next) => {
    try {
      const modelId = String(request.body?.modelId ?? "");
      const generatedRevision = nextDrawingSetRevision(modelId);
      const parsed = drawingSetSchema.parse({
        ...request.body,
        revision: generatedRevision,
        drawingItems: (request.body?.drawingItems ?? []).map((drawingItem: Record<string, unknown>) => ({
          ...drawingItem,
          revision: generatedRevision,
        })),
      });
      validateDrawingSetLinks(parsed);
      if (request.body?.replaceActive && parsed.status === "Active") {
        for (const drawingSet of store.drawingSets) {
          if (drawingSet.modelId === parsed.modelId && drawingSet.status === "Active") {
            const before = cloneRecord(drawingSet);
            drawingSet.status = "Superseded";
            audit(request, "Status Change", "DrawingSet", drawingSet.id, drawingSet.name, before, drawingSet, "Replaced by newer active drawing set");
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
      audit(request, "Create", "DrawingSet", drawingSet.id, drawingSet.name, undefined, drawingSet);
      saveStore();
      response.status(201).json(drawingSet);
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/drawing-sets/:id", (request, response, next) => {
    try {
      ensureNoDrawingSetLinks(request.params.id);
      const before = store.drawingSets.find((record) => record.id === request.params.id);
      deleteById(store.drawingSets, request.params.id, "Drawing set");
      audit(request, "Delete", "DrawingSet", request.params.id, before ? entityLabel("DrawingSet", before) : request.params.id, before);
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/drawing-sets/:id", (request, response, next) => {
    try {
      const current = store.drawingSets.find((record) => record.id === request.params.id);
      if (!current) throw new ValidationError(`Record not found: ${request.params.id}`);
      const before = cloneRecord(current);
      const requestedDrawingItems = Array.isArray(request.body?.drawingItems)
        ? request.body.drawingItems
        : current.drawingItems;
      const parsed = drawingSetSchema.parse({
        ...current,
        ...request.body,
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
      validateDrawingSetLinks(drawingSet);
      audit(request, editAction(before, drawingSet), "DrawingSet", drawingSet.id, drawingSet.name, before, drawingSet);
      saveStore();
      response.json(drawingSet);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/drawing-sets/:id/void", (request, response, next) => {
    try {
      const before = cloneRecord(store.drawingSets.find((record) => record.id === request.params.id));
      voidById(store.drawingSets, request.params.id, request.body?.reason);
      const after = store.drawingSets.find((record) => record.id === request.params.id);
      audit(request, "Void", "DrawingSet", request.params.id, after ? entityLabel("DrawingSet", after) : request.params.id, before, after, request.body?.reason);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects", (_request, response) => response.json(store.projects));
  app.post("/api/projects", (request, response, next) => {
    try {
      const parsed = projectSchema.parse({ ...request.body, recordState: "Active" });
      validateProjectLinks(parsed);
      const project = { id: nextId("proj"), ...parsed };
      store.projects.push(project);
      syncReusableQuotesForProject(project);
      audit(request, "Create", "Case", project.id, project.name, undefined, project);
      saveStore();
      response.status(201).json(project);
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/projects/:id", (request, response, next) => {
    try {
      ensureNoProjectLinks(request.params.id);
      const before = store.projects.find((record) => record.id === request.params.id);
      deleteById(store.projects, request.params.id, "Case");
      audit(request, "Delete", "Case", request.params.id, before ? entityLabel("Case", before) : request.params.id, before);
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/projects/:id", (request, response, next) => {
    try {
      const before = cloneRecord(store.projects.find((record) => record.id === request.params.id));
      const project = updateById(store.projects, request.params.id, request.body, projectSchema.parse);
      validateProjectLinks(project);
      syncReusableQuotesForProject(project);
      audit(request, editAction(before, project), "Case", project.id, project.name, before, project);
      response.json(project);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/projects/:id/void", (request, response, next) => {
    try {
      const before = cloneRecord(store.projects.find((record) => record.id === request.params.id));
      voidById(store.projects, request.params.id, request.body?.reason);
      const after = store.projects.find((record) => record.id === request.params.id);
      audit(request, "Void", "Case", request.params.id, after ? entityLabel("Case", after) : request.params.id, before, after, request.body?.reason);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/quotes", (_request, response) => response.json(store.quotes));
  app.post("/api/quotes", (request, response, next) => {
    try {
      const parsed = quoteSchema.parse({ ...request.body, recordState: "Active" });
      validateQuoteLinks(parsed);
      checkPriceWindow({ id: "", ...parsed });
      const quote = { id: nextId("q"), ...parsed };
      store.quotes.push(quote);
      assignPreviousQuote(quote);
      syncCaseFromQuote(quote);
      buildPriceChangeFromQuote(quote);
      closePreviousSelectedQuote(quote);
      syncReusableQuotesForProjects();
      audit(request, "Create", "Quote", quote.id, entityLabel("Quote", quote), undefined, quote, undefined, quote.projectId);
      saveStore();
      response.status(201).json(quote);
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/quotes/:id", (request, response, next) => {
    try {
      ensureNoQuoteLinks(request.params.id);
      const before = store.quotes.find((record) => record.id === request.params.id);
      deleteById(store.quotes, request.params.id, "Quote");
      audit(request, "Delete", "Quote", request.params.id, before ? entityLabel("Quote", before) : request.params.id, before);
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/quotes/:id", (request, response, next) => {
    try {
      // changeReason explains a changed Effective To in the audit trail; it is not stored on the quote.
      const { changeReason, ...patch } = request.body ?? {};
      const reason = typeof changeReason === "string" && changeReason.trim() ? changeReason.trim() : undefined;
      const before = cloneRecord(store.quotes.find((record) => record.id === request.params.id));
      if (before) checkPriceWindow({ ...quoteSchema.parse({ ...before, ...patch }), id: before.id }, before, reason);
      const quote = updateById(store.quotes, request.params.id, patch, quoteSchema.parse);
      validateQuoteLinks(quote);
      assignPreviousQuote(quote);
      syncCaseFromQuote(quote);
      buildPriceChangeFromQuote(quote);
      closePreviousSelectedQuote(quote);
      syncReusableQuotesForProjects();
      audit(request, editAction(before, quote), "Quote", quote.id, entityLabel("Quote", quote), before, quote, reason, quote.projectId);
      saveStore();
      response.json(quote);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/quotes/:id/void", (request, response, next) => {
    try {
      const before = cloneRecord(store.quotes.find((record) => record.id === request.params.id));
      voidById(store.quotes, request.params.id, request.body?.reason);
      const after = store.quotes.find((record) => record.id === request.params.id);
      audit(request, "Void", "Quote", request.params.id, after ? entityLabel("Quote", after) : request.params.id, before, after, request.body?.reason, after?.projectId);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/source-assignments", (_request, response) => response.json(store.sourceAssignments));
  app.post("/api/source-assignments", (request, response, next) => {
    try {
      const parsed = sourceAssignmentSchema.parse({ ...request.body, recordState: "Active" });
      ensureSourceAssignmentLinks(parsed);
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
        demoteConflictingSourceRoles(request, current);
        audit(request, "Edit", "SourceAssignment", current.id, entityLabel("SourceAssignment", current), before, current, undefined, current.projectId);
        saveStore();
        response.json(current);
        return;
      }

      const assignment = { id: nextId("assign"), ...parsed };
      store.sourceAssignments.push(assignment);
      demoteConflictingSourceRoles(request, assignment);
      audit(request, "Create", "SourceAssignment", assignment.id, entityLabel("SourceAssignment", assignment), undefined, assignment, undefined, assignment.projectId);
      saveStore();
      response.status(201).json(assignment);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/inspections", (_request, response) => response.json(store.inspections));
  app.post("/api/inspections", (request, response, next) => {
    try {
      const parsed = inspectionSchema.parse({ ...request.body, recordState: "Active" });
      validateInspectionLinks(parsed);
      const inspection = { id: nextId("ins"), ...parsed };
      store.inspections.push(inspection);
      syncQuoteStatusFromInspection(request, inspection);
      audit(request, "Create", "Inspection", inspection.id, entityLabel("Inspection", inspection), undefined, inspection, undefined, inspection.relatedQuoteId);
      saveStore();
      response.status(201).json(inspection);
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/inspections/:id", (request, response, next) => {
    try {
      const before = store.inspections.find((record) => record.id === request.params.id);
      deleteById(store.inspections, request.params.id, "Inspection");
      audit(request, "Delete", "Inspection", request.params.id, before ? entityLabel("Inspection", before) : request.params.id, before);
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/inspections/:id", (request, response, next) => {
    try {
      const before = cloneRecord(store.inspections.find((record) => record.id === request.params.id));
      const inspection = updateById(store.inspections, request.params.id, request.body, inspectionSchema.parse);
      validateInspectionLinks(inspection);
      syncQuoteStatusFromInspection(request, inspection);
      audit(request, editAction(before, inspection), "Inspection", inspection.id, entityLabel("Inspection", inspection), before, inspection, undefined, inspection.relatedQuoteId);
      response.json(inspection);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/inspections/:id/void", (request, response, next) => {
    try {
      const before = cloneRecord(store.inspections.find((record) => record.id === request.params.id));
      voidById(store.inspections, request.params.id, request.body?.reason);
      const after = store.inspections.find((record) => record.id === request.params.id);
      audit(request, "Void", "Inspection", request.params.id, after ? entityLabel("Inspection", after) : request.params.id, before, after, request.body?.reason, after?.relatedQuoteId);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  function syncQuoteStatusesFromPassedInspections(request: Request) {
    let changed = false;
    for (const inspection of store.inspections) {
      if (inspection.recordState !== "Void") changed = syncQuoteStatusFromInspection(request, inspection) || changed;
    }
    return changed;
  }

  function syncQuoteStatusFromInspection(request: Request, inspection: { relatedQuoteId?: string; result: string }) {
    if (!inspection.relatedQuoteId || inspection.result !== "Pass") return false;
    const quote = store.quotes.find((candidate) => candidate.id === inspection.relatedQuoteId && candidate.recordState !== "Void");
    if (!quote || quote.status === "Selected") return false;
    const before = cloneRecord(quote);
    quote.status = "Selected";
    assignPreviousQuote(quote);
    buildPriceChangeFromQuote(quote);
    closePreviousSelectedQuote(quote);
    syncCaseFromQuote(quote);
    syncReusableQuotesForProjects();
    audit(
      request,
      "Status Change",
      "Quote",
      quote.id,
      entityLabel("Quote", quote),
      before,
      quote,
      "Sample inspection passed; quote selected automatically.",
      quote.projectId,
      "System",
    );
    return true;
  }

  app.get("/api/incoming-defects", (_request, response) => response.json(store.incomingDefects));
  app.post("/api/incoming-defects", (request, response, next) => {
    try {
      const parsed = incomingDefectSchema.parse({ ...request.body, recordState: "Active" });
      normalizeIncomingDefectCompletion(parsed);
      validateIncomingDefectLinks(parsed);
      const defect = { id: nextId("def"), ...parsed };
      store.incomingDefects.push(defect);
      audit(request, "Create", "IncomingDefect", defect.id, entityLabel("IncomingDefect", defect), undefined, defect);
      saveStore();
      response.status(201).json(defect);
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/incoming-defects/:id", (request, response, next) => {
    try {
      const before = store.incomingDefects.find((record) => record.id === request.params.id);
      deleteById(store.incomingDefects, request.params.id, "Incoming defect");
      audit(request, "Delete", "IncomingDefect", request.params.id, before ? entityLabel("IncomingDefect", before) : request.params.id, before);
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/incoming-defects/:id", (request, response, next) => {
    try {
      const before = cloneRecord(store.incomingDefects.find((record) => record.id === request.params.id));
      const defect = updateById(store.incomingDefects, request.params.id, request.body, incomingDefectSchema.parse);
      normalizeIncomingDefectCompletion(defect);
      validateIncomingDefectLinks(defect);
      audit(request, editAction(before, defect), "IncomingDefect", defect.id, entityLabel("IncomingDefect", defect), before, defect);
      response.json(defect);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/incoming-defects/:id/void", (request, response, next) => {
    try {
      const before = cloneRecord(store.incomingDefects.find((record) => record.id === request.params.id));
      voidById(store.incomingDefects, request.params.id, request.body?.reason);
      const after = store.incomingDefects.find((record) => record.id === request.params.id);
      audit(request, "Void", "IncomingDefect", request.params.id, after ? entityLabel("IncomingDefect", after) : request.params.id, before, after, request.body?.reason);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/price-changes", (_request, response) => response.json(store.priceChanges));
  app.post("/api/price-changes", (request, response, next) => {
    try {
      const parsed = priceChangeSchema.parse(request.body);
      validatePriceChangeLinks(parsed);
      const priceChange = { id: nextId("pc"), ...parsed };
      store.priceChanges.push(priceChange);
      audit(request, "Create", "PriceChange", priceChange.id, entityLabel("PriceChange", priceChange), undefined, priceChange, undefined, priceChange.sourceQuoteId);
      saveStore();
      response.status(201).json(priceChange);
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/price-changes/:id", (request, response, next) => {
    try {
      const before = store.priceChanges.find((record) => record.id === request.params.id);
      deleteById(store.priceChanges, request.params.id, "Price change");
      audit(request, "Delete", "PriceChange", request.params.id, before ? entityLabel("PriceChange", before) : request.params.id, before);
      saveStore();
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/price-changes/:id", (request, response, next) => {
    try {
      const before = cloneRecord(store.priceChanges.find((record) => record.id === request.params.id));
      const priceChange = updateById(store.priceChanges, request.params.id, request.body, priceChangeSchema.parse);
      validatePriceChangeLinks(priceChange);
      audit(request, editAction(before, priceChange), "PriceChange", priceChange.id, entityLabel("PriceChange", priceChange), before, priceChange, undefined, priceChange.sourceQuoteId);
      response.json(priceChange);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/price-changes/:id/void", (request, response, next) => {
    try {
      const before = cloneRecord(store.priceChanges.find((record) => record.id === request.params.id));
      voidById(store.priceChanges, request.params.id, request.body?.reason);
      const after = store.priceChanges.find((record) => record.id === request.params.id);
      audit(request, "Void", "PriceChange", request.params.id, after ? entityLabel("PriceChange", after) : request.params.id, before, after, request.body?.reason, after?.sourceQuoteId);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/purchase-prices", (_request, response) => response.json(store.purchasePrices));
  app.post("/api/purchase-prices", (request, response, next) => {
    try {
      const parsed = purchasePriceSchema.parse(request.body);
      validatePurchasePriceLinks(parsed);
      const purchasePrice = { id: nextId("po"), ...parsed };
      store.purchasePrices.push(purchasePrice);
      buildPriceChangeFromPurchase(purchasePrice);
      saveStore();
      response.status(201).json(purchasePrice);
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/purchase-prices/:id", (request, response, next) => {
    try {
      const purchasePrice = updateById(store.purchasePrices, request.params.id, request.body, purchasePriceSchema.parse);
      validatePurchasePriceLinks(purchasePrice);
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
      response.json(buildComparison(request.params.projectId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/scorecard", (_request, response) => {
    response.json(buildScorecard());
  });

  app.get("/api/score-settings", (_request, response) => {
    response.json(store.scoreWeights);
  });

  app.patch("/api/score-settings", requireAdmin, (request, response, next) => {
    try {
      const weights = scoreWeightsSchema.parse(request.body);
      const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
      if (total !== 100) throw new ValidationError("Score weights must add up to 100.");
      const before = cloneRecord(store.scoreWeights);
      store.scoreWeights = weights;
      audit(request, "Edit", "ScoreSettings", "score-settings", "Score settings", before, store.scoreWeights);
      saveStore();
      response.json(store.scoreWeights);
    } catch (error) {
      next(error);
    }
  });

  type AuditAction = "Create" | "Edit" | "Status Change" | "Upload" | "Void" | "Delete" | "Approve" | "Import";

  function audit(
    request: Request,
    action: AuditAction,
    entityType: string,
    entityId: string,
    entityLabel: string,
    before?: unknown,
    after?: unknown,
    reason?: string,
    linkedRecordId?: string,
    source: "UI" | "Import" | "System" = "UI",
  ) {
    const diff = compactDiff(before, after);
    const actor = source === "System" ? undefined : request.user;
    void appendAuditEntry(pool, {
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
    }).catch((error) => console.error("Failed to write audit entry:", error));
  }

  function cloneRecord<T>(record: T | undefined): T | undefined {
    return record ? structuredClone(record) : undefined;
  }

  function editAction(before: unknown, after: unknown): AuditAction {
    const beforeRecord = isPlainRecord(before) ? before : undefined;
    const afterRecord = isPlainRecord(after) ? after : {};
    if (beforeRecord?.status !== afterRecord.status && afterRecord.status) return "Status Change";
    if (beforeRecord?.result !== afterRecord.result && afterRecord.result) return "Status Change";
    if (beforeRecord?.recordState === "Draft" && afterRecord.recordState === "Active") return "Approve";
    return "Edit";
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

  function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function checkPriceWindow(quote: Quote, before?: Quote, changeReason?: string) {
    const error = priceWindowError(quote, store.quotes, {
      before,
      changeReason,
      describe: (conflict) => `the ${conflict.currency} ${conflict.unitPrice} quote ${conflict.id}`,
    });
    if (error) throw new ValidationError(error);
  }

  function entityLabel(entityType: string, record: unknown) {
    const recordValue = isPlainRecord(record) ? record : {};
    if (entityType === "Supplier") return String(recordValue.name ?? recordValue.id);
    if (entityType === "Model") return String(recordValue.name ?? recordValue.id);
    if (entityType === "Item") return String(recordValue.itemCode ?? recordValue.id);
    if (entityType === "DrawingSet") return String(recordValue.name ?? recordValue.id);
    if (entityType === "Case") return String(recordValue.name ?? recordValue.id);
    if (entityType === "Quote") return `${findSupplierName(recordValue.supplierId)} / ${findItemCode(recordValue.itemId)}`;
    if (entityType === "Inspection") return `${findSupplierName(recordValue.supplierId)} / ${findItemCode(recordValue.itemId)} / Round ${recordValue.sampleRound ?? 1}`;
    if (entityType === "IncomingDefect") return `${findSupplierName(recordValue.supplierId)} / ${findItemCode(recordValue.itemId)} / ${recordValue.defectDate}`;
    if (entityType === "PriceChange") return `${findSupplierName(recordValue.supplierId)} / ${findItemCode(recordValue.itemId)} price change`;
    if (entityType === "SourceAssignment") return `${findSupplierName(recordValue.supplierId)} / ${findItemCode(recordValue.itemId)} / ${recordValue.role ?? "source role"}`;
    return String(recordValue.id ?? entityType);
  }

  function findSupplierName(id: unknown) {
    return store.suppliers.find((supplier) => supplier.id === id)?.name ?? "Unknown supplier";
  }

  function findItemCode(id: unknown) {
    return store.items.find((item) => item.id === id)?.itemCode ?? "Unknown item";
  }

  function nextDrawingSetRevision(modelId: string) {
    const existingCount = store.drawingSets.filter(
      (drawingSet) => drawingSet.modelId === modelId && drawingSet.recordState !== "Void",
    ).length;
    return `${existingCount + 1}.0`;
  }

  function syncActivePackagingSetItems(request: Request, modelIds: string[], reason: string) {
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
          id: existing?.id ?? nextId("dwgitem"),
          itemId: item.id,
          revision: drawingSet.revision,
          status: "Active",
          drawingSource: "Package PDF",
          fileName: undefined,
          fileId: undefined,
        };
      });
      validateDrawingSetLinks(drawingSet);
      audit(
        request,
        "Edit",
        "DrawingSet",
        drawingSet.id,
        drawingSet.name,
        before,
        drawingSet,
        `${reason}: synced package coverage to active items for ${entityLabel("Model", store.models.find((model) => model.id === drawingSet.modelId))}`,
        undefined,
        "System",
      );
      changed = true;
    }

    return changed;
  }

  function syncActiveCasesForModels(request: Request, modelIds: string[], reason: string) {
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
        syncReusableQuotesForProject(project);
        continue;
      }

      const before = cloneRecord(project);
      project.itemIds = Array.from(new Set([...project.itemIds, ...missingItemIds]));
      syncReusableQuotesForProject(project);
      audit(
        request,
        "Edit",
        "Case",
        project.id,
        project.name,
        before,
        project,
        `${reason}: synced case items from active packaging set`,
        project.id,
        "System",
      );
      changed = true;
    }

    return changed;
  }

  function ensureSourceAssignmentLinks(record: {
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
      if (quote.modelId !== record.modelId && !store.items.find((item) => item.id === record.itemId)?.usedForModels.includes(record.modelId)) {
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

  function demoteConflictingSourceRoles(request: Request, current: {
    id: string;
    projectId?: string;
    modelId: string;
    itemId: string;
    role: string;
  }) {
    if (!["Primary", "Secondary", "Tertiary"].includes(current.role)) return;
    for (const assignment of store.sourceAssignments) {
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
        audit(request, "Edit", "SourceAssignment", assignment.id, entityLabel("SourceAssignment", assignment), before, assignment, `Demoted because another supplier was set as ${current.role}`, assignment.projectId, "System");
      }
    }
  }

  function ensureUniqueItemCode(itemCode: string, currentItemId?: string) {
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

  function deleteById<T extends { id: string }>(records: T[], id: string, label: string) {
    const index = records.findIndex((record) => record.id === id);
    if (index === -1) throw new ValidationError(`${label} not found: ${id}`);
    records.splice(index, 1);
  }

  function updateById<T extends { id: string }>(
    records: T[],
    id: string,
    patch: Partial<T>,
    parse: (value: unknown) => Omit<T, "id">,
  ) {
    const index = records.findIndex((record) => record.id === id);
    if (index === -1) throw new ValidationError(`Record not found: ${id}`);
    const nextRecord = { ...records[index], ...patch, id };
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

  function blockDelete(label: string, links: string[]) {
    const activeLinks = links.filter(Boolean);
    if (activeLinks.length > 0) {
      throw new ValidationError(`Cannot delete ${label}: linked to ${activeLinks.join(", ")}.`);
    }
  }

  function ensureNoSupplierLinks(id: string) {
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

  function ensureNoModelLinks(id: string) {
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

  function ensureNoItemLinks(id: string) {
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

  function ensureNoDrawingSetLinks(id: string) {
    blockDelete("drawing set", [
      store.projects.some((project) => project.drawingSetId === id) ? "development cases" : "",
      store.quotes.some((quote) => quote.drawingSetId === id) ? "quotes" : "",
      store.inspections.some((inspection) => inspection.drawingSetId === id) ? "sample inspections" : "",
    ]);
  }

  function ensureNoProjectLinks(id: string) {
    blockDelete("case", [
      store.quotes.some((quote) => quote.projectId === id) ? "quotes" : "",
      store.quoteCaseLinks.some((link) => link.projectId === id) ? "case quote links" : "",
      store.inspections.some((inspection) => inspection.projectId === id) ? "sample inspections" : "",
      store.sourceAssignments.some((assignment) => assignment.projectId === id) ? "source assignments" : "",
    ]);
  }

  function ensureNoQuoteLinks(id: string) {
    blockDelete("quote", [
      store.quotes.some((quote) => quote.previousQuoteId === id) ? "later quotes" : "",
      store.quoteCaseLinks.some((link) => link.quoteId === id) ? "case quote links" : "",
      store.inspections.some((inspection) => inspection.relatedQuoteId === id) ? "sample inspections" : "",
      store.priceChanges.some((change) => change.sourceQuoteId === id || change.previousQuoteId === id) ? "price changes" : "",
      store.purchasePrices.some((purchase) => purchase.linkedQuoteId === id) ? "purchase prices" : "",
      store.sourceAssignments.some((assignment) => assignment.sourceQuoteId === id) ? "source assignments" : "",
    ]);
  }

  app.use(errorHandler);

  return app;
}
