import { useMemo, useState } from "react";

export interface CartLine {
  sku: string;
  name: string;
  priceMinor: number;
  salePriceMinor?: number;
  quantity: number;
}

export function useCart(initial: CartLine[] = []) {
  const [lines, setLines] = useState(initial);
  const totalMinor = useMemo(
    () => lines.reduce((sum, line) => sum + (line.salePriceMinor ?? line.priceMinor) * line.quantity, 0),
    [lines],
  );
  return { lines, totalMinor, add: (line: CartLine) => setLines((current) => [...current, line]) };
}
