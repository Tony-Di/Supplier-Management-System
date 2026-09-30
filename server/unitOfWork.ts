import { isDeepStrictEqual } from "node:util";
import type { Request, RequestHandler } from "express";

import { appendAuditEntry } from "./auditLog";
import { createContext, type RequestContext } from "./context";
import { transaction } from "./db";
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
      body = await transaction(async (client) => handler(await loadStore(client), request), "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    } catch (error) {
      next(error);
      return;
    }
    response.json(body);
  };
}
