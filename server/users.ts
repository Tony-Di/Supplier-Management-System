import type { PoolClient } from "pg";

export interface User {
  id: number;
  entraOid: string;
  email: string;
  name: string;
  role: "admin" | "user";
  active: boolean;
  sessionEpoch: number;
  lastLoginAt: string | null;
}

export class UserRuleError extends Error {
  status = 400;
}

type Executor = Pick<PoolClient, "query">;

const COLUMNS = `id, entra_oid, email, name, role, active, session_epoch, last_login_at`;

function toUser(row: Record<string, unknown>): User {
  return {
    id: row.id as number,
    entraOid: row.entra_oid as string,
    email: row.email as string,
    name: row.name as string,
    role: row.role as "admin" | "user",
    active: row.active as boolean,
    sessionEpoch: row.session_epoch as number,
    lastLoginAt: (row.last_login_at as Date | null)?.toISOString() ?? null,
  };
}

export async function upsertUserFromClaims(db: Executor, claims: { oid: string; email: string; name: string }): Promise<User> {
  const { rows } = await db.query(
    `INSERT INTO users(entra_oid, email, name, last_login_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (entra_oid) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, last_login_at = now()
     RETURNING ${COLUMNS}`,
    [claims.oid, claims.email.trim().toLowerCase(), claims.name.trim()],
  );
  return toUser(rows[0]);
}

export async function findUserById(db: Executor, id: number): Promise<User | undefined> {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ? toUser(rows[0]) : undefined;
}

export async function listUsers(db: Executor): Promise<User[]> {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM users ORDER BY lower(name)`);
  return rows.map(toUser);
}

async function activeAdminCount(db: Executor, excludingId: number): Promise<number> {
  const { rows } = await db.query(
    "SELECT count(*)::int AS count FROM users WHERE role = 'admin' AND active AND id <> $1",
    [excludingId],
  );
  return rows[0].count as number;
}

export async function setUserRole(db: Executor, id: number, role: "admin" | "user", actingUserId: number): Promise<User> {
  if (role === "user" && (await activeAdminCount(db, id)) === 0) {
    throw new UserRuleError("At least one active admin must remain.");
  }
  const { rows } = await db.query(
    `UPDATE users SET role = $2, session_epoch = session_epoch + 1 WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, role],
  );
  if (!rows[0]) throw new UserRuleError(`User not found: ${id}`);
  return toUser(rows[0]);
}

export async function setUserActive(db: Executor, id: number, active: boolean, actingUserId: number): Promise<User> {
  if (!active && id === actingUserId) throw new UserRuleError("You cannot deactivate your own account.");
  if (!active && (await activeAdminCount(db, id)) === 0) {
    throw new UserRuleError("At least one active admin must remain.");
  }
  const { rows } = await db.query(
    `UPDATE users SET active = $2, session_epoch = session_epoch + 1 WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, active],
  );
  if (!rows[0]) throw new UserRuleError(`User not found: ${id}`);
  return toUser(rows[0]);
}

export async function deleteUser(db: Executor, id: number, actingUserId: number): Promise<void> {
  if (id === actingUserId) throw new UserRuleError("You cannot delete your own account.");
  if ((await activeAdminCount(db, id)) === 0) throw new UserRuleError("At least one active admin must remain.");
  await db.query("DELETE FROM users WHERE id = $1", [id]);
}
