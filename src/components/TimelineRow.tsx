

export function TimelineRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="timelineRow">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
