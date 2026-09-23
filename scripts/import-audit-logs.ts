import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { appendAuditEntry, countAuditEntries } from "../server/auditLog.js";
import { pool, transaction } from "../server/db.js";

const storePath = resolve(process.cwd(), "data", "store.json");
const store = JSON.parse(readFileSync(storePath, "utf8")) as { auditLogs?: Record<string, unknown>[] };
const entries = store.auditLogs ?? [];

try {
  // Refuse to run twice: appending a second copy on top of an already-populated
  // table would silently double the history, and nothing downstream would notice.
  const existing = await countAuditEntries(pool);
  if (existing.rows > 0) {
    console.error(
      `Refusing to import: audit_logs already has ${existing.rows} row(s), which means this ` +
        `script has already completed successfully. Re-running would duplicate history. If you ` +
        `deliberately need to redo the import, back up and truncate audit_logs yourself first.`,
    );
    process.exitCode = 1;
  } else {
    // Snapshot the store BEFORE any modification, so the original 61 entries are
    // recoverable even if something goes wrong partway through the import.
    const backupPath = `${storePath}.pre-audit-import.bak`;
    writeFileSync(backupPath, JSON.stringify(store, null, 2));

    // All 61 inserts share one transaction: a failure partway through rolls
    // back to zero rows instead of leaving a partial import behind, so the
    // script can simply be re-run rather than requiring a manual truncate.
    await transaction(async (client) => {
      for (const entry of entries) {
        await appendAuditEntry(client, {
          timestamp: String(entry.timestamp),
          actorUserId: null,
          actorLabel: String(entry.actor ?? "System"),
          action: String(entry.action),
          entityType: String(entry.entityType),
          entityId: String(entry.entityId),
          entityLabel: String(entry.entityLabel ?? entry.entityId),
          before: entry.before,
          after: entry.after,
          reason: entry.reason as string | undefined,
          source: (entry.source as "UI" | "Import" | "System") ?? "UI",
          linkedRecordId: entry.linkedRecordId as string | undefined,
        });
      }
    });

    // Only rewrite the store once the inserts have committed.
    const { auditLogs: _auditLogs, ...rest } = store;
    writeFileSync(storePath, `${JSON.stringify({ ...rest, auditLogs: [] }, null, 2)}\n`);
    console.log(`Imported ${entries.length} audit entries. Previous store saved as ${backupPath}`);
  }
} finally {
  await pool.end();
}
