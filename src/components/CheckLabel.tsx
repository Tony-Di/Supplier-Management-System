

export function CheckLabel({ ok, label }: { ok: boolean; label: string }) {
  return <span className={ok ? "checkLabel ok" : "checkLabel"}>{label}</span>;
}
