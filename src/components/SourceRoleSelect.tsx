import { type SourceAssignment } from "../types";
import { useId, useState } from "react";
import { useAppData } from "../AppDataContext";
import { useWorkflowActions } from "../WorkflowActionsContext";
import { sourceRoleEligibility } from "../lib/sourceRoleEligibility";

export function SourceRoleSelect({
  disabledReason,
  onAssign,
  value,
  quoteId,
  projectId,
}: {
  disabledReason?: string;
  onAssign: (role: SourceAssignment["role"]) => Promise<void>;
  value?: SourceAssignment["role"];
  quoteId?: string;
  projectId?: string;
}) {
  const { data } = useAppData();
  const { openQc } = useWorkflowActions();
  const explanationId = useId();
  const eligibility = sourceRoleEligibility(data, data.quotes.find((quote) => quote.id === quoteId), projectId);
  const blockedReason = quoteId ? eligibility.reason : disabledReason;
  const [saving, setSaving] = useState(false);
  async function assign(role: SourceAssignment["role"]) {
    if (blockedReason || !role) return;
    setSaving(true);
    try { await onAssign(role); } finally { setSaving(false); }
  }

  return (
    <div className={blockedReason ? "sourceRoleSelect disabled" : "sourceRoleSelect"}>
      <select
        aria-label="Source role"
        aria-describedby={blockedReason ? explanationId : undefined}
        disabled={saving || Boolean(blockedReason)}
        onChange={(event) => void assign(event.target.value as SourceAssignment["role"])}
        value={value ?? ""}
      >
        <option value="">Not assigned</option>
        {(["Primary", "Secondary", "Tertiary", "Backup"] as SourceAssignment["role"][]).map((role) => (
          <option key={role} value={role}>{role}</option>
        ))}
      </select>
      {blockedReason && <div className="blockedAction" id={explanationId}>
        <span>{blockedReason}</span>
        {eligibility.inspection && <span>Round {eligibility.inspection.sampleRound}: {eligibility.inspection.result}</span>}
        {quoteId && <button className="textButton" type="button" onClick={() => openQc(quoteId, projectId)}>{eligibility.inspection ? "Open QC record" : "Record sample inspection"}</button>}
      </div>}
    </div>
  );
}
