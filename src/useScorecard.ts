import { useEffect, useState } from "react";
import { useAppData } from "./AppDataContext";
import { fetchScorecard, type ScorecardRow } from "./api";

/**
 * Supplier scores as the server calculates them with the saved KPI weights.
 * Reloaded whenever the application data is replaced, so edits that do not
 * change a record count still refresh the scores. `rows` is null until the
 * first response arrives or when the request fails.
 */
export function useScorecard() {
  const { data } = useAppData();
  const [rows, setRows] = useState<ScorecardRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;
    setError("");
    fetchScorecard()
      .then((response) => {
        if (isMounted) setRows(response.rows);
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
  }, [data]);

  return { rows, error };
}
