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
