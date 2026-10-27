# Mixed fixture (placeholder)

A React app and a Svelte app sharing one utilities package, to check that a
`.svelte` component and a `.tsx` component calling the same `.ts` function
resolve to the same unit. Planned for phase 3; until then
[`../react-app`](../react-app) and [`../svelte-app`](../svelte-app) carry the
same `formatPrice` utility so the shape is clear.
