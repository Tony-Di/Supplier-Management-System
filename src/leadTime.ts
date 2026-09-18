const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30;
const CALENDAR_DAYS_PER_BUSINESS_DAY = 7 / 5;

/**
 * Reads a free-text lead time such as "14 Days", "4 - 5 weeks" or
 * "8 business days" and returns whole calendar days.
 *
 * A range returns its upper bound, so a lead time is never scored as
 * faster than the supplier actually promised. Returns undefined when the
 * text carries no number ("TBD").
 */
export function parseLeadTimeDays(value: unknown): number | undefined {
  const text = String(value ?? "").toLowerCase();
  const numbers = text.match(/\d+(\.\d+)?/g);
  if (!numbers) return undefined;

  const amount = Number(numbers[numbers.length - 1]);
  const unitDays = /month|mos?\b/.test(text)
    ? DAYS_PER_MONTH
    : /week|wks?\b/.test(text)
      ? DAYS_PER_WEEK
      : /business|working|work day/.test(text)
        ? CALENDAR_DAYS_PER_BUSINESS_DAY
        : 1;

  return Math.round(amount * unitDays);
}
