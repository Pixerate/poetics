# @poetics/adapter-svelte

## 0.6.0

### Minor Changes

- [#80](https://github.com/Pixerate/poetics/pull/80) [`95cdbff`](https://github.com/Pixerate/poetics/commit/95cdbffb0b88e4fc9bdbaf5fb5635262fdbc2eae) Thanks [@surrealroad](https://github.com/surrealroad)! - Record rune helpers as `hook` units with `framework: "svelte"` ([#73](https://github.com/Pixerate/poetics/issues/73)): functions in `.svelte.ts` / `.svelte.js` modules or component scripts whose own body calls `$state`, `$derived` or `$effect`. Calls to them are `uses-hook` edges. Adds `createsRuneState`. The CLI now runs the Svelte plugin before React's, so a `use*` rune helper is not claimed as a React hook.

## 0.5.0

### Minor Changes

- [#79](https://github.com/Pixerate/poetics/pull/79) [`b4f919b`](https://github.com/Pixerate/poetics/commit/b4f919b0dc50e691122491e815ba72aa99472d4b) Thanks [@surrealroad](https://github.com/surrealroad)! - Track functions declared in a Svelte component's `<script>` and `<script module>` as child units owned by the component ([#72](https://github.com/Pixerate/poetics/issues/72)). Each has its own content hash, taken from the function as written, and its own interface and edges from the checker. An edit to one records a version of it and of its component, and the component's version lists its children's hashes in `deps`. Detected and indexed units gain `owner`; a component's edges no longer include what its script functions use; drift, the MCP code view and `poetics index` now include owned units; `relocateUnit` sets or clears the owner when a unit moves.

### Patch Changes

- Updated dependencies [[`b4f919b`](https://github.com/Pixerate/poetics/commit/b4f919b0dc50e691122491e815ba72aa99472d4b)]:
  - @poetics/adapter-typescript@0.5.0

## 0.4.0

### Minor Changes

- [#78](https://github.com/Pixerate/poetics/pull/78) [`5ed117c`](https://github.com/Pixerate/poetics/commit/5ed117cff779ccb2a8e5428066851f6bf10a8f51) Thanks [@surrealroad](https://github.com/surrealroad)! - Svelte 4 components record their full interface: `export let` props with their defaults, the events they dispatch or forward with the type a listener receives, and their named slots with the props each passes. The component signature gains optional `events` and `slots`, which Svelte 5 and React components leave out. A component rendered with content is one `renders` edge, and `sveltePlugin` takes an optional `svelteVersion`.

### Patch Changes

- Updated dependencies [[`5ed117c`](https://github.com/Pixerate/poetics/commit/5ed117cff779ccb2a8e5428066851f6bf10a8f51)]:
  - @poetics/adapter-typescript@0.4.0

## 0.3.0

### Minor Changes

- [#77](https://github.com/Pixerate/poetics/pull/77) [`42b7098`](https://github.com/Pixerate/poetics/commit/42b7098172402970ba4ebb2e2aa10bb028f524c3) Thanks [@surrealroad](https://github.com/surrealroad)! - A Svelte component's interface now records each prop's default, `$bindable(…)` included. A props type the component declares for itself is recorded by its structure, so retyping a prop in a local `interface Props` is an interface change and renaming the interface is not. Props that `svelte2tsx` infers, or that a JavaScript component types in JSDoc, are recorded too.

## 0.2.0

### Minor Changes

- [#76](https://github.com/Pixerate/poetics/pull/76) [`6c48ba7`](https://github.com/Pixerate/poetics/commit/6c48ba70a55ffd521055226e4896a910a48d05e0) Thanks [@surrealroad](https://github.com/surrealroad)! - Svelte components are indexed (ADR 0020). `@poetics/adapter-svelte` now exports `sveltePlugin`, a framework plugin for the TypeScript indexer that replaces the `createSvelteAdapter` stub. Each `.svelte` file is turned into TypeScript by `svelte2tsx` and read by the same checker as every other file, so components and `.ts` code resolve to each other. Each component is one `component` unit, hashed from its source as written, with its props type as its interface and `renders` edges to the components it uses.
  
  `FrameworkPlugin` gains `extensions`, `transform`, `ambient` and `detect` for files that are not TypeScript, and `version` may be a string. `filesInScope` reads `.svelte` files when the `svelte` adapter is configured, and `poetics index`, `verify`, `coverage`, `backfill` and the MCP tools use the Svelte plugin when it is.

### Patch Changes

- Updated dependencies [[`6c48ba7`](https://github.com/Pixerate/poetics/commit/6c48ba70a55ffd521055226e4896a910a48d05e0)]:
  - @poetics/adapter-typescript@0.3.0

## 0.1.7

### Patch Changes

- Updated dependencies [[`1126038`](https://github.com/Pixerate/poetics/commit/1126038605e3ee809b4bc37ffabefb34f9929353)]:
  - @poetics/core@0.7.0

## 0.1.6

### Patch Changes

- Updated dependencies [[`f6a3cce`](https://github.com/Pixerate/poetics/commit/f6a3cce234ca2f956b4b65d2ee1cb4340223b0c9)]:
  - @poetics/core@0.6.0

## 0.1.5

### Patch Changes

- Updated dependencies [[`f14d1a4`](https://github.com/Pixerate/poetics/commit/f14d1a4a510a7a89f7e12e9f8133684b76f7c131)]:
  - @poetics/core@0.5.0

## 0.1.4

### Patch Changes

- Updated dependencies [[`299615f`](https://github.com/Pixerate/poetics/commit/299615fadd2c5f4f62c2372e564af4833896a6e5)]:
  - @poetics/core@0.4.0

## 0.1.3

### Patch Changes

- Updated dependencies [[`4d52ae2`](https://github.com/Pixerate/poetics/commit/4d52ae2cf980b9e22ff2a02dbd2879b4c8aaa0dc), [`25a0219`](https://github.com/Pixerate/poetics/commit/25a021942e58edb41a3569379b9f4277f8316962), [`9fa9bf4`](https://github.com/Pixerate/poetics/commit/9fa9bf41326306e2112c6cea7a373750799b24eb), [`590a911`](https://github.com/Pixerate/poetics/commit/590a911fc1fc56266de9bb833c064c11d32228f3), [`52fdda8`](https://github.com/Pixerate/poetics/commit/52fdda88e21439e04970902aa5c9ed0e3976c11e), [`e238728`](https://github.com/Pixerate/poetics/commit/e23872825cff8ea5d63b7a3330f431a1800c5470)]:
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
