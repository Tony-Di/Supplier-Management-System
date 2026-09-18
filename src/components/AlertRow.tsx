

export function AlertRow({ title, text }: { title: string; text: string }) {
  return (
    <div className="alertRow">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}
