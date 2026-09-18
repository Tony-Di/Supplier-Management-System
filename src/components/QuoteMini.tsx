import { type Quote } from "../types";
import { formatMoney } from "../lib/format";

export function QuoteMini({ quote }: { quote: Quote }) {
  return (
    <div className="quoteMini">
      <strong>{formatMoney(quote.unitPrice)}</strong>
      <span>MOQ {quote.moq}</span>
      <span>{quote.effectiveFrom}</span>
    </div>
  );
}
