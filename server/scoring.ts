// Responsiveness and scope fit are scored from fixed checkpoints. The points
// earned are scaled to the category's weight, so a weight set above the
// default can still be earned in full.

const RESPONSIVENESS_POINTS = 15;
const SCOPE_POINTS = 10;

export function scoreResponsiveness(
  facts: { quoteCount: number; averageLeadTime: number | undefined; selectedQuotes: number },
  weight: number,
): number {
  const points =
    (facts.quoteCount > 0 ? 8 : 0) +
    (facts.averageLeadTime !== undefined && facts.averageLeadTime <= 14 ? 4 : 0) +
    (facts.selectedQuotes > 0 ? 3 : 0);
  return Math.round((points / RESPONSIVENESS_POINTS) * weight);
}

export function scoreScopeFit(
  facts: { declaredTypes: number; quotedDeclaredTypes: number; passedDeclaredTypes: number },
  weight: number,
): number {
  const points =
    (facts.declaredTypes > 0 ? 4 : 0) + (facts.quotedDeclaredTypes > 0 ? 3 : 0) + (facts.passedDeclaredTypes > 0 ? 3 : 0);
  return Math.round((points / SCOPE_POINTS) * weight);
}

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
