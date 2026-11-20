import { useState } from "react";
import { DEFAULT_PAGE_SIZE, pageOf, type Page } from "../lib/paging";

/**
 * Shows a long list one page at a time, so a table with thousands of rows
 * draws only the rows on screen. Filtering to a shorter list falls back to
 * its last page, and a list that fits on one page is shown whole.
 */
export function usePaging<T>(rows: T[], pageSize = DEFAULT_PAGE_SIZE): Page<T> & { setPage: (page: number) => void } {
  const [page, setPage] = useState(1);
  return { ...pageOf(rows, page, pageSize), setPage };
}

/** Previous and next controls under a paged table. Draws nothing when everything fits on one page. */
export function Pager({ paging }: { paging: Omit<Page<unknown>, "rows"> & { setPage: (page: number) => void } }) {
  const { page, pageCount, total, first, last, setPage } = paging;
  if (pageCount <= 1) return null;
  return (
    <nav className="pager" aria-label="Table pages">
      <span className="muted">{first}–{last} of {total}</span>
      <button className="ghostButton smallButton" disabled={page <= 1} onClick={() => setPage(page - 1)} type="button">Previous</button>
      <span className="muted">Page {page} of {pageCount}</span>
      <button className="ghostButton smallButton" disabled={page >= pageCount} onClick={() => setPage(page + 1)} type="button">Next</button>
    </nav>
  );
}
