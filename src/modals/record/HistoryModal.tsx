import { useEffect, useState } from "react";
import { fetchAuditLogs } from "../../api";
import { EmptyState } from "../../components/EmptyState";
import { formatAuditDate } from "../../lib/format";
import { StatusPill } from "../../components/StatusPill";
import { AuditDiff } from "./RecordDetailModal";
import { type AuditLogRecord } from "../../types";

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
  const [records, setRecords] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchAuditLogs({ entityType, entityId })
      .then((entries) => {
        if (!cancelled) setRecords(entries);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Unable to load history.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId]);

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
        {error ? (
          <div className="historyEmpty">
            <EmptyState text={error} />
          </div>
        ) : loading ? (
          <div className="historyEmpty">
            <EmptyState text="Loading history…" />
          </div>
        ) : records.length === 0 ? (
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
                    <span>{formatAuditDate(record.timestamp)} by {record.actorLabel}</span>
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
