export interface CartLine {
  sku: string;
  name: string;
  priceMinor: number;
  salePriceMinor?: number;
  quantity: number;
}

/** Cart state as a rune module. */
export function createCart(initial: CartLine[] = []) {
  let lines = $state(initial);
  const totalMinor = $derived(lines.reduce((sum, line) => sum + (line.salePriceMinor ?? line.priceMinor) * line.quantity, 0));

  return {
    get lines() {
      return lines;
    },
    get totalMinor() {
      return totalMinor;
    },
    add(line: CartLine) {
      lines = [...lines, line];
    },
  };
}
