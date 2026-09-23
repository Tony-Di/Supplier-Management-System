import { useEffect, useState } from "react";
import { fetchAuditUsage, fetchUsers, removeUser, updateUserActive, updateUserRole, type AdminUser } from "../api";
import { useSession } from "../SessionContext";
import { ErrorNotice } from "../components/ErrorNotice";
import { Panel } from "../components/Panel";
import { formatAuditDate } from "../lib/format";

export function AdminUsers() {
  const { user } = useSession();
  return user?.role === "admin" ? <UserManagement currentUserId={user.id} /> : null;
}

function UserManagement({ currentUserId }: { currentUserId: number }) {
  const { signOut } = useSession();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usage, setUsage] = useState<{ rows: number; bytes: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setUsers([]);
    setUsage(null);
    Promise.all([fetchUsers(), fetchAuditUsage()])
      .then(([records, auditUsage]) => {
        if (!cancelled) { setUsers(records); setUsage(auditUsage); }
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Unable to load users.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [revision]);

  async function updateUser(target: AdminUser, action: () => Promise<AdminUser | null>, message: string) {
    if (pendingId !== null) return;
    setPendingId(target.id);
    setError("");
    setNotice("");
    try {
      const updated = await action();
      setUsers((current) => updated ? current.map((entry) => entry.id === target.id ? updated : entry) : current.filter((entry) => entry.id !== target.id));
      // Role changes revoke this user's session on the server, including our own.
      if (target.id === currentUserId && updated?.role !== target.role) {
        await signOut();
        return;
      }
      setNotice(message);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to update user.");
    } finally {
      setPendingId(null);
    }
  }

  function confirmRemoval(target: AdminUser) {
    if (!window.confirm(`Remove ${target.name} (${target.email})? This permanently removes their account. Audit history is retained. Deactivate instead to block future sign-in.`)) return;
    void updateUser(target, async () => { await removeUser(target.id); return null; }, `Removed ${target.name}.`);
  }

  const busy = loading || pendingId !== null;
  return (
    <div className="adminPage">
      <ErrorNotice message={error} title="User management" onDismiss={() => setError("")} />
      {notice && <div className="notice successNotice" role="status">{notice}</div>}
      <Panel title="Users" actions={<button className="ghostButton" type="button" disabled={busy} onClick={() => setRevision((value) => value + 1)}>Refresh</button>}>
        <p className="adminHint">Deactivate an account to block access. Removing it allows a new account to be created if that person signs in again.</p>
        <div className="tableViewport" aria-busy={busy}>
          <table className="adminUsersTable">
            <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Last sign-in</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={6}>Loading users…</td></tr> : users.length === 0 ? <tr><td colSpan={6}>{error ? "Users could not be loaded. Try Refresh." : "No users have signed in yet."}</td></tr> : users.map((entry) => (
                <tr key={entry.id}>
                  <td><strong>{entry.name}</strong>{entry.id === currentUserId && <span className="adminMeta">You</span>}</td>
                  <td>{entry.email}</td>
                  <td><select
                    aria-label={`Role for ${entry.name} (${entry.email})`}
                    value={entry.role}
                    disabled={busy}
                    onChange={(event) => {
                      const role = event.target.value as AdminUser["role"];
                      if (role !== entry.role) void updateUser(entry, () => updateUserRole(entry.id, role), `Updated role for ${entry.name}.`);
                    }}
                  ><option value="user">User</option><option value="admin">Admin</option></select></td>
                  <td><div className="adminUserStatus">
                    <span className={`statusPill ${entry.active ? "active" : "inactive"}`}>{entry.active ? "Active" : "Inactive"}</span>
                    <button className="ghostButton" type="button" disabled={busy} aria-label={`${entry.active ? "Deactivate" : "Activate"} ${entry.name} (${entry.email})`} onClick={() => void updateUser(entry, () => updateUserActive(entry.id, !entry.active), `${entry.active ? "Deactivated" : "Activated"} ${entry.name}.`)}>{entry.active ? "Deactivate" : "Activate"}</button>
                  </div></td>
                  <td>{entry.lastLoginAt ? <time dateTime={entry.lastLoginAt}>{formatAuditDate(entry.lastLoginAt)}</time> : "Never"}</td>
                  <td><button className="dangerButton" type="button" disabled={busy} aria-label={`Remove ${entry.name} (${entry.email})`} onClick={() => confirmRemoval(entry)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <p className="adminUsage" role="status">{usage ? `Audit trail: ${usage.rows.toLocaleString()} entries, ${(usage.bytes / 1024 / 1024).toFixed(1)} MB` : loading ? "Loading audit usage…" : "Audit usage unavailable."}</p>
    </div>
  );
}
