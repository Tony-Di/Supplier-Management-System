import { useEffect, useState } from "react";
import { useAppData } from "./AppDataContext";
import { fetchScorecard, type AppData, type ScorecardRow } from "./api";

// One request per loaded data set, shared by every page that shows scores:
// moving between Dashboard, Suppliers, Comparison and Reports reuses it.
const requests = new WeakMap<AppData, Promise<ScorecardRow[]>>();

function scorecardFor(data: AppData): Promise<ScorecardRow[]> {
  let request = requests.get(data);
  if (!request) {
    request = fetchScorecard().then((response) => response.rows);
    requests.set(data, request);
    // A failed request is not kept, so the next page to ask tries again.
    request.catch(() => requests.delete(data));
  }
  return request;
}

/**
 * Supplier scores as the server calculates them with the saved KPI weights.
 * Reloaded whenever the application data is replaced, so edits that do not
 * change a record count still refresh the scores. `rows` is null until the
 * first response arrives or when the request fails.
 */
export function useScorecard() {
  const { data, loading } = useAppData();
  const [rows, setRows] = useState<ScorecardRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    // The placeholder data shown before the first load has no scores worth asking for.
    if (loading) return;
    let isMounted = true;
    setError("");
    scorecardFor(data)
      .then((nextRows) => {
        if (isMounted) setRows(nextRows);
      })
      .catch((requestError) => {
        if (isMounted) {
          setRows(null);
          setError(requestError instanceof Error ? requestError.message : "Unable to load supplier scores.");
        }
      });
    return () => {
      isMounted = false;
    };
  }, [data, loading]);

  return { rows, error };
}
