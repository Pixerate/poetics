# Eval fixtures

Sample apps that benchmark tasks run against, and that adapter tests index.
They are workspace packages so `pnpm check` type-checks them.

| Fixture | Contents |
| --- | --- |
| [`svelte-app`](svelte-app) | Svelte 5 + Vite: `PriceTag.svelte`, a `.svelte.ts` cart rune module, `formatPrice`. `pnpm --filter @poetics-fixtures/svelte-app dev` serves it. |
| [`react-app`](react-app) | React 19: `PriceTag` (memo), `useCart`, `CheckoutPage`, `formatPrice`. Type-checked only. |
| [`mixed-app`](mixed-app) | Placeholder for React and Svelte sharing a utilities package. |

Both apps mirror the plan's running example: changing `formatPrice` should bump
the closure versions of `PriceTag`, the cart and the checkout page, and nothing
else.
