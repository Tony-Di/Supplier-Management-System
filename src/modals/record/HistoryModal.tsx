import { useAppData } from "../../AppDataContext";
import { EmptyState } from "../../components/EmptyState";
import { formatAuditDate } from "../../lib/format";
import { StatusPill } from "../../components/StatusPill";
import { AuditDiff } from "./RecordDetailModal";

export function HistoryModal({
  entityId,
  entityType,
  label,
  onClose,
}: {
  entityId: string;
  entityType: string;
  label: string;
  onClose: () => void;
}) {
  const { data: appData } = useAppData();
  const records = appData.auditLogs
    .filter((record) => record.entityType === entityType && record.entityId === entityId)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return (
    <div className="modalBackdrop" role="presentation">
      <section className="modalPanel historyModal">
        <div className="modalHeader">
          <div>
            <h2>History</h2>
            <p>{label}</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        {records.length === 0 ? (
          <div className="historyEmpty">
            <EmptyState text="No history has been recorded for this record yet." />
          </div>
        ) : (
          <div className="historyList">
            {records.map((record) => (
              <article className="historyRow" key={record.id}>
                <div className="historyRowHeader">
                  <div>
                    <strong>{record.action}</strong>
                    <span>{formatAuditDate(record.timestamp)} by {record.actor}</span>
                  </div>
                  <StatusPill label={record.source} />
                </div>
                {record.reason && <p className="historyReason">{record.reason}</p>}
                <AuditDiff record={record} />
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
