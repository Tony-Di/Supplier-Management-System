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
