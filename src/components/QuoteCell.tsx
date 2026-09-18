import { type Quote, type SampleInspection } from "../types";
import { formatMoney } from "../lib/format";
import { StatusPill } from "./StatusPill";

export function QuoteCell({ quote, inspection }: { quote: Quote; inspection?: SampleInspection }) {
  return (
    <div className="quoteCell">
      <strong>{formatMoney(quote.unitPrice)}</strong>
      <span>MOQ {quote.moq}</span>
      <span>{quote.leadTime}</span>
      <StatusPill label={inspection?.result ?? "Pending"} />
    </div>
  );
}
