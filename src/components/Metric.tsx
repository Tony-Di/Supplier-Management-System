

export function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <article className="metricCard">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </article>
  );
}
