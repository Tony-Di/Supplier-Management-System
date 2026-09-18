import { type SourceAssignment } from "../types";
import { useState } from "react";

export function SourceRoleSelect({
  disabledReason,
  onAssign,
  value,
}: {
  disabledReason?: string;
  onAssign: (role: SourceAssignment["role"]) => Promise<void>;
  value?: SourceAssignment["role"];
}) {
  const [saving, setSaving] = useState(false);
  async function assign(role: SourceAssignment["role"]) {
    if (disabledReason) return;
    setSaving(true);
    await onAssign(role);
    setSaving(false);
  }

  return (
    <label className={disabledReason ? "sourceRoleSelect disabled" : "sourceRoleSelect"} title={disabledReason ?? "Assign source role"}>
      <select
        aria-label="Source role"
        disabled={saving || Boolean(disabledReason)}
        onChange={(event) => void assign(event.target.value as SourceAssignment["role"])}
        value={value ?? ""}
      >
        <option value="">Not assigned</option>
        {(["Primary", "Secondary", "Tertiary", "Backup"] as SourceAssignment["role"][]).map((role) => (
          <option key={role} value={role}>{role}</option>
        ))}
      </select>
    </label>
  );
}
