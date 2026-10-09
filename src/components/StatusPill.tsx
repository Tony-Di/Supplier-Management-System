/** A status label; `tone` picks its colour when the label itself is not a status name. */
export function StatusPill({ label, tone }: { label: string; tone?: "pass" | "rejected" | "pending" | "neutral" }) {
  const key = tone ?? label.toLowerCase().replace(/\s+/g, "-");
  return <span className={`statusPill ${key}`}>{label}</span>;
}
