import { type Quote } from "../types";
import { formatMoney } from "../lib/format";
import { quoteExtraCostLabel } from "../lib/lookups";

export function QuoteValueStack({ field, quotes: quoteList }: { field: "price" | "moq" | "leadTime" | "extraCost"; quotes: Quote[] }) {
  return (
    <div className="quoteStack">
      {quoteList.map((quote) => {
        const value =
          field === "price" ? formatMoney(quote.unitPrice)
            : field === "moq" ? quote.moq
              : field === "leadTime" ? quote.leadTime
                : quoteExtraCostLabel(quote);
        return <span key={`${quote.id}-${field}`}>{value}</span>;
      })}
    </div>
  );
}
