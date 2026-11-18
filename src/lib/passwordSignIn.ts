// Mirrors server/passwords.ts, so the form can say what is wrong before it posts.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Wrong passwords allowed before the server locks the address for a minute. */
export const MAX_SIGN_IN_ATTEMPTS = 5;

const LINK_FRAGMENT = /^#set-password=([\w-]+)$/;

/** The token from an emailed link (`/#set-password=<token>`), or null. */
export function passwordLinkToken(hash: string): string | null {
  return hash.match(LINK_FRAGMENT)?.[1] ?? null;
}

/** The reason a new password and its confirmation are refused, or null. */
export function newPasswordProblem(password: string, confirmation: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (!password.trim()) return "A password cannot be only spaces.";
  if (password !== confirmation) return "The two passwords do not match.";
  return null;
}

export function emailDomainList(domains: string[]): string {
  return domains.map((domain) => `@${domain}`).join(" or ");
}

/** The reason an address cannot sign up, or null. The server checks again. */
export function emailDomainProblem(email: string, domains: string[]): string | null {
  const address = email.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return "Enter your work email address.";
  if (domains.length > 0 && !domains.includes(address.slice(at + 1))) return `Use your ${emailDomainList(domains)} email address.`;
  return null;
}
