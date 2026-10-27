import { memo } from "react";
import { formatPrice } from "./format-price.ts";

export interface PriceTagProps {
  amountMinor: number;
  saleAmountMinor?: number;
  currency?: string;
}

/** Displays a price with currency and optional sale price. */
export const PriceTag = memo(function PriceTag({ amountMinor, saleAmountMinor, currency = "GBP" }: PriceTagProps) {
  if (saleAmountMinor === undefined) return <span className="price">{formatPrice(amountMinor, currency)}</span>;
  return (
    <span className="price">
      <s>{formatPrice(amountMinor, currency)}</s> <strong>{formatPrice(saleAmountMinor, currency)}</strong>
    </span>
  );
});
