---
id: regression-cart-total
fixture: svelte-app
kind: regression
setup: Apply a change to formatPrice that divides by 1000 instead of 100.
success:
  - the agent identifies formatPrice as the cause
  - the fix restores correct totals and adds a test
poetics:
  - the fix's version rationale links the regression
---

Customers report that the cart total is ten times too small. Find the cause and
fix it.
