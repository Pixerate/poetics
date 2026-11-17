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

const FRAMEWORKS: readonly Framework[] = ["react", "svelte", "swiftui", "none"];
const UNIT_KINDS: readonly UnitKind[] = ["function", "hook", "component", "context", "type"];
const EDGE_KINDS: readonly EdgeKind[] = ["renders", "calls", "uses-hook", "uses-context", "references-type", "conforms-to"];
const B3 = /^b3:[0-9a-f]{64}$/;
const KEY = /^[^#]+#.+$/;
const PATH = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[^\\]+$/;

/**
 * Where a parsed value breaks the shape of `schemas/adapter-response.schema.json`, so the core can refuse a malformed
 * response without loading the schemas at runtime. Empty for a well-formed response. Kept in step with the schema by
 * a test that runs both over the same cases.
 */
export function adapterResponseProblems(value: unknown): string[] {
  const problems: string[] = [];
  const at = (path: string, problem: string) => problems.push(`${path || "/"} ${problem}`);
  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const only = (path: string, v: Record<string, unknown>, allowed: readonly string[]) => {
    for (const key of Object.keys(v)) if (!allowed.includes(key)) at(`${path}/${key}`, "is not allowed");
  };
  const string = (path: string, v: unknown, pattern?: RegExp, nonEmpty = false) => {
    if (typeof v !== "string") return at(path, "must be a string");
    if (nonEmpty && v.length === 0) return at(path, "must not be empty");
    if (pattern && !pattern.test(v)) at(path, `must match ${pattern.source}`);
  };
  const line = (path: string, v: unknown) => {
    if (!Number.isInteger(v) || (v as number) < 1) at(path, "must be an integer of at least 1");
  };
  const oneOf = (path: string, v: unknown, allowed: readonly string[]) => {
    if (typeof v !== "string" || !allowed.includes(v)) at(path, `must be one of ${allowed.join(", ")}`);
  };
  const array = (path: string, v: unknown, each: (path: string, item: unknown) => void) => {
    if (!Array.isArray(v)) return at(path, "must be an array");
    v.forEach((item, i) => each(`${path}/${i}`, item));
  };
  const required = (path: string, v: Record<string, unknown>, keys: readonly string[]) => {
    for (const key of keys) if (!(key in v)) at(path, `must have ${key}`);
  };

  if (!isObject(value)) return ["/ must be an object"];
  only("", value, ["$schema", "protocol", "adapter", "files"]);
  required("", value, ["protocol", "adapter", "files"]);
  if ("protocol" in value && value["protocol"] !== ADAPTER_PROTOCOL) at("/protocol", `must be ${ADAPTER_PROTOCOL}`);
  const adapter = value["adapter"];
  if ("adapter" in value) {
    if (!isObject(adapter)) at("/adapter", "must be an object");
    else {
      only("/adapter", adapter, ["name", "version", "rules"]);
      required("/adapter", adapter, ["name", "version", "rules"]);
      if ("name" in adapter) string("/adapter/name", adapter["name"], /^[a-z][a-z0-9-]*$/);
      if ("version" in adapter) string("/adapter/version", adapter["version"], undefined, true);
      if ("rules" in adapter) line("/adapter/rules", adapter["rules"]);
    }
  }
  if (!("files" in value)) return problems;
  array("/files", value["files"], (path, file) => {
    if (!isObject(file)) return at(path, "must be an object");
    const hasUnits = "units" in file;
    if (hasUnits === "error" in file) return at(path, "must have exactly one of units and error");
    only(path, file, ["path", hasUnits ? "units" : "error"]);
    required(path, file, ["path"]);
    if ("path" in file) string(`${path}/path`, file["path"], PATH, true);
    if (!hasUnits) return string(`${path}/error`, file["error"], undefined, true);
    array(`${path}/units`, file["units"], (path, unit) => {
      if (!isObject(unit)) return at(path, "must be an object");
      const keys = ["key", "name", "kind", "framework", "startLine", "endLine", "contentHash", "interfaceHash", "fingerprint", "signatureText", "edges", "unresolved"];
      only(path, unit, [...keys, "owner", "docs", "runtimeHash"]);
      required(path, unit, keys);
      if ("key" in unit) string(`${path}/key`, unit["key"], KEY);
      if ("owner" in unit) string(`${path}/owner`, unit["owner"], KEY);
      if ("name" in unit) string(`${path}/name`, unit["name"], undefined, true);
      if ("kind" in unit) oneOf(`${path}/kind`, unit["kind"], UNIT_KINDS);
      if ("framework" in unit) oneOf(`${path}/framework`, unit["framework"], FRAMEWORKS);
      for (const key of ["startLine", "endLine"]) if (key in unit) line(`${path}/${key}`, unit[key]);
      if ("docs" in unit) string(`${path}/docs`, unit["docs"]);
      for (const key of ["contentHash", "interfaceHash", "runtimeHash"]) if (key in unit) string(`${path}/${key}`, unit[key], B3);
      if ("fingerprint" in unit) array(`${path}/fingerprint`, unit["fingerprint"], (path, item) => string(path, item, undefined, true));
      if ("signatureText" in unit) string(`${path}/signatureText`, unit["signatureText"]);
      if ("edges" in unit)
        array(`${path}/edges`, unit["edges"], (path, edge) => {
          if (!isObject(edge)) return at(path, "must be an object");
          only(path, edge, ["to", "kind", "resolution"]);
          required(path, edge, ["to", "kind", "resolution"]);
          if ("to" in edge) string(`${path}/to`, edge["to"], KEY);
          if ("kind" in edge) oneOf(`${path}/kind`, edge["kind"], EDGE_KINDS);
          if ("resolution" in edge) oneOf(`${path}/resolution`, edge["resolution"], ["exact", "name"]);
        });
      if ("unresolved" in unit)
        array(`${path}/unresolved`, unit["unresolved"], (path, use) => {
          if (!isObject(use)) return at(path, "must be an object");
          only(path, use, ["kind", "line", "name", "reason"]);
          required(path, use, ["kind", "line", "name", "reason"]);
          if ("kind" in use) oneOf(`${path}/kind`, use["kind"], EDGE_KINDS);
          if ("line" in use) line(`${path}/line`, use["line"]);
          for (const key of ["name", "reason"]) if (key in use) string(`${path}/${key}`, use[key], undefined, true);
        });
    });
  });
  return problems;
}
