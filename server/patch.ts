/**
 * The record an edit produces: the stored record with the patch's keys laid
 * over it. A key whose patch value is null is removed, which is how an edit
 * clears an optional field — JSON has no way to send undefined. Arrays and
 * objects in the patch replace the stored value whole.
 */
export function mergePatch(record: object, patch: unknown): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...record };
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return merged;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}
