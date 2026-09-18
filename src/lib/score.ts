

export function scoreIncomingQuality(recentDefectQty: number, max: number) {
  if (recentDefectQty < 5) return max;
  if (recentDefectQty < 10) return Math.round(max * 0.75);
  if (recentDefectQty < 20) return Math.round(max * 0.45);
  return Math.round(max * 0.15);
}

export function scoreLeadTime(averageLeadTime: number | undefined, max: number) {
  if (averageLeadTime === undefined) return 0;
  if (averageLeadTime <= 7) return max;
  if (averageLeadTime <= 14) return Math.round(max * 0.8);
  if (averageLeadTime <= 21) return Math.round(max * 0.55);
  if (averageLeadTime <= 30) return Math.round(max * 0.3);
  return Math.round(max * 0.1);
}

export function scorePaymentTerms(paymentTerms: string, max: number) {
  const days = paymentTermDays(paymentTerms);
  if (days === undefined) return 0;
  if (days >= 60) return max;
  if (days >= 45) return Math.round(max * 0.8);
  if (days >= 30) return Math.round(max * 0.6);
  if (days >= 15) return Math.round(max * 0.3);
  return Math.round(max * 0.1);
}

export function paymentTermDays(paymentTerms: string) {
  const match = paymentTerms.match(/(?:net\s*)?(\d{1,3})/i);
  return match ? Number(match[1]) : undefined;
}

export function isWithinRecentDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00`);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return date >= cutoff;
}
