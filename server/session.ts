import { randomBytes, timingSafeEqual } from "node:crypto";
import connectPgSimple from "connect-pg-simple";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import session from "express-session";
import type { PoolClient } from "pg";

import { getConfig } from "./config";
import { pool, query } from "./db";
import { findUserById, type User } from "./users";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    userEpoch?: number;
    csrfToken?: string;
    oidc?: { state: string; nonce: string; verifier: string };
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const config = getConfig();

export const sessionMiddleware: RequestHandler = session({
  store: new (connectPgSimple(session))({ pool, tableName: "session", createTableIfMissing: false }),
  name: "sourcing.sid",
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: config.secureCookies, maxAge: 12 * 60 * 60 * 1000 },
});

type Executor = Pick<PoolClient, "query">;

export async function sessionUserIsCurrent(db: Executor, userId: number, epoch: number): Promise<boolean> {
  const user = await findUserById(db, userId);
  return Boolean(user && user.active && user.sessionEpoch === epoch);
}

export async function signIn(request: Request, user: User): Promise<void> {
  await new Promise<void>((resolve, reject) => request.session.regenerate((error) => (error ? reject(error) : resolve())));
  request.session.userId = user.id;
  request.session.userEpoch = user.sessionEpoch;
  await new Promise<void>((resolve, reject) => request.session.save((error) => (error ? reject(error) : resolve())));
}

export const requireAuth: RequestHandler = async (request, response, next) => {
  const { userId, userEpoch } = request.session;
  if (!userId || userEpoch === undefined) {
    response.status(401).json({ message: "Sign in to continue." });
    return;
  }
  const user = await findUserById(pool, userId);
  if (!user || !user.active || user.sessionEpoch !== userEpoch) {
    request.session.destroy(() => undefined);
    response.status(401).json({ message: "Your session has ended. Sign in again." });
    return;
  }
  request.user = user;
  next();
};

export const requireAdmin: RequestHandler = (request, response, next) => {
  if (request.user?.role !== "admin") {
    response.status(403).json({ message: "Administrator access is required." });
    return;
  }
  next();
};

export function csrfToken(request: Request): string {
  request.session.csrfToken ||= randomBytes(32).toString("hex");
  return request.session.csrfToken;
}

export function verifyCsrf(request: Request, response: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
  const supplied = request.get("x-csrf-token") ?? "";
  const expected = request.session.csrfToken ?? "";
  if (!expected || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    response.status(403).json({ message: "This page expired. Reload and try again." });
    return;
  }
  next();
}

export { query };
