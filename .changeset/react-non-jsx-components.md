---
"@poetics/adapter-react": minor
"@poetics/adapter-typescript": minor
---

The React adapter now claims PascalCase functions that render without JSX as components: a React element return type (`ReactNode`, `ReactElement`, `JSX.Element`, or a `Promise` of one), an `FC`-style variable annotation, a returned cast to an element type, or a returned `createElement`, `cloneElement` or `createPortal`. `FrameworkPlugin` gains an optional `version` that the indexer's cache keys on, so units classified by older rules are indexed again; `poetics index` then reclassifies them.
