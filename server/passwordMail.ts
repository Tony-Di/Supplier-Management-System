import { LINK_MINUTES } from "./passwordAccounts";
import type { Mail } from "./mailer";

const APP_NAME = "SEG Global Sourcing";

/** The page that opens an emailed link. The token is in the fragment, so it never reaches a server log. */
export function passwordLinkUrl(origin: string, token: string): string {
  return `${origin}/#set-password=${token}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function compose(to: string, subject: string, greeting: string, lines: string[], action: string, url: string, closing: string): Mail {
  const text = [greeting, "", ...lines, "", `${action}: ${url}`, "", closing].join("\n");
  const paragraph = (line: string) => `<p style="margin:0 0 14px">${escapeHtml(line)}</p>`;
  const html = `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1E1E1E;max-width:520px">
${paragraph(greeting)}
${lines.map(paragraph).join("\n")}
<p style="margin:22px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#1E1E1E;color:#ffffff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(action)}</a></p>
<p style="margin:0 0 14px;color:#6b7280;font-size:12px">If the button does not work, copy this address into your browser:<br>${escapeHtml(url)}</p>
<p style="margin:0;color:#6b7280;font-size:12px">${escapeHtml(closing)}</p>
</div>`;
  return { to, subject, text, html };
}

export function signUpMail(to: string, name: string, url: string): Mail {
  return compose(
    to,
    `Set your password — ${APP_NAME}`,
    `Hello ${name},`,
    [`Open the link below to set your password and finish creating your ${APP_NAME} account.`, `The link works once and expires in ${LINK_MINUTES} minutes.`],
    "Set your password",
    url,
    "If you did not ask for an account, ignore this email.",
  );
}

export function resetMail(to: string, name: string, url: string): Mail {
  return compose(
    to,
    `Reset your password — ${APP_NAME}`,
    `Hello ${name},`,
    [`Someone asked to set a new password for your ${APP_NAME} account (${to}).`, `The link works once and expires in ${LINK_MINUTES} minutes.`],
    "Choose a new password",
    url,
    "If it was not you, ignore this email. Your password stays the same.",
  );
}
