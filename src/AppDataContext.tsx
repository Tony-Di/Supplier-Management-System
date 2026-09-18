import { createContext, useCallback, useContext, useEffect, useState, type Dispatch, type SetStateAction, type ReactNode } from "react";
import { fetchBootstrap, type AppData } from "./api";
import { fallbackData } from "./appDefaults";

interface AppDataState {
  data: AppData;
  setData: Dispatch<SetStateAction<AppData>>;
  refresh: () => Promise<void>;
  loading: boolean;
  error: string;
}

const AppDataContext = createContext<AppDataState | undefined>(undefined);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(fallbackData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setError("");
      setData(await fetchBootstrap());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load backend data.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <AppDataContext.Provider value={{ data, setData, refresh, loading, error }}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const context = useContext(AppDataContext);
  if (!context) throw new Error("useAppData must be used within AppDataProvider");
  return context;
}
