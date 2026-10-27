---
id: feature-sale-badge
fixture: svelte-app
kind: feature
success:
  - sv check passes
  - PriceTag shows a "Sale" badge when saleAmountMinor is set
poetics:
  - PriceTag has a new interface or behaviour version with rationale citing this task
  - linked tests updated
---

Add a small "Sale" badge to `PriceTag` whenever a sale price is shown. Keep the
existing props working.
