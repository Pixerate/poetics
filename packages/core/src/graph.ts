import { closureHash, contentHash } from "./hash.ts";
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

export interface ImpactOptions {
  /** Changed units whose interface hash changed; their direct callers need review. */
  interfaceChanged?: readonly Uid[];
}

/**
 * Builds the graph from adapter edges. Unresolved edges are kept for display
 * and never contribute to hashes or impact.
 */
export function createGraph(edges: readonly Edge[], unresolved: readonly UnresolvedEdge[] = []): CompositionGraph {
  const units = new Set<Uid>();
  const out = new Map<Uid, Set<Uid>>();
  const into = new Map<Uid, Set<Uid>>();
  const add = (map: Map<Uid, Set<Uid>>, key: Uid, value: Uid) => {
    const set = map.get(key);
    if (set) set.add(value);
    else map.set(key, new Set([value]));
  };
  for (const edge of edges) {
    units.add(edge.from).add(edge.to);
    // Two kinds of use between the same pair (calls and references-type) are one dependency.
    add(out, edge.from, edge.to);
    add(into, edge.to, edge.from);
  }
  for (const edge of unresolved) units.add(edge.from);
  return {
    units,
    edges: [...edges],
    unresolved: [...unresolved],
    dependenciesOf: (uid) => [...(out.get(uid) ?? [])].sort(),
    dependentsOf: (uid) => [...(into.get(uid) ?? [])].sort(),
  };
}

/**
 * Collapses cycles into strongly connected components so they hash together.
 * Components come in dependency order: each after every component it uses.
 * Members are sorted, so the result is deterministic.
 */
export function stronglyConnectedComponents(graph: CompositionGraph): Uid[][] {
  // Iterative Tarjan: recursion would overflow on long call chains.
  const index = new Map<Uid, number>();
  const low = new Map<Uid, number>();
  const onStack = new Set<Uid>();
  const stack: Uid[] = [];
  const components: Uid[][] = [];
  let next = 0;

  for (const root of [...graph.units].sort()) {
    if (index.has(root)) continue;
    const frames: Array<{ uid: Uid; deps: Uid[]; at: number }> = [];
    const visit = (uid: Uid) => {
      index.set(uid, next);
      low.set(uid, next);
      next++;
      stack.push(uid);
      onStack.add(uid);
      frames.push({ uid, deps: graph.dependenciesOf(uid), at: 0 });
    };
    visit(root);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      if (frame.at < frame.deps.length) {
        const dep = frame.deps[frame.at++]!;
        if (!index.has(dep)) visit(dep);
        else if (onStack.has(dep)) low.set(frame.uid, Math.min(low.get(frame.uid)!, index.get(dep)!));
        continue;
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) low.set(parent.uid, Math.min(low.get(parent.uid)!, low.get(frame.uid)!));
      if (low.get(frame.uid) === index.get(frame.uid)) {
        const component: Uid[] = [];
        let member: Uid;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.uid);
        components.push(component.sort());
      }
    }
  }
  return components;
}

/**
 * Bottom-up closure hashes for every unit, given each unit's own content hash.
 * Units in `contentHashes` with no edges are leaves. Members of a cycle each
 * hash their own content with one hash of the whole cycle, so a change to any
 * member, or to anything the cycle uses, changes all of them.
 */
export function computeClosureHashes(graph: CompositionGraph, contentHashes: ReadonlyMap<Uid, Hash>): Map<Uid, Hash> {
  const contentOf = (uid: Uid): Hash => {
    const hash = contentHashes.get(uid);
    if (hash === undefined) throw new Error(`computeClosureHashes: no content hash for unit ${uid}`);
    return hash;
  };
  const closures = new Map<Uid, Hash>();
  const leaves = [...contentHashes.keys()].filter((uid) => !graph.units.has(uid)).map((uid) => [uid]);

  for (const component of [...stronglyConnectedComponents(graph), ...leaves]) {
    const members = new Set(component);
    const external = new Set<Hash>();
    for (const uid of component) {
      for (const dep of graph.dependenciesOf(uid)) {
        // Components arrive in dependency order, so every external dependency is already hashed.
        if (!members.has(dep)) external.add(closures.get(dep)!);
      }
    }
    const only = component[0]!;
    if (component.length === 1 && !graph.dependenciesOf(only).includes(only)) {
      closures.set(only, closureHash(contentOf(only), [...external]));
      continue;
    }
    const cycle = closureHash(contentHash(component.map((uid) => [uid, contentOf(uid)])), [...external]);
    for (const uid of component) closures.set(uid, closureHash(contentOf(uid), [cycle]));
  }
  return closures;
}

/**
 * Units whose behaviour may have changed, ranked by distance from the edit.
 * Changed units are `own`; their transitive dependents are `closure`, except
 * direct callers of an interface change, which are `interface-caller`.
 */
export function impactOf(graph: CompositionGraph, changed: readonly Uid[], options: ImpactOptions = {}): ImpactEntry[] {
  const interfaceChanged = new Set(options.interfaceChanged ?? []);
  const entries = new Map<Uid, ImpactEntry>();
  let frontier = [...new Set([...changed, ...interfaceChanged])];
  for (const uid of frontier) entries.set(uid, { uid, distance: 0, reason: "own" });

  for (let distance = 1; frontier.length > 0; distance++) {
    const nextFrontier: Uid[] = [];
    for (const uid of frontier) {
      for (const dependent of graph.dependentsOf(uid)) {
        const callsChangedInterface = distance === 1 && interfaceChanged.has(uid);
        const existing = entries.get(dependent);
        if (existing === undefined) {
          entries.set(dependent, { uid: dependent, distance, reason: callsChangedInterface ? "interface-caller" : "closure" });
          nextFrontier.push(dependent);
        } else if (callsChangedInterface && existing.reason === "closure") {
          existing.reason = "interface-caller";
        }
      }
    }
    frontier = nextFrontier;
  }
  return [...entries.values()].sort((a, b) => a.distance - b.distance || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
}
