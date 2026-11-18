import type { PoolClient } from "pg";

import { hashLinkToken, newLinkToken } from "./passwords";
import { USER_COLUMNS, toUser, type User } from "./users";

type Executor = Pick<PoolClient, "query">;

/** How long an emailed sign-up or password link works. */
export const LINK_MINUTES = 60;

export interface Account {
  user: User;
  passwordHash: string | null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailDomain(email: string): string {
  return normalizeEmail(email).split("@").pop() ?? "";
}

/** The account for an address. Entra accounts may share one, so the one with a password wins, then the oldest. */
export async function findAccountByEmail(db: Executor, email: string): Promise<Account | undefined> {
  const { rows } = await db.query(
    `SELECT ${USER_COLUMNS}, password_hash FROM users
     WHERE lower(email) = $1
     ORDER BY (password_hash IS NOT NULL) DESC, id
     LIMIT 1`,
    [normalizeEmail(email)],
  );
  return rows[0] ? { user: toUser(rows[0]), passwordHash: (rows[0].password_hash as string | null) ?? null } : undefined;
}

export async function recordSignIn(db: Executor, userId: number): Promise<void> {
  await db.query("UPDATE users SET last_login_at = now() WHERE id = $1", [userId]);
}

/** Replaces any live link for the address with a new one, and returns its token. */
export async function createPasswordLink(db: Executor, email: string, name: string | null): Promise<string> {
  const address = normalizeEmail(email);
  const { token, tokenHash } = newLinkToken();
  await db.query("DELETE FROM password_links WHERE email = $1 OR expires_at <= now()", [address]);
  await db.query(
    `INSERT INTO password_links(token_hash, email, name, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [tokenHash, address, name, LINK_MINUTES],
  );
  return token;
}

export interface PasswordLink {
  email: string;
  name: string | null;
  /** The link will create an account rather than change an existing password. */
  newAccount: boolean;
}

export async function readPasswordLink(db: Executor, token: string): Promise<PasswordLink | undefined> {
  const { rows } = await db.query(
    "SELECT email, name FROM password_links WHERE token_hash = $1 AND expires_at > now()",
    [hashLinkToken(token)],
  );
  if (!rows[0]) return undefined;
  const email = rows[0].email as string;
  const account = await findAccountByEmail(db, email);
  return { email, name: account?.user.name ?? (rows[0].name as string | null), newAccount: !account };
}

export type PasswordLinkResult =
  | { status: "set"; user: User }
  | { status: "expired" }
  | { status: "deactivated" };

/**
 * Uses a link once: sets the password on the address's account, creating the
 * account if there is none, and signs out its other sessions. Run it inside a
 * transaction, so a failed write leaves the link usable.
 */
export async function usePasswordLink(db: Executor, token: string, passwordHash: string): Promise<PasswordLinkResult> {
  const { rows } = await db.query(
    "DELETE FROM password_links WHERE token_hash = $1 AND expires_at > now() RETURNING email, name",
    [hashLinkToken(token)],
  );
  if (!rows[0]) return { status: "expired" };
  const email = rows[0].email as string;
  const name = (rows[0].name as string | null) || email.split("@")[0];

  const account = await findAccountByEmail(db, email);
  if (account && !account.user.active) return { status: "deactivated" };

  const result = account
    ? await db.query(
        `UPDATE users SET password_hash = $2, session_epoch = session_epoch + 1, last_login_at = now()
         WHERE id = $1 RETURNING ${USER_COLUMNS}`,
        [account.user.id, passwordHash],
      )
    : await db.query(
        `INSERT INTO users(email, name, password_hash, last_login_at)
         VALUES ($1, $2, $3, now()) RETURNING ${USER_COLUMNS}`,
        [email, name, passwordHash],
      );
  await db.query("DELETE FROM password_links WHERE email = $1", [email]);
  return { status: "set", user: toUser(result.rows[0]) };
}
