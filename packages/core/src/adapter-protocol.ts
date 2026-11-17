// The protocol between the core and an out-of-process adapter (ADR 0025): one
// request on the adapter's stdin, one response on its stdout, per batch. The
// JSON Schemas in schemas/adapter-*.schema.json check the shape; this checks
// what a schema cannot, such as edges pointing at units that exist.
import type { EdgeKind, Framework, Hash, UnitKind } from "./types.ts";

/** The protocol version requests and responses carry. */
export const ADAPTER_PROTOCOL = 1;

/** One batch of files for an adapter to read as one program. */
export interface AdapterRequest {
  protocol: typeof ADAPTER_PROTOCOL;
  root: string;
  /** `text` is the file as it was at a commit; without it the adapter reads the file from disk. */
  files: Array<{ path: string; text?: string }>;
}

export interface AdapterResponse {
  protocol: typeof ADAPTER_PROTOCOL;
  /** `rules` is raised whenever a normalisation change alters the hashes of unchanged code. */
  adapter: { name: string; version: string; rules: number };
  files: AdapterFile[];
}

export type AdapterFile = { path: string; units: AdapterUnit[] } | { path: string; error: string };

export interface AdapterUnit {
  /** `path#name`, unique in the batch. */
  key: string;
  name: string;
  owner?: string;
  kind: UnitKind;
  framework: Framework;
  startLine: number;
  endLine: number;
  docs?: string;
  contentHash: Hash;
  interfaceHash: Hash;
  runtimeHash?: Hash;
  fingerprint: string[];
  signatureText: string;
  edges: Array<{ to: string; kind: EdgeKind; resolution: "exact" | "name" }>;
  unresolved: Array<{ kind: EdgeKind; line: number; name: string; reason: string }>;
}

export interface AdapterResponseCheck {
  /** Problems that make the response unusable. */
  errors: string[];
  /** Requested paths the response has no units for: an error entry or no entry. Their units are kept, not removed. */
  notRead: string[];
}

/** Checks a schema-valid response against its request: paths, keys, owners and edge targets. */
export function checkAdapterResponse(request: AdapterRequest, response: AdapterResponse): AdapterResponseCheck {
  const errors: string[] = [];
  const requested = new Set(request.files.map((file) => file.path));
  const answered = new Set<string>();
  const keys = new Set<string>();
  for (const file of response.files) {
    if (!requested.has(file.path)) errors.push(`${file.path}: not requested`);
    if (answered.has(file.path)) errors.push(`${file.path}: answered more than once`);
    answered.add(file.path);
    if (!("units" in file)) continue;
    for (const unit of file.units) {
      if (keys.has(unit.key)) errors.push(`${unit.key}: key is not unique in the batch`);
      keys.add(unit.key);
      if (!unit.key.startsWith(`${file.path}#`)) errors.push(`${unit.key}: key does not start with its file, ${file.path}#`);
      if (unit.endLine < unit.startLine) errors.push(`${unit.key}: ends at line ${unit.endLine}, before it starts at ${unit.startLine}`);
    }
  }
  for (const file of response.files) {
    if (!("units" in file)) continue;
    for (const unit of file.units) {
      if (unit.owner === unit.key) errors.push(`${unit.key}: owns itself`);
      else if (unit.owner !== undefined && !keys.has(unit.owner)) errors.push(`${unit.key}: owner ${unit.owner} is not a unit in the batch`);
      for (const edge of unit.edges) {
        if (!keys.has(edge.to)) errors.push(`${unit.key}: ${edge.kind} edge to ${edge.to}, which is not a unit in the batch`);
      }
    }
  }
  const read = new Set(response.files.filter((file) => "units" in file).map((file) => file.path));
  const notRead = request.files.map((file) => file.path).filter((path) => !read.has(path));
  return { errors, notRead: [...new Set(notRead)] };
}
