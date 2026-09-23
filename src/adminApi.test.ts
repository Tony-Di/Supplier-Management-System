import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchAuditEntries, fetchAuditUsage, fetchUsers, removeUser, setCsrfToken, UnauthenticatedError, updateUserActive, updateUserRole } from "./api";

test("admin writes include credentials and CSRF while preserving false and the selected role", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; options?: RequestInit }> = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ ok: true }));
  };
  setCsrfToken("admin-test-token");
  try {
    await updateUserRole(12, "user");
    await updateUserActive(12, false);
    await removeUser(12);
    assert.deepEqual(calls.map(({ url, options }) => [url, options?.method, options?.body]), [
      ["/api/admin/users/12/role", "PATCH", '{"role":"user"}'],
      ["/api/admin/users/12/active", "PATCH", '{"active":false}'],
      ["/api/admin/users/12", "DELETE", undefined],
    ]);
    for (const { options } of calls) {
      assert.equal(options?.credentials, "same-origin");
      assert.equal(new Headers(options?.headers).get("X-CSRF-Token"), "admin-test-token");
    }
  } finally { globalThis.fetch = originalFetch; setCsrfToken(""); }
});

test("audit filters combine safely and omit unselected fields", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (url) => { urls.push(String(url)); return new Response("[]"); };
  try {
    await fetchAuditEntries({ entityType: "Quote", entityId: "record & other=1", actorUserId: 7, limit: 50 });
    await fetchAuditEntries({ entityType: undefined, actorUserId: undefined, limit: 200 });
    await fetchUsers();
    await fetchAuditUsage();
    const params = new URL(urls[0], "http://localhost").searchParams;
    assert.deepEqual(Object.fromEntries(params), { entityType: "Quote", entityId: "record & other=1", actorUserId: "7", limit: "50" });
    assert.equal(urls[1], "/api/audit-logs?limit=200");
    assert.deepEqual(urls.slice(2), ["/api/admin/users", "/api/admin/audit-usage"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("admin failures preserve guard messages and expired sessions remain distinguishable", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const message = "You cannot deactivate your own account.";
    globalThis.fetch = async () => new Response(JSON.stringify({ message }), { status: 400 });
    await assert.rejects(updateUserActive(1, false), (error) => error instanceof Error && error.message === message);
    globalThis.fetch = async () => new Response("{}", { status: 401 });
    await assert.rejects(fetchUsers(), UnauthenticatedError);
  } finally { globalThis.fetch = originalFetch; }
});
