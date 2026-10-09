interface LifecycleRecord {
  recordState?: "Draft" | "Active" | "Void";
}

/** A voided record stays readable for history but must not be referenced by new work. */
export function isUsableRecord(record: LifecycleRecord | undefined): boolean {
  return Boolean(record) && record?.recordState !== "Void";
}
