import { useEffect, useState, type FormEvent } from "react";
import { MailCheck } from "lucide-react";

import { requestPasswordChange } from "../api";
import { ErrorNotice } from "../components/ErrorNotice";

/** Emails the signed-in user a link to choose a new password (AUTH_MODE=password). */
export function ChangePasswordModal({ email, onClose }: { email: string; onClose: () => void }) {
  const [sentTo, setSentTo] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setError("");
    try {
      setSentTo((await requestPasswordChange()).email);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The email could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel narrowModal" role="dialog" aria-modal="true" aria-labelledby="change-password-title" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2 id="change-password-title">Change password</h2>
            <p>{email}</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        {sentTo ? (
          <div className="modalText modalSent" role="status">
            <MailCheck size={22} aria-hidden="true" />
            <div>
              <p><strong>Check your inbox.</strong> A link is on its way to {sentTo}. Open it to choose a new password.</p>
              <p className="modalTextMuted">The link works once and expires in 60 minutes. Your current password keeps working until you use it. Nothing after a few minutes? Look in Outlook's Junk Email folder.</p>
            </div>
          </div>
        ) : (
          <div className="modalText">
            <p>We will email a link to <strong>{email}</strong>. Open it to choose a new password.</p>
            <p className="modalTextMuted">Your current password keeps working until you use the link. Choosing a new one signs you out everywhere else.</p>
          </div>
        )}
        <div className="modalTextError"><ErrorNotice message={error} title="Email not sent" onDismiss={() => setError("")} /></div>
        <div className="modalActions">
          {sentTo ? (
            <button className="primaryButton" onClick={onClose} type="button">Done</button>
          ) : (
            <>
              <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
              <button className="primaryButton" disabled={sending} type="submit">{sending ? "Sending…" : "Email me a link"}</button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
