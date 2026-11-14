---
name: poetics-react-component
description: Use when creating or editing React components or hooks in a Poetics repo, so they take shapes the React adapter resolves precisely.
---

# React components the adapter can read

The React adapter finds units by shape. Code in these shapes gets exact
interfaces and edges; anything else may become an unresolved edge.

- **Named exports** for components and hooks. Default exports are allowed but
  record `location.export: "default"` in the unit file.
- **Typed props:** declare a named `Props` type or interface and annotate the
  first parameter: `export function PriceTag({ amount }: PriceTagProps)`.
  The props type is the component's interface.
- **Default prop values are interface.** Changing one is an `interface` change.
- **Hooks are named `use` + capital letter** and only called from components or
  other hooks.
- **Wrappers:** `memo`, `forwardRef` and `lazy` are fine; the wrapped function
  is the unit. For `forwardRef`, type the ref.
- **A component with no JSX** (a provider that returns `children`, one built
  with `createElement`) is still a component when it says so: give it a React
  return type (`ReactNode`, `ReactElement`, `JSX.Element`), annotate its
  variable as `FC`, or cast what it returns (`children as ReactElement`).
  Otherwise it is recorded as a plain function.
- **Class components** extend `Component` or `PureComponent` (bare or as
  `React.Component`) and pass their props type as the first type argument:
  `class Counter extends Component<CounterProps, CounterState>`. The props
  type and `static defaultProps` are the interface; state is not. Prefer a
  function component for new code.
- **Contexts:** export the context made by `createContext`, with its value
  type written: `export const CartContext = createContext<Cart | null>(null)`.
  It is a `context` unit, and every provider and consumer gets a
  `uses-context` edge to it. Its value type and default are its interface, so
  changing either flags every component that reads it.
- **Avoid hiding what renders:** components chosen from a map, render props and
  higher-order components become unresolved edges. Prefer explicit JSX where
  you can, and when you cannot, say so in the rationale.
- Follow `poetics-change` to record the unit.
