

export function StatusPill({ label }: { label: string }) {
  const key = label.toLowerCase().replace(/\s+/g, "-");
  return <span className={`statusPill ${key}`}>{label}</span>;
}
