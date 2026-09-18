import type { PoolClient } from "pg";

export interface AuditEntry {
  timestamp: string;
  actorUserId: number | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  source: "UI" | "Import" | "System";
  linkedRecordId?: string;
}

type Executor = Pick<PoolClient, "query">;

const COLUMNS = `id, timestamp, actor_user_id, actor_label, action, entity_type, entity_id, entity_label, before, after, reason, source, linked_record_id`;

function toEntry(row: Record<string, unknown>): AuditEntry & { id: number } {
  return {
    id: Number(row.id),
    timestamp: (row.timestamp as Date).toISOString(),
    actorUserId: (row.actor_user_id as number | null) ?? null,
    actorLabel: row.actor_label as string,
    action: row.action as string,
    entityType: row.entity_type as string,
    entityId: row.entity_id as string,
    entityLabel: row.entity_label as string,
    before: row.before ?? undefined,
    after: row.after ?? undefined,
    reason: (row.reason as string | null) ?? undefined,
    source: row.source as AuditEntry["source"],
    linkedRecordId: (row.linked_record_id as string | null) ?? undefined,
  };
}

export async function appendAuditEntry(db: Executor, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs(timestamp, actor_user_id, actor_label, action, entity_type, entity_id, entity_label, before, after, reason, source, linked_record_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      entry.timestamp, entry.actorUserId, entry.actorLabel, entry.action, entry.entityType, entry.entityId,
      entry.entityLabel, entry.before ?? null, entry.after ?? null, entry.reason ?? null, entry.source,
      entry.linkedRecordId ?? null,
    ],
  );
}

export async function listAuditEntries(
  db: Executor,
  filter: { entityType?: string; entityId?: string; actorUserId?: number; limit?: number } = {},
): Promise<(AuditEntry & { id: number })[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  for (const [column, value] of [["entity_type", filter.entityType], ["entity_id", filter.entityId], ["actor_user_id", filter.actorUserId]] as const) {
    if (value !== undefined) {
      params.push(value);
      conditions.push(`${column} = $${params.length}`);
    }
  }
  params.push(Math.min(filter.limit ?? 200, 1000));
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM audit_logs ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY timestamp DESC, id DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(toEntry);
}

export async function countAuditEntries(db: Executor): Promise<{ rows: number; bytes: number }> {
  const { rows } = await db.query(
    "SELECT count(*)::int AS rows, pg_total_relation_size('audit_logs')::bigint AS bytes FROM audit_logs",
  );
  return { rows: rows[0].rows as number, bytes: Number(rows[0].bytes) };
}
