---
id: refactor-move-format-price
fixture: react-app
kind: refactor
success:
  - tsc passes
  - formatPrice lives in src/lib/money.ts and is renamed formatMoney
poetics:
  - the formatPrice unit keeps its uid
  - lineage records a move and a rename
  - PriceTag gets a version for its updated import
---

Move `formatPrice` into a new `src/lib/money.ts` module and rename it
`formatMoney`. Update every caller.
