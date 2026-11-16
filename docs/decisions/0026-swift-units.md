# 0026. Swift units are non-private declarations, with SwiftUI views as components

- Status: Accepted (2026-11-16)
- Date: 2026-11-15

## Context

The Swift adapter ([ADR 0008](0008-out-of-process-adapters.md),
[#11](https://github.com/Pixerate/poetics/issues/11)) speaks the contract in
[ADR 0025](0025-out-of-process-adapter-contract.md), parses with swift-syntax,
and lives in its own `poetics-swift` repository. It has to decide what a unit
is in Swift, which TypeScript's rules do not answer:

- **Access.** A TypeScript unit is an export. In a Swift app target almost
  nothing is `public`: declarations default to `internal` and are used across
  the whole module.
- **Overloads.** Swift functions can share a name and differ in argument
  labels or types, so `file#name` does not identify one.
- **Extensions.** A type's methods and conformances can be spread over many
  extensions, in other files.
- **Conditional compilation.** Multi-platform apps declare the same type or
  function more than once, under `#if os(iOS)` and `#else`.
- **Edges.** swift-syntax sees syntax only, and resolving names exactly needs
  a build index (IndexStoreDB) that exists only after the project is built.

The first adopters are Xcode apps with local Swift packages: SwiftUI views
over `@Observable` and `ObservableObject` models, UIKit and AppKit code side
by side under `#if`, and app extensions.

## Decision

**Units are the declarations other files can use.**

- A top-level `func`, `struct`, `class`, `enum`, `actor`, `protocol` or
  `typealias` whose access is `internal`, `package`, `public` or `open` is a
  unit. `private` and `fileprivate` ones are not.
- Methods, initialisers, subscripts, computed properties and nested types of
  a unit, at the same access, are owned units (`owner` is the type's key), as
  Svelte script functions are. Stored properties are part of the type, not
  units.
- A member declared in an extension is owned by the extended type when that
  type is a unit in the batch, whatever file the extension is in. A member of
  an extension of another module's type (`extension Color`) is a unit with no
  owner, named `Color.brand`.

**Kinds and frameworks:**

- Functions, methods, initialisers, subscripts and computed properties are
  `function`.
- Structs, classes, enums, actors, protocols and type aliases are `type`.
- A type that conforms to `View` (in its declaration or any extension) is a
  `component` with framework `swiftui`. Its interface is its stored
  properties and initialisers: what a parent passes in.
- An `EnvironmentKey` type, or an `@Entry` property in an `extension
  EnvironmentValues`, is a `context` with framework `swiftui`. Its interface
  is the value type.
- `Framework` gains `swiftui`. UIKit and AppKit code is `none`, with no kinds
  of its own until a gate shows they need one.

**Keys use Swift's full names.** A function's key is its name with argument
labels, `Canvas.swift#Canvas.draw(_:in:)`, so overloads that differ in labels
are distinct units. Overloads that differ only in types are refused as
ambiguous, reported as unresolved, and not guessed at.

**A declaration repeated across `#if` branches is one unit.** Its content
covers every branch, so editing the iOS or the macOS version is a change to
the same unit, and its interface is the union of the branches' interfaces.

**Edges are syntactic first, then exact.**

- `calls`, `renders` (a view used in another view's `body` or a
  `@ViewBuilder`), `references-type`, `uses-context` (`@Environment`,
  `.environment(…)`, `@EnvironmentObject`) and a new `conforms-to` (a type to
  a protocol or superclass it names, in its declaration or an extension).
- Without a build index, a use resolves when exactly one unit in the batch
  has that name, with `resolution: "name"`. A use that matches several units,
  or a member call on a value of unknown type, is unresolved and recorded with
  its reason.
- When a build index exists, the adapter can read it and resolve edges
  exactly (`resolution: "exact"`). That comes after the first release.

**Hashes:**

- The content hash is the declaration's syntax tree with trivia (comments and
  whitespace) removed and its own name excluded.
- The interface hash is what callers depend on: generic parameters, argument
  labels and types, return type, effects (`async`, `throws`), access, and
  attributes that change how it is called (`@MainActor`, `@discardableResult`,
  property wrappers). For a type, it is its header and its stored properties,
  and the interfaces of its members at the same access.
- Swift has no erasable types, so there is no `runtimeHash`.

## Consequences

- `UnitKind` stays as it is. `Framework` gains `swiftui` and `EdgeKind` gains
  `conforms-to`, in the schema, `types.ts` and `docs/data-model.md`, when the
  first Swift output is consumed.
- Most of an app's code becomes units, as in TypeScript, where most modules
  export what they define. A `fileprivate` helper stays inside the unit that
  uses it.
- Edges resolved by name can be missing (a call through a protocol or a
  closure) but are never wrong: an ambiguous name is recorded as unresolved.
  Impact warnings are only as complete as the edges until the build index
  work lands.
- An extension of a type in another file changes the type's unit, so a change
  there flags the type's callers, as a change to its own body does.
- Treating `#if` branches as one unit means a platform-only edit shows up as
  a change for every platform. That matches how the code is reviewed: as one
  declaration.
- The identity gate runs on open-source Swift repositories (an app and a
  package) before the adapter is recommended for real use, as it did for
  React and Svelte. Backfill and its eval reach Swift once they go through the
  adapter interface (ADR 0025).
- The `poetics-swift` repository gets its own skill, as
  `poetics-svelte-component` does, steering code to shapes the adapter reads
  precisely: views with explicit initialiser parameters, environment values
  through `@Entry`, and one declaration per name.
