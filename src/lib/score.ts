export function isWithinRecentDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00`);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return date >= cutoff;
}
