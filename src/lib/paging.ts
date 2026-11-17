export const DEFAULT_PAGE_SIZE = 50;

export interface Page<T> {
  rows: T[];
  /** The page shown, from 1. A page past the end shows the last page. */
  page: number;
  pageCount: number;
  total: number;
  /** Positions of the first and last row shown, from 1; both 0 when there are no rows. */
  first: number;
  last: number;
}

/** One page of a list. A list that fits on one page comes back whole. */
export function pageOf<T>(rows: T[], page: number, pageSize = DEFAULT_PAGE_SIZE): Page<T> {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount);
  const start = (current - 1) * pageSize;
  const shown = pageCount === 1 ? rows : rows.slice(start, start + pageSize);
  return { rows: shown, page: current, pageCount, total, first: total === 0 ? 0 : start + 1, last: start + shown.length };
}
