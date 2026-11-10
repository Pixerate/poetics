# 0016. React contexts are units of their own kind

- Status: Proposed
- Date: 2026-11-10

## Context

The plan records React context providers and consumers "as edges to the
context object". An edge needs a unit at each end, but a context is not a
function, hook, component or type: it is a value, `createContext(…)`, and the
TypeScript indexer only tracked variables that hold a function. So providers
and consumers had nothing to point at, and a change to what a context carries
reached none of the components that read it.

Options considered:

- **Edges to the provider component.** Many contexts have no provider of
  their own, and consumers do not depend on the provider's code.
- **Record contexts as `type` or `function` units.** Either would mislead the
  matcher, the change check and every reader of a unit file: a context is
  neither called nor used as a type.
- **A new `context` kind.** One more value in `kind`, and an interface that
  says what providers and consumers agree on.

## Decision

`context` is a unit kind. A framework plugin names a variable as one through
`FrameworkPlugin.value`, a hook for exported variables that hold no function;
without a plugin that claims it, such a variable is still not a unit.

React's plugin claims `createContext(…)` and `React.createContext(…)`. A
context's interface is the type of its value (as written in `createContext<T>`,
or as the checker infers `T`) and its default value, since a consumer with no
provider above it reads the default. Any use of a context is a `uses-context`
edge: `useContext(Ctx)`, `use(Ctx)`, `<Ctx.Provider>`, `<Ctx>` and
`static contextType = Ctx` alike.

## Consequences

- A change to a context's value type or default is an interface change, and
  every provider and consumer is flagged as a caller to review.
- `kind` gains a value in `schemas/unit.schema.json`, `UnitKind` and
  `docs/data-model.md`. Code that tells types from values treats a context as
  a value.
- Svelte's `setContext` and `getContext` take a key, not a context object, so
  they need their own design when the Svelte adapter arrives.
