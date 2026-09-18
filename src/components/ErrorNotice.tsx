import { CircleAlert, X } from "lucide-react";

export function ErrorNotice({ message, title = "Changes not saved", onDismiss }: { message: string; title?: string; onDismiss?: () => void }) {
  if (!message) return null;
  return <div className="notice errorNotice errorBanner" role="alert">
    <CircleAlert size={18} aria-hidden="true" />
    <div><strong>{title}</strong><p>{message}</p></div>
    {onDismiss && <button className="dismissNotice" type="button" aria-label="Dismiss error" onClick={onDismiss}><X size={16} /></button>}
  </div>;
}
