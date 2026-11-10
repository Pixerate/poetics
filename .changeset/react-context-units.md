---
"@poetics/core": minor
"@poetics/adapter-typescript": minor
"@poetics/adapter-react": minor
---

React contexts are units of a new kind, `context` (ADR 0016). The React adapter tracks `createContext` values, with their value type and default as the interface, and records every provider and consumer (`useContext`, `use`, `<Ctx.Provider>`, `<Ctx>`, `static contextType`) as a `uses-context` edge. `FrameworkPlugin` gains a `value` hook for exported variables that hold no function.
