/** Formats an amount in minor units (pence, cents) as a currency string. */
export function formatPrice(amountMinor: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amountMinor / 100);
}
