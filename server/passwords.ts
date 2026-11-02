import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const KEY_LENGTH = 64;
const PARAMETERS = { N: 16384, r: 8, p: 1 };

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

/** A salted scrypt hash, stored as `scrypt$N$r$p$salt$key` so the cost can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMETERS);
  return ["scrypt", PARAMETERS.N, PARAMETERS.r, PARAMETERS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

// Checked when an address has no password, so a wrong address takes as long as a wrong password.
const UNUSABLE_HASH = `scrypt$${PARAMETERS.N}$${PARAMETERS.r}$${PARAMETERS.p}$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(KEY_LENGTH).toString("base64")}`;

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = (stored || UNUSABLE_HASH).split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), { N: Number(n), r: Number(r), p: Number(p) });
  return Boolean(stored) && actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** The reason a new password is refused, or null. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (!password.trim()) return "A password cannot be only spaces.";
  return null;
}

/** A random token for an emailed link, and the hash that is stored in its place. */
export function newLinkToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashLinkToken(token) };
}

export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
