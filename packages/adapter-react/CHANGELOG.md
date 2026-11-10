# @poetics/adapter-react

## 0.3.2

### Patch Changes

- Updated dependencies [[`f6a3cce`](https://github.com/Pixerate/poetics/commit/f6a3cce234ca2f956b4b65d2ee1cb4340223b0c9)]:
  - @poetics/core@0.6.0
  - @poetics/adapter-typescript@0.2.2

## 0.3.1

### Patch Changes

- Updated dependencies [[`f14d1a4`](https://github.com/Pixerate/poetics/commit/f14d1a4a510a7a89f7e12e9f8133684b76f7c131)]:
  - @poetics/core@0.5.0
  - @poetics/adapter-typescript@0.2.1

## 0.3.0

### Minor Changes

- [#59](https://github.com/Pixerate/poetics/pull/59) [`299615f`](https://github.com/Pixerate/poetics/commit/299615fadd2c5f4f62c2372e564af4833896a6e5) Thanks [@surrealroad](https://github.com/surrealroad)! - React contexts are units of a new kind, `context` (ADR 0016). The React adapter tracks `createContext` values, with their value type and default as the interface, and records every provider and consumer (`useContext`, `use`, `<Ctx.Provider>`, `<Ctx>`, `static contextType`) as a `uses-context` edge. `FrameworkPlugin` gains a `value` hook for exported variables that hold no function.

### Patch Changes

- Updated dependencies [[`299615f`](https://github.com/Pixerate/poetics/commit/299615fadd2c5f4f62c2372e564af4833896a6e5)]:
  - @poetics/core@0.4.0
  - @poetics/adapter-typescript@0.2.0

## 0.2.0

### Minor Changes

- [#45](https://github.com/Pixerate/poetics/pull/45) [`5fa1e89`](https://github.com/Pixerate/poetics/commit/5fa1e892c4b4f4e3a52f47770beedfae91c9b07a) Thanks [@surrealroad](https://github.com/surrealroad)! - Add the React adapter. `reactPlugin` plugs into the TypeScript indexer through a new `FrameworkPlugin` interface. It detects components (PascalCase functions that return JSX, or are wrapped in `memo`, `forwardRef` or `lazy`) and hooks, gives components their props, default prop values and forwarded ref as their interface, and records JSX tags as `renders` edges. `createReactAdapter` now takes the indexer's options. The CLI and MCP server run the plugin when `.poetics/config.json` lists `react` in `adapters`. `poetics init` now reads tsconfig files with TypeScript's own parser, so `paths` entries such as `"@/*"` no longer break it.

- [#56](https://github.com/Pixerate/poetics/pull/56) [`2d9d2c2`](https://github.com/Pixerate/poetics/commit/2d9d2c2bb204000430a69194741c6837a2bc9d5d) Thanks [@surrealroad](https://github.com/surrealroad)! - The React adapter claims class components: classes that extend `Component` or `PureComponent`, bare or as `React.X`. Their interface is the props type argument and `static defaultProps`, and JSX in them records `renders` edges. The TypeScript indexer reads exported classes and keeps one only when a framework plugin claims it, so plain classes stay untracked; `FrameworkPlugin.claim` and `signature` may be called without a function for a class.

- [#53](https://github.com/Pixerate/poetics/pull/53) [`4b15948`](https://github.com/Pixerate/poetics/commit/4b159485437b1bbe130d02692ec96b3e3d08e1b9) Thanks [@surrealroad](https://github.com/surrealroad)! - The React adapter now claims PascalCase functions that render without JSX as components: a React element return type (`ReactNode`, `ReactElement`, `JSX.Element`, or a `Promise` of one), an `FC`-style variable annotation, a returned cast to an element type, or a returned `createElement`, `cloneElement` or `createPortal`. `FrameworkPlugin` gains an optional `version` that the indexer's cache keys on, so units classified by older rules are indexed again; `poetics index` then reclassifies them.

### Patch Changes

- Updated dependencies [[`e47a3d4`](https://github.com/Pixerate/poetics/commit/e47a3d42e5dfc25a8e17e58735b10a528c62b509), [`4d52ae2`](https://github.com/Pixerate/poetics/commit/4d52ae2cf980b9e22ff2a02dbd2879b4c8aaa0dc), [`25a0219`](https://github.com/Pixerate/poetics/commit/25a021942e58edb41a3569379b9f4277f8316962), [`9fa9bf4`](https://github.com/Pixerate/poetics/commit/9fa9bf41326306e2112c6cea7a373750799b24eb), [`590a911`](https://github.com/Pixerate/poetics/commit/590a911fc1fc56266de9bb833c064c11d32228f3), [`2b00ca8`](https://github.com/Pixerate/poetics/commit/2b00ca80421daf47fb1ad3eeb94461bb547f3032), [`5fa1e89`](https://github.com/Pixerate/poetics/commit/5fa1e892c4b4f4e3a52f47770beedfae91c9b07a), [`2d9d2c2`](https://github.com/Pixerate/poetics/commit/2d9d2c2bb204000430a69194741c6837a2bc9d5d), [`4b15948`](https://github.com/Pixerate/poetics/commit/4b159485437b1bbe130d02692ec96b3e3d08e1b9), [`52fdda8`](https://github.com/Pixerate/poetics/commit/52fdda88e21439e04970902aa5c9ed0e3976c11e), [`e238728`](https://github.com/Pixerate/poetics/commit/e23872825cff8ea5d63b7a3330f431a1800c5470)]:
  - @poetics/adapter-typescript@0.1.0
  - @poetics/core@0.3.0

## 0.1.2

### Patch Changes

- [`b70f34f`](https://github.com/Pixerate/poetics/commit/b70f34fb688e8e71bbf63a375ab3aa0f2c2b692c) Thanks [@surrealroad](https://github.com/surrealroad)! - Published `exports` no longer include the `poetics-source` condition, which pointed at `src/index.ts`, a file the packages don't ship. Consumers running with `--conditions=poetics-source` now resolve to `dist/` instead of failing.
- Updated dependencies [[`b70f34f`](https://github.com/Pixerate/poetics/commit/b70f34fb688e8e71bbf63a375ab3aa0f2c2b692c)]:
  - @poetics/core@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [[`02d4607`](https://github.com/Pixerate/poetics/commit/02d460760e1a6f155fa030346f6a2f6a3c0e362a)]:
  - @poetics/core@0.2.0

## 0.1.0

### Minor Changes

- [`ed9ebd8`](https://github.com/Pixerate/poetics/commit/ed9ebd87250609a39068752b5c10d5292a32973a) Thanks [@surrealroad](https://github.com/surrealroad)! - Seed the packages with typed interface stubs from the plan. `@poetics/core` mints uids and computes provisional hashes; `@poetics/store` validates the `.poetics/` JSON store and maintains the local SQLite index.

### Patch Changes

- Updated dependencies [[`ed9ebd8`](https://github.com/Pixerate/poetics/commit/ed9ebd87250609a39068752b5c10d5292a32973a)]:
  - @poetics/core@0.1.0
