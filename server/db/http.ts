import assert from "node:assert/strict";
import type { Express } from "express";

/** Sends one request to the app on a throwaway port. */
export async function call(app: Express, path: string, init?: RequestInit & { cookie?: string }) {
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      redirect: "manual",
      headers: { ...(init?.headers ?? {}), ...(init?.cookie ? { cookie: init.cookie } : {}) },
    });
  } finally {
    server.close();
  }
}

export interface Session {
  cookie: string;
  csrfToken: string;
  userId: number;
}

/** Signs in the AUTH_MODE=dev account. */
export async function signIn(app: Express): Promise<Session> {
  const login = await call(app, "/api/auth/login");
  const cookie = login.headers.get("set-cookie") ?? "";
  const me = await (await call(app, "/api/auth/me", { cookie })).json();
  return { cookie, csrfToken: me.csrfToken, userId: me.id };
}

/** A JSON request as the signed-in user. */
export function send(app: Express, session: Session, method: string, path: string, body?: unknown) {
  return call(app, path, {
    method,
    cookie: session.cookie,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The parsed body, failing the test with the body in the message unless the status matches. */
export async function expectJson(response: Response | Promise<Response>, status: number) {
  const resolved = await response;
  const body = await resolved.json();
  assert.equal(resolved.status, status, JSON.stringify(body));
  return body;
}
