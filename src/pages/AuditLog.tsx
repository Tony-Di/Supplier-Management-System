import { useEffect, useState } from "react";
import { fetchAuditEntries, fetchUsers, type AdminUser } from "../api";
import { useSession } from "../SessionContext";
import { ErrorNotice } from "../components/ErrorNotice";
import { Panel } from "../components/Panel";
import { TableToolbar } from "../components/TableToolbar";
import { AuditDiff } from "../modals/record/RecordDetailModal";
import { formatAuditDate } from "../lib/format";
import type { AuditLogRecord } from "../types";

const recordTypes = [
  ["Supplier", "Supplier"], ["Model", "Model"], ["Item", "Item"],
  ["DrawingSet", "Packaging set"], ["Case", "Development case"], ["Quote", "Quote"],
  ["SourceAssignment", "Source assignment"], ["Inspection", "Sample inspection"],
  ["IncomingDefect", "Incoming defect"], ["PriceChange", "Price change"],
  ["PurchasePrice", "Purchase price"], ["ScoreSettings", "Score settings"], ["File", "File"],
];

export function AuditLog() {
  const { user } = useSession();
  return user?.role === "admin" ? <AuditLogContent /> : null;
}

function AuditLogContent() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [entries, setEntries] = useState<AuditLogRecord[]>([]);
  const [actorUserId, setActorUserId] = useState("");
  const [entityType, setEntityType] = useState("");
  const [limit, setLimit] = useState(200);
  const [loading, setLoading] = useState(true);
  const [usersError, setUsersError] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setUsersError("");
    fetchUsers().then((records) => { if (!cancelled) setUsers(records); }).catch((requestError) => {
      if (!cancelled) setUsersError(requestError instanceof Error ? requestError.message : "Unable to load the user filter.");
    });
    return () => { cancelled = true; };
  }, [revision]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchAuditEntries({ entityType: entityType || undefined, actorUserId: actorUserId ? Number(actorUserId) : undefined, limit })
      .then((records) => { if (!cancelled) setEntries(records); })
      .catch((requestError) => {
        if (!cancelled) { setEntries([]); setError(requestError instanceof Error ? requestError.message : "Unable to load audit entries."); }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [actorUserId, entityType, limit, revision]);

  return (
    <div className="adminPage">
      <TableToolbar title="Audit log" extraActions={
        <div className="auditFilters">
          <label>User<select value={actorUserId} onChange={(event) => setActorUserId(event.target.value)}>
            <option value="">All users and system</option>
            {users.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({entry.email})</option>)}
          </select></label>
          <label>Record type<select value={entityType} onChange={(event) => setEntityType(event.target.value)}>
            <option value="">All record types</option>
            {recordTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>Limit<select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
            {[50, 100, 200, 500, 1000].map((value) => <option key={value} value={value}>Latest {value}</option>)}
          </select></label>
          <button className="ghostButton" type="button" disabled={loading} onClick={() => setRevision((value) => value + 1)}>Refresh</button>
        </div>
      } />
      <ErrorNotice message={usersError} title="User filter unavailable" />
      <ErrorNotice message={error} title="Audit log unavailable" />
      <Panel title="Activity" actions={<span className="recordCount" role="status">{loading ? "Loading…" : error ? "Unavailable" : `${entries.length.toLocaleString()} entries · newest first`}</span>}>
        <div className="tableViewport" aria-busy={loading}>
          <table className="auditLogTable">
            <thead><tr><th scope="col">Time</th><th scope="col">User</th><th scope="col">Action</th><th scope="col">Record</th><th scope="col">Change</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={5}>Loading audit entries…</td></tr> : error ? <tr><td colSpan={5}>Audit entries could not be loaded. Try Refresh.</td></tr> : entries.length === 0 ? <tr><td colSpan={5}>No activity matches these filters.</td></tr> : entries.map((entry) => (
                <tr key={entry.id}>
                  <td><time dateTime={entry.timestamp}>{formatAuditDate(entry.timestamp)}</time></td>
                  <td>{entry.actorLabel}<span className="adminMeta">{entry.source}</span></td>
                  <td>{entry.action}</td>
                  <td><strong>{entry.entityLabel || entry.entityId}</strong><span className="adminMeta">{recordTypes.find(([value]) => value === entry.entityType)?.[1] ?? entry.entityType} · {entry.entityId}</span></td>
                  <td>
                    <details className="auditChanges">
                      <summary>View changes</summary>
                      <div className="auditDiffHeading"><span>Field</span><span>Before</span><span>After</span></div>
                      <AuditDiff record={entry} />
                    </details>
                    {entry.reason && <p className="historyReason">{entry.reason}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <p className="adminHint">Historical and system activity is included under “All users and system”. Showing up to {limit.toLocaleString()} matching entries.</p>
    </div>
  );
}
