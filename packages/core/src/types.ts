/** ULID minted the first time Poetics sees a unit. Never changes. */
export type Uid = string;

/**
 * `b3:<64 hex>` from the indexer, or `git:<40 hex>` — a provisional git blob
 * hash of the unit's source text, written by hand before the indexer exists.
 */
export type Hash = `b3:${string}` | `git:${string}`;

export type UnitKind = "function" | "hook" | "component" | "type";

export type Framework = "react" | "svelte" | "none";

/** `created` marks a unit's first version; the rest follow the plan's change classes. */
export type ChangeClass = "created" | "interface" | "behaviour" | "cosmetic";

export type Actor =
  | { kind: "human" }
  | {
      kind: "agent";
      tool: string;
      model?: string;
      session?: string;
      task?: string;
      reviewed: boolean;
    };

/** A typed reference: metadata stores references, never issue or error content. */
export interface Reference {
  kind: string;
  ref: string;
  url?: string;
}

export type Link = string | Reference;

export interface Version {
  contentHash: Hash;
  interfaceHash?: Hash;
  closureHash?: Hash;
  provisional?: boolean;
  parent?: Hash | null;
  change: ChangeClass;
  commit?: string;
  actor: Actor;
  rationale: string;
  links?: Link[];
  deps?: Record<Uid, Hash>;
}

export type LineageKind = "rename" | "move" | "split" | "merge";

export interface LineageEntry {
  kind: LineageKind;
  from?: string;
  uids?: Uid[];
  commit?: string;
}

export interface TestLink {
  file: string;
  name?: string;
  via: "static" | "coverage" | "explicit";
  verifiedAgainst?: Hash;
}

export interface UnitLocation {
  file: string;
  export?: string;
}

/** The shape of one `.poetics/units/<uid>.json` file. */
export interface Unit {
  uid: Uid;
  kind: UnitKind;
  framework: Framework;
  name: string;
  owner?: Uid;
  location: UnitLocation;
  versions: Version[];
  lineage?: LineageEntry[];
  docs?: string;
  tests?: TestLink[];
}

/** A source span, 0-based and end-exclusive, in the original file. */
export interface Span {
  file: string;
  start: number;
  end: number;
}

export type EdgeKind = "renders" | "calls" | "uses-hook" | "uses-context" | "references-type";

/** Unit A uses unit B. */
export interface Edge {
  from: Uid;
  to: Uid;
  kind: EdgeKind;
}

/** A use the adapter could not resolve, e.g. a dynamic component. Shown, never guessed. */
export interface UnresolvedEdge {
  from: Uid;
  kind: EdgeKind;
  span: Span;
  reason: string;
}
