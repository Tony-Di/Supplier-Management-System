import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { fetchSession, setCsrfToken, signOut as postSignOut, type SessionFeatures, type SessionUser } from "./api";

interface SessionState {
  user: SessionUser | null;
  features: SessionFeatures;
  loading: boolean;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [features, setFeatures] = useState<SessionFeatures>({ previousOrderSelection: false });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSession()
      .then((session) => {
        setCsrfToken(session.csrfToken);
        setUser({ id: session.id, name: session.name, email: session.email, role: session.role });
        setFeatures({ previousOrderSelection: Boolean(session.features?.previousOrderSelection) });
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const signOut = useCallback(async () => {
    await postSignOut().catch(() => undefined);
    setUser(null);
    window.location.assign("/");
  }, []);

  return <SessionContext.Provider value={{ user, features, loading, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used within SessionProvider");
  return context;
}
