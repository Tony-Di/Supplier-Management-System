import nodemailer from "nodemailer";

import { getConfig } from "./config";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type MailTransport = (mail: Mail) => Promise<void>;

let transport: MailTransport | undefined;

function configuredTransport(): MailTransport {
  const { mail } = getConfig();
  if (!mail) {
    return async (message) => {
      console.log(`[mail] SMTP_HOST is not set, so this email was written here instead of sent.\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`);
    };
  }
  const smtp = nodemailer.createTransport({
    host: mail.host,
    port: mail.port,
    // 465 is TLS from the start; 587 (Office 365) upgrades with STARTTLS.
    secure: mail.port === 465,
    auth: mail.user ? { user: mail.user, pass: mail.password } : undefined,
  });
  return async (message) => {
    await smtp.sendMail({ from: mail.from, ...message });
  };
}

export async function sendMail(mail: Mail): Promise<void> {
  transport ??= configuredTransport();
  await transport(mail);
}

/** Replaces the transport, so tests can read what would have been sent. `undefined` restores the configured one. */
export function setMailTransport(next: MailTransport | undefined): void {
  transport = next;
}
