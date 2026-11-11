# @poetics/adapter-typescript

## 0.6.0

### Minor Changes

- [#83](https://github.com/Pixerate/poetics/pull/83) [`eb94bf6`](https://github.com/Pixerate/poetics/commit/eb94bf607589f217ba13cdc28e0f41a03d9e3f58) Thanks [@surrealroad](https://github.com/surrealroad)! - Record Svelte contexts as `context` units (ADR 0021, [#74](https://github.com/Pixerate/poetics/issues/74)): what `createContext()` from `svelte` returns, destructured into its getter and setter or kept whole, and an exported constant that its own module passes to `setContext`, `getContext` or `hasContext` as the key. A context's interface is its value type; setting or reading it is a `uses-context` edge. The TypeScript indexer accepts an array-destructured variable as a unit when a plugin claims it, and `DetectedUnit` gains `aliases`. Adds `svelteContextKind` and `svelteContextSignature`.

## 0.5.1

### Patch Changes

- [#82](https://github.com/Pixerate/poetics/pull/82) [`d25b259`](https://github.com/Pixerate/poetics/commit/d25b2595e13495a49505972bdecdb6bcbf576b8f) Thanks [@surrealroad](https://github.com/surrealroad)! - Stop re-running a plugin's transform, such as svelte2tsx, on unchanged files ([#66](https://github.com/Pixerate/poetics/issues/66)). The indexer's cache keeps each file's imports and whether it changes globals, and a re-index checks only the files that changed, what they import and the files that declare globals. Results are unchanged; on a 2,128-component Svelte repository a re-index after a small refactor takes a third of the time. The cache format changes, so the first index after upgrading is a full one.

## 0.5.0

### Minor Changes

- [#79](https://github.com/Pixerate/poetics/pull/79) [`b4f919b`](https://github.com/Pixerate/poetics/commit/b4f919b0dc50e691122491e815ba72aa99472d4b) Thanks [@surrealroad](https://github.com/surrealroad)! - Track functions declared in a Svelte component's `<script>` and `<script module>` as child units owned by the component ([#72](https://github.com/Pixerate/poetics/issues/72)). Each has its own content hash, taken from the function as written, and its own interface and edges from the checker. An edit to one records a version of it and of its component, and the component's version lists its children's hashes in `deps`. Detected and indexed units gain `owner`; a component's edges no longer include what its script functions use; drift, the MCP code view and `poetics index` now include owned units; `relocateUnit` sets or clears the owner when a unit moves.

## 0.4.0

### Minor Changes

- [#78](https://github.com/Pixerate/poetics/pull/78) [`5ed117c`](https://github.com/Pixerate/poetics/commit/5ed117cff779ccb2a8e5428066851f6bf10a8f51) Thanks [@surrealroad](https://github.com/surrealroad)! - Svelte 4 components record their full interface: `export let` props with their defaults, the events they dispatch or forward with the type a listener receives, and their named slots with the props each passes. The component signature gains optional `events` and `slots`, which Svelte 5 and React components leave out. A component rendered with content is one `renders` edge, and `sveltePlugin` takes an optional `svelteVersion`.

## 0.3.0

### Minor Changes

- [#76](https://github.com/Pixerate/poetics/pull/76) [`6c48ba7`](https://github.com/Pixerate/poetics/commit/6c48ba70a55ffd521055226e4896a910a48d05e0) Thanks [@surrealroad](https://github.com/surrealroad)! - Svelte components are indexed (ADR 0020). `@poetics/adapter-svelte` now exports `sveltePlugin`, a framework plugin for the TypeScript indexer that replaces the `createSvelteAdapter` stub. Each `.svelte` file is turned into TypeScript by `svelte2tsx` and read by the same checker as every other file, so components and `.ts` code resolve to each other. Each component is one `component` unit, hashed from its source as written, with its props type as its interface and `renders` edges to the components it uses.
  
  `FrameworkPlugin` gains `extensions`, `transform`, `ambient` and `detect` for files that are not TypeScript, and `version` may be a string. `filesInScope` reads `.svelte` files when the `svelte` adapter is configured, and `poetics index`, `verify`, `coverage`, `backfill` and the MCP tools use the Svelte plugin when it is.

## 0.2.3

### Patch Changes

- Updated dependencies [[`1126038`](https://github.com/Pixerate/poetics/commit/1126038605e3ee809b4bc37ffabefb34f9929353)]:
  - @poetics/core@0.7.0

## 0.2.2

### Patch Changes

- Updated dependencies [[`f6a3cce`](https://github.com/Pixerate/poetics/commit/f6a3cce234ca2f956b4b65d2ee1cb4340223b0c9)]:
  - @poetics/core@0.6.0

## 0.2.1

### Patch Changes

- Updated dependencies [[`f14d1a4`](https://github.com/Pixerate/poetics/commit/f14d1a4a510a7a89f7e12e9f8133684b76f7c131)]:
  - @poetics/core@0.5.0

## 0.2.0

### Minor Changes

- [#59](https://github.com/Pixerate/poetics/pull/59) [`299615f`](https://github.com/Pixerate/poetics/commit/299615fadd2c5f4f62c2372e564af4833896a6e5) Thanks [@surrealroad](https://github.com/surrealroad)! - React contexts are units of a new kind, `context` (ADR 0016). The React adapter tracks `createContext` values, with their value type and default as the interface, and records every provider and consumer (`useContext`, `use`, `<Ctx.Provider>`, `<Ctx>`, `static contextType`) as a `uses-context` edge. `FrameworkPlugin` gains a `value` hook for exported variables that hold no function.

### Patch Changes

- Updated dependencies [[`299615f`](https://github.com/Pixerate/poetics/commit/299615fadd2c5f4f62c2372e564af4833896a6e5)]:
  - @poetics/core@0.4.0

## 0.1.0

### Minor Changes

- [#33](https://github.com/Pixerate/poetics/pull/33) [`e47a3d4`](https://github.com/Pixerate/poetics/commit/e47a3d42e5dfc25a8e17e58735b10a528c62b509) Thanks [@surrealroad](https://github.com/surrealroad)! - Add the TypeScript indexer. It detects exported functions, hooks and types; computes content, runtime and interface hashes over normalised syntax trees; and resolves cross-file edges through the type checker. A reused program and a per-file cache skip unchanged files. `createTypeScriptAdapter` exposes it through `FrameworkAdapter`.

- [#34](https://github.com/Pixerate/poetics/pull/34) [`590a911`](https://github.com/Pixerate/poetics/commit/590a911fc1fc56266de9bb833c064c11d32228f3) Thanks [@surrealroad](https://github.com/surrealroad)! - Add identity matching. `matchIdentities` follows tracked units across renames, moves, splits and merges: declared lineage first, then file and name, then content hash, then syntax-tree similarity. Ambiguous matches are queued rather than guessed. The TypeScript indexer now gives each unit a similarity `fingerprint`.

- [#37](https://github.com/Pixerate/poetics/pull/37) [`2b00ca8`](https://github.com/Pixerate/poetics/commit/2b00ca80421daf47fb1ad3eeb94461bb547f3032) Thanks [@surrealroad](https://github.com/surrealroad)! - The MCP server reads the code. Context packs include the unit's code and signature, and the signatures of its callers and dependencies. `poetics_impact` ranks the units a change reaches through the composition graph, and `poetics_changes` does too with `impact: true`. `poetics_verify` reports what is behind in a path scope. The indexer gives each unit a `signatureText`, and counts what a private helper uses as used by the exported unit that calls it.

- [#45](https://github.com/Pixerate/poetics/pull/45) [`5fa1e89`](https://github.com/Pixerate/poetics/commit/5fa1e892c4b4f4e3a52f47770beedfae91c9b07a) Thanks [@surrealroad](https://github.com/surrealroad)! - Add the React adapter. `reactPlugin` plugs into the TypeScript indexer through a new `FrameworkPlugin` interface. It detects components (PascalCase functions that return JSX, or are wrapped in `memo`, `forwardRef` or `lazy`) and hooks, gives components their props, default prop values and forwarded ref as their interface, and records JSX tags as `renders` edges. `createReactAdapter` now takes the indexer's options. The CLI and MCP server run the plugin when `.poetics/config.json` lists `react` in `adapters`. `poetics init` now reads tsconfig files with TypeScript's own parser, so `paths` entries such as `"@/*"` no longer break it.

- [#56](https://github.com/Pixerate/poetics/pull/56) [`2d9d2c2`](https://github.com/Pixerate/poetics/commit/2d9d2c2bb204000430a69194741c6837a2bc9d5d) Thanks [@surrealroad](https://github.com/surrealroad)! - The React adapter claims class components: classes that extend `Component` or `PureComponent`, bare or as `React.X`. Their interface is the props type argument and `static defaultProps`, and JSX in them records `renders` edges. The TypeScript indexer reads exported classes and keeps one only when a framework plugin claims it, so plain classes stay untracked; `FrameworkPlugin.claim` and `signature` may be called without a function for a class.

- [#53](https://github.com/Pixerate/poetics/pull/53) [`4b15948`](https://github.com/Pixerate/poetics/commit/4b159485437b1bbe130d02692ec96b3e3d08e1b9) Thanks [@surrealroad](https://github.com/surrealroad)! - The React adapter now claims PascalCase functions that render without JSX as components: a React element return type (`ReactNode`, `ReactElement`, `JSX.Element`, or a `Promise` of one), an `FC`-style variable annotation, a returned cast to an element type, or a returned `createElement`, `cloneElement` or `createPortal`. `FrameworkPlugin` gains an optional `version` that the indexer's cache keys on, so units classified by older rules are indexed again; `poetics index` then reclassifies them.

### Patch Changes

- Updated dependencies [[`4d52ae2`](https://github.com/Pixerate/poetics/commit/4d52ae2cf980b9e22ff2a02dbd2879b4c8aaa0dc), [`25a0219`](https://github.com/Pixerate/poetics/commit/25a021942e58edb41a3569379b9f4277f8316962), [`9fa9bf4`](https://github.com/Pixerate/poetics/commit/9fa9bf41326306e2112c6cea7a373750799b24eb), [`590a911`](https://github.com/Pixerate/poetics/commit/590a911fc1fc56266de9bb833c064c11d32228f3), [`52fdda8`](https://github.com/Pixerate/poetics/commit/52fdda88e21439e04970902aa5c9ed0e3976c11e), [`e238728`](https://github.com/Pixerate/poetics/commit/e23872825cff8ea5d63b7a3330f431a1800c5470)]:
  - @poetics/core@0.3.0
