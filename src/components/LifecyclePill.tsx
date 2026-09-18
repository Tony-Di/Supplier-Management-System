

export function LifecyclePill({ record }: { record: { recordState?: "Draft" | "Active" | "Void" } }) {
  if (!record.recordState || record.recordState === "Active") return null;
  return <span className={`lifecyclePill ${record.recordState.toLowerCase()}`}>{record.recordState}</span>;
}
