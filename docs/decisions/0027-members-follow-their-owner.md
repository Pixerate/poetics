# 0027. A member follows its owner when the owner is renamed or moved

- Status: Proposed
- Date: 2026-11-21
- Refines: identity matching as [`docs/data-model.md`](../data-model.md)
  describes it, for [ADR 0026](0026-swift-units.md)'s members

## Context

Identity matching has four stages: declared lineage, the same file and name,
the same content, and similar syntax trees. Each stage looks at a unit alone.

Swift members are units of their own (ADR 0026), and their names start with
their type's: `JSONEncoding.default`. Renaming the type therefore renames every
member, and an editor's rename also rewrites the type wherever members use it.
The identity gate on Alamofire found two ways this loses identities:

- **A member that names its type** changes name and content together:
  `static var default: JSONEncoding { JSONEncoding() }`. It is too small to
  match by similarity, so its uid is lost.
- **Members with the same content** (the empty default implementations of
  `EventMonitor`) are queued for a person: content cannot tell them apart,
  and their names all changed, so pairing by name fails.

Yet in both cases the owner itself was matched, and each member still has the
same name within it: `default` in `JSONEncodingGate`, `requestDidCancel(_:)` in
`EventMonitorGate`. Svelte's script functions have owners too (their
component), though their names do not include it.

Options considered:

- **Strip the type from names before matching.** Simple, but it would let a
  member of one type match a member of another that happens to share a name.
- **A stage after similarity in which members follow their owner.** It only
  pairs units whose owners were themselves matched, and it needs the owner of
  each unit on both sides, which adapters already report.

## Decision

**A fifth stage matches members to members of their owner's match.**

- A tracked unit carries the uid of the unit that owns it, from the store; a
  unit in the code carries the key of its owner in the same snapshot, from
  the adapter.
- When a tracked member's owner was matched to a unit at a new place or under
  a new name, the member pairs with the one open unit owned by that match that
  has the same name relative to its owner (the name after the owner's name and
  a dot, or the whole name when it does not start with the owner's). The pair
  must be in the same namespace, and the name must be unique on each side.
- The stage repeats until it finds nothing new, so nested types bring their
  members along.
- Units that content or similarity found ambiguous are held, not queued, until
  this stage has run. Whatever the stage leaves is decided as before: a group
  down to one unit on each side matches, and the rest is queued.

A match from this stage is recorded with `via: "owner"`. An owner that stayed
at its place does not lead: a member renamed inside an unchanged type is an
ordinary rename, matched by the earlier stages or not at all.

## Consequences

- Renaming or moving a Swift type keeps its members' uids when they also
  changed, provided each keeps its name within the type.
- A member that is renamed in the same commit as its type is not helped. It
  is matched by content or similarity, as before.
- Two members in one type that swap names while the type is renamed would be
  paired by name, wrongly. The earlier stages decide such members first
  whenever their content tells them apart.
- `CodeUnit` gains an optional `owner`, and `TrackedUnit` an optional
  `ownerUid`; adapters that report no owners are unaffected.
