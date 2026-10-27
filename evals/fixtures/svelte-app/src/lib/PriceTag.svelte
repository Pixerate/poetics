<!-- @component
Displays a price with currency and optional sale price.
-->
<script lang="ts">
  import { formatPrice } from "./format-price.ts";

  interface PriceTagProps {
    amountMinor: number;
    saleAmountMinor?: number;
    currency?: string;
  }

  let { amountMinor, saleAmountMinor, currency = "GBP" }: PriceTagProps = $props();
</script>

{#if saleAmountMinor !== undefined}
  <span class="price"><s>{formatPrice(amountMinor, currency)}</s> <strong>{formatPrice(saleAmountMinor, currency)}</strong></span>
{:else}
  <span class="price">{formatPrice(amountMinor, currency)}</span>
{/if}
