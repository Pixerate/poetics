<script lang="ts">
  import { createCart } from "./lib/cart.svelte.ts";
  import PriceTag from "./lib/PriceTag.svelte";

  const cart = createCart([
    { sku: "TEE-1", name: "T-shirt", priceMinor: 2000, salePriceMinor: 1500, quantity: 1 },
    { sku: "MUG-1", name: "Mug", priceMinor: 900, quantity: 2 },
  ]);
</script>

<main>
  <h1>Poetics fixture shop</h1>
  <ul>
    {#each cart.lines as line (line.sku)}
      <li>{line.name} × {line.quantity}: <PriceTag amountMinor={line.priceMinor} saleAmountMinor={line.salePriceMinor} /></li>
    {/each}
  </ul>
  <p>Total: <PriceTag amountMinor={cart.totalMinor} /></p>
  <button onclick={() => cart.add({ sku: `X-${cart.lines.length}`, name: "Sticker", priceMinor: 150, quantity: 1 })}>
    Add sticker
  </button>
</main>
