import { notImplemented } from "./errors.ts";
import type { Edge, Hash, Uid, UnresolvedEdge } from "./types.ts";

/** Units and the "A uses B" edges between them. */
export interface CompositionGraph {
  readonly units: ReadonlySet<Uid>;
  readonly edges: readonly Edge[];
  readonly unresolved: readonly UnresolvedEdge[];
  dependenciesOf(uid: Uid): Uid[];
  dependentsOf(uid: Uid): Uid[];
}

export interface ImpactEntry {
  uid: Uid;
  /** Edges between this unit and the nearest changed unit. */
  distance: number;
  reason: "own" | "closure" | "interface-caller";
}

export function createGraph(_edges: readonly Edge[], _unresolved?: readonly UnresolvedEdge[]): CompositionGraph {
  return notImplemented("createGraph");
}

/** Collapses cycles into strongly connected components so they hash together. */
export function stronglyConnectedComponents(_graph: CompositionGraph): Uid[][] {
  return notImplemented("stronglyConnectedComponents");
}

/** Bottom-up closure hashes for every unit, given each unit's own content hash. */
export function computeClosureHashes(_graph: CompositionGraph, _contentHashes: ReadonlyMap<Uid, Hash>): Map<Uid, Hash> {
  return notImplemented("computeClosureHashes");
}

/** Units whose behaviour may have changed, ranked by distance from the edit. */
export function impactOf(_graph: CompositionGraph, _changed: readonly Uid[]): ImpactEntry[] {
  return notImplemented("impactOf");
}
