import type { Edge, Framework, Span, UnitKind, UnresolvedEdge } from "./types.ts";

/** A unit as an adapter sees it in source, before it has a uid. */
export interface UnitCandidate {
  name: string;
  kind: UnitKind;
  framework: Framework;
  span: Span;
  /** Name of the enclosing unit, e.g. the Svelte component owning a script function. */
  owner?: string;
}

/** Edges whose endpoints are still source locations; the core resolves them to uids. */
export interface CandidateEdge {
  from: Span;
  to: Span;
  kind: Edge["kind"];
}

/**
 * Everything framework-specific sits behind this interface. An adapter answers
 * four questions: which nodes are units, what each unit's interface is, what it
 * uses, and where its source span is.
 */
export interface FrameworkAdapter {
  readonly framework: Framework;
  readonly extensions: readonly string[];
  detectUnits(file: string): UnitCandidate[];
  interfaceOf(unit: UnitCandidate): unknown;
  edgesOf(unit: UnitCandidate): { edges: CandidateEdge[]; unresolved: Omit<UnresolvedEdge, "from">[] };
}
