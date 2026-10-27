import { PriceTag } from "./PriceTag.tsx";
import { useCart } from "./use-cart.ts";

export function CheckoutPage() {
  const cart = useCart([{ sku: "TEE-1", name: "T-shirt", priceMinor: 2000, salePriceMinor: 1500, quantity: 1 }]);
  return (
    <main>
      {cart.lines.map((line) => (
        <p key={line.sku}>
          {line.name}: <PriceTag amountMinor={line.priceMinor} {...(line.salePriceMinor === undefined ? {} : { saleAmountMinor: line.salePriceMinor })} />
        </p>
      ))}
      <p>
        Total: <PriceTag amountMinor={cart.totalMinor} />
      </p>
    </main>
  );
}
