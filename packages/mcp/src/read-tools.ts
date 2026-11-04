// Handlers for the read-only tools, answered from the unit and note files
// through the SQLite index, and from the code through the TypeScript indexer
// when the context offers it.
import type { DatabaseSync } from "node:sqlite";
import { impactOf, isRemoved, notImplemented } from "@poetics/core";
import type { Hash, ImpactEntry, Note, Uid, Unit, Version } from "@poetics/core";
import { changesBetween, dependentsOf, getUnit, parseNote, readNoteFiles, readUnit, resolveUnit as resolveInStore, searchUnits } from "@poetics/store";
import type { ChangeSet, StorePaths, UnitRow } from "@poetics/store";
import type { CodeView } from "./code.ts";

export interface ReadContext {
  paths: StorePaths;
  /** An index already brought up to date with the unit files. */
  db: DatabaseSync;
  /** The code joined to the store, built on first use; without it, packs and tools say what they cannot show. */
  code?: () => Promise<CodeView>;
}

const DEFAULT_LIMIT = 20;
const DEFAULT_TOKEN_BUDGET = 4000;

function resolveUnit(ctx: ReadContext, ref: string): Promise<Unit> {
  return resolveInStore(ctx.paths, ctx.db, ref);
}

export interface NoteQuery {
  error?: string;
  /** A resolved uid. */
  unit?: Uid;
  path?: string;
  command?: string;
  includeRetired?: boolean;
}

export interface NoteMatch {
  note: Note;
  /** Which criteria matched, best-matched notes first. */
  matched: Array<"error" | "unit" | "path" | "command">;
  /** Anchored units whose current version differs from the one the note was observed at. */
  needsRecheck: Uid[];
}

/** Notes matching any of the criteria, ranked by how many matched, then by id. */
export function matchNotes(notes: readonly Note[], query: NoteQuery, latest: ReadonlyMap<Uid, Hash>): NoteMatch[] {
  const matches: NoteMatch[] = [];
  for (const note of notes) {
    if (note.status !== "active" && !query.includeRetired) continue;
    const matched: NoteMatch["matched"] = [];
    if (query.error && note.symptoms.some((symptom) => overlaps(query.error!, symptom))) matched.push("error");
    if (query.unit && note.anchors.units?.some((anchor) => anchor.uid === query.unit)) matched.push("unit");
    if (query.path && note.anchors.paths?.some((anchor) => samePathOrInside(query.path!, anchor))) matched.push("path");
    if (query.command && note.anchors.commands?.some((command) => overlaps(query.command!, command))) matched.push("command");
    if (matched.length === 0) continue;
    const needsRecheck = (note.anchors.units ?? [])
      .filter((anchor) => anchor.observedAt !== undefined && latest.has(anchor.uid) && latest.get(anchor.uid) !== anchor.observedAt)
      .map((anchor) => anchor.uid);
    matches.push({ note, matched, needsRecheck });
  }
  return matches.sort((a, b) => b.matched.length - a.matched.length || a.note.id.localeCompare(b.note.id));
}

/** Either text contains the other, ignoring case and runs of whitespace. */
function overlaps(a: string, b: string): boolean {
  const [x, y] = [normalise(a), normalise(b)];
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** One path is the other, or a directory containing it. */
function samePathOrInside(a: string, b: string): boolean {
  const [x, y] = [a.replace(/\/+$/, ""), b.replace(/\/+$/, "")];
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

export interface ContextPackRequest {
  unit?: string;
  task?: string;
  issue?: string;
  tokenBudget?: number;
}

/** What an agent should read before changing a unit, trimmed to a token budget. */
export interface ContextPack {
  /** With `signature`, the declaration up to its body, when the indexer can read the unit. */
  unit: ReturnType<typeof summarise> & { signature?: string };
  /** Other units the task text matched, when the pack was chosen from `task`. */
  candidates?: SearchHit[];
  notes: Array<Pick<Note, "id" | "kind" | "title" | "symptoms" | "cause" | "fix">>;
  tests: Unit["tests"];
  /** The unit's source text, as written. */
  code?: string;
  dependencies: Brief[];
  callers: Brief[];
  /** Rationale of earlier versions, newest first. */
  history: Array<Pick<Version, "contentHash" | "change" | "rationale">>;
  /** Sections the budget cut, with how many items each lost. */
  truncated: Record<string, number>;
  /** What the pack cannot include yet, and why. */
  missing: string[];
  estimatedTokens: number;
}

interface Brief {
  uid: Uid;
  name: string;
  kind: string;
  file: string;
  docs?: string;
  /** The declaration up to its body, when the indexer can read it. */
  signature?: string;
}

interface SearchHit {
  uid: Uid;
  name: string;
  kind: string;
  framework: string;
  file: string;
  versionCount: number;
}

/**
 * Builds a context pack. Sections are filled in priority order (the unit,
 * notes, tests, dependencies, callers, earlier rationale) until the budget is
 * spent; whatever is cut is counted in `truncated`, so nothing is silently lost.
 */
export async function contextPack(ctx: ReadContext, request: ContextPackRequest): Promise<ContextPack> {
  // Resolving an issue to units needs the issue-tracker integration.
  if (request.issue !== undefined) return notImplemented("poetics_context_pack issue");
  let unit: Unit;
  let candidates: SearchHit[] | undefined;
  if (request.unit !== undefined) {
    unit = await resolveUnit(ctx, request.unit);
  } else if (request.task !== undefined) {
    const hits = searchUnits(ctx.db, request.task, { match: "any" });
    if (hits.length === 0) throw new Error("No unit matches the task; pass a unit or try poetics_search");
    unit = await readUnit(ctx.paths, hits[0]!.uid);
    candidates = hits.slice(1, 5).map(hit);
  } else {
    throw new Error("Pass a unit, a task or an issue");
  }

  const budget = request.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const latest = unit.versions.at(-1)!;
  const view = ctx.code ? await ctx.code() : undefined;
  const code = view?.byUid.get(unit.uid);
  // The live graph and the recorded deps together: either may know an edge the other has not caught up with.
  const deps = union(Object.keys(latest.deps ?? {}), view?.graph.dependenciesOf(unit.uid) ?? []);
  const callers = union(dependentsOf(ctx.db, unit.uid), view?.graph.dependentsOf(unit.uid) ?? []);
  const withSignature = (item: Brief): Brief => {
    const signature = view?.byUid.get(item.uid)?.signatureText;
    return signature ? { ...item, signature } : item;
  };
  const allNotes = await readNotes(ctx.paths);
  const notes = matchNotes(allNotes, { unit: unit.uid, path: unit.location.file }, new Map());
  for (const dep of deps) {
    for (const match of matchNotes(allNotes, { unit: dep }, new Map())) {
      if (!notes.some((known) => known.note.id === match.note.id)) notes.push(match);
    }
  }

  const missing: string[] = [];
  if (!view) missing.push("code and signatures: this server has no code view");
  else if (!code) missing.push(`code and signatures: no ${unit.kind} ${unit.name} in ${unit.location.file} that the TypeScript indexer can read`);
  const pack: ContextPack = {
    unit: { ...summarise(unit), ...(code ? { signature: code.signatureText } : {}) },
    ...(candidates ? { candidates } : {}),
    notes: [],
    tests: [],
    dependencies: [],
    callers: [],
    history: [],
    truncated: {},
    missing,
    estimatedTokens: 0,
  };
  if (estimateTokens(pack) > budget && pack.unit.docs) {
    // Even the unit alone is over budget: keep as much of its docs as fits.
    const docs = pack.unit.docs;
    pack.truncated["unit.docs"] = 1;
    let keep = docs.length;
    do {
      keep = Math.max(0, keep - Math.max(1, (estimateTokens(pack) - budget) * 4));
      pack.unit.docs = `${docs.slice(0, keep)}…`;
    } while (keep > 0 && estimateTokens(pack) > budget);
  }

  if (code) {
    // The code comes right after the unit; when it does not all fit, keep its first lines.
    const lines = view!.sourceOf(code).split("\n");
    let kept = lines.length;
    pack.code = lines.join("\n");
    while (kept > 0 && estimateTokens(pack) > budget) {
      kept = Math.max(0, kept - Math.max(1, Math.ceil(((estimateTokens(pack) - budget) * 4) / 60)));
      pack.code = `${lines.slice(0, kept).join("\n")}\n…`;
    }
    if (kept < lines.length) pack.truncated["code"] = lines.length - kept;
    if (kept === 0) delete pack.code;
  }

  const sections: Array<[keyof ContextPack & string, unknown[]]> = [
    ["notes", notes.map(({ note }) => ({ id: note.id, kind: note.kind, title: note.title, symptoms: note.symptoms, cause: note.cause, fix: note.fix }))],
    ["tests", unit.tests ?? []],
    ["dependencies", deps.map((uid) => withSignature(brief(ctx.db, uid)))],
    ["callers", callers.map((uid) => withSignature(brief(ctx.db, uid)))],
    ["history", unit.versions.slice(0, -1).reverse().map(({ contentHash, change, rationale }) => ({ contentHash, change, rationale }))],
  ];
  let full = false;
  for (const [name, items] of sections) {
    const into = pack[name] as unknown[];
    for (const [index, item] of items.entries()) {
      into.push(item);
      if (!full && estimateTokens(pack) <= budget) continue;
      into.pop();
      full = true;
      pack.truncated[name] = items.length - index;
      break;
    }
  }
  pack.estimatedTokens = estimateTokens(pack);
  return pack;
}

/** Units affected by a change, with enough to name them, and the unresolved edges that make the list incomplete. */
export interface ImpactReport {
  changed: Uid[];
  interfaceChanged: Uid[];
  impact: Array<ImpactEntry & { name: string; kind: string; file: string }>;
  /** Uses inside impacted units the indexer could not resolve: the graph may be missing edges there. */
  unresolved: Array<{ uid: Uid; name: string; kind: string; file: string; start: number; end: number; reason: string }>;
}

/** Ranked impact of changing `changed`, through the live composition graph. */
export function impactReport(ctx: ReadContext, view: CodeView, changed: readonly Uid[], interfaceChanged: readonly Uid[] = []): ImpactReport {
  const entries = impactOf(view.graph, changed, { interfaceChanged });
  const impacted = new Set(entries.map((entry) => entry.uid));
  const named = (uid: Uid) => {
    const { name, kind, file } = brief(ctx.db, uid);
    return { name, kind, file };
  };
  return {
    changed: [...changed],
    interfaceChanged: [...interfaceChanged],
    impact: entries.map((entry) => ({ ...entry, ...named(entry.uid) })),
    unresolved: view.graph.unresolved
      .filter((edge) => impacted.has(edge.from))
      .map((edge) => ({ uid: edge.from, ...named(edge.from), start: edge.span.start, end: edge.span.end, reason: edge.reason })),
  };
}

/** The units a change set touched, and those whose interface changed or that were removed. */
export function changedUnits(set: ChangeSet): { changed: Uid[]; interfaceChanged: Uid[] } {
  const changed = new Set<Uid>();
  const interfaceChanged = new Set<Uid>();
  for (const unit of set.commits.flatMap((commit) => commit.units)) {
    changed.add(unit.uid);
    // A removal breaks callers at least as surely as an interface change.
    if (unit.versions.some((version) => version.change === "interface" || version.change === "removed")) interfaceChanged.add(unit.uid);
  }
  return { changed: [...changed].sort(), interfaceChanged: [...interfaceChanged].sort() };
}

/** What is behind in a scope: code with no version, units with no code, stale docs and notes, unresolved uses. */
export interface VerifyReport {
  scope: string;
  ok: boolean;
  stale: Array<{ uid: Uid; name: string; file: string; recorded: Hash; code: Hash }>;
  untracked: Array<{ name: string; kind: string; file: string; contentHash: Hash }>;
  missing: Array<{ uid: Uid; name: string; file: string }>;
  staleDocs: Array<{ uid: Uid; name: string; file: string; stored: string; code: string }>;
  staleNotes: Array<{ id: string; title: string; units: Uid[] }>;
  untested: Array<{ uid: Uid; name: string; file: string }>;
  unresolved: ImpactReport["unresolved"];
}

/**
 * Checks a path scope against the code. Stale, untracked and missing units make
 * `ok` false, since poetics index has something to record; stale docs and notes,
 * untested units and unresolved uses are for the agent to weigh before finishing.
 */
export async function verifyScope(ctx: ReadContext, view: CodeView, scope = ""): Promise<VerifyReport> {
  const prefix = scope.replace(/\/+$/, "");
  const inScope = (file: string) => prefix === "" || file === prefix || file.startsWith(`${prefix}/`);
  const units = new Map<Uid, Unit>();
  for (const uid of [...view.byUid.keys(), ...view.missing]) units.set(uid, await readUnit(ctx.paths, uid));
  const report: VerifyReport = { scope: prefix, ok: true, stale: [], untracked: [], missing: [], staleDocs: [], staleNotes: [], untested: [], unresolved: [] };
  for (const [uid, code] of view.byUid) {
    const unit = units.get(uid)!;
    if (!inScope(code.span.file)) continue;
    const recorded = unit.versions.at(-1)!.contentHash;
    if (recorded !== code.contentHash) report.stale.push({ uid, name: unit.name, file: code.span.file, recorded, code: code.contentHash });
    // TSDoc wraps where stored docs do not, so only words count.
    if (unit.docs !== undefined && code.docs !== undefined && unit.docs.replace(/\s+/g, " ").trim() !== code.docs.replace(/\s+/g, " ").trim()) {
      report.staleDocs.push({ uid, name: unit.name, file: code.span.file, stored: unit.docs, code: code.docs });
    }
    if ((unit.tests ?? []).length === 0) report.untested.push({ uid, name: unit.name, file: code.span.file });
  }
  for (const code of view.untracked) {
    if (inScope(code.span.file)) report.untracked.push({ name: code.name, kind: code.kind, file: code.span.file, contentHash: code.contentHash });
  }
  for (const uid of view.missing) {
    const unit = units.get(uid)!;
    if (inScope(unit.location.file)) report.missing.push({ uid, name: unit.name, file: unit.location.file });
  }
  for (const note of await readNotes(ctx.paths)) {
    if (note.status !== "active") continue;
    const changed = (note.anchors.units ?? []).filter((anchor) => {
      const unit = units.get(anchor.uid);
      return unit !== undefined && inScope(unit.location.file) && anchor.observedAt !== undefined && changedSince(unit, anchor.observedAt);
    });
    if (changed.length > 0) report.staleNotes.push({ id: note.id, title: note.title, units: changed.map((anchor) => anchor.uid) });
  }
  const scoped = [...view.byUid].filter(([, code]) => inScope(code.span.file)).map(([uid]) => uid);
  report.unresolved = impactReport(ctx, view, scoped).unresolved;
  report.ok = report.stale.length + report.untracked.length + report.missing.length === 0;
  return report;
}

/** Whether a version after `hash` changed code; a rehash re-records the same code (ADR 0014). */
function changedSince(unit: Unit, hash: Hash): boolean {
  const at = unit.versions.findIndex((version) => version.contentHash === hash);
  return at === -1 || unit.versions.slice(at + 1).some((version) => version.change !== "rehash");
}

function union(a: readonly Uid[], b: readonly Uid[]): Uid[] {
  return [...new Set([...a, ...b])].sort();
}

/** A rough count: about four characters of JSON per token. */
function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function brief(db: DatabaseSync, uid: Uid): Brief {
  const row = getUnit(db, uid);
  // A dependency on something outside the store, e.g. an npm package.
  if (!row) return { uid, name: uid, kind: "external", file: "" };
  return { uid: row.uid, name: row.name, kind: row.kind, file: row.file, ...(row.docs ? { docs: row.docs } : {}) };
}

function summarise(unit: Unit) {
  const latest = unit.versions.at(-1)!;
  return {
    uid: unit.uid,
    kind: unit.kind,
    framework: unit.framework,
    name: unit.name,
    location: unit.location,
    ...(unit.docs ? { docs: unit.docs } : {}),
    removed: isRemoved(unit),
    versionCount: unit.versions.length,
    latest,
  };
}

function hit(row: UnitRow): SearchHit {
  return { uid: row.uid, name: row.name, kind: row.kind, framework: row.framework, file: row.file, versionCount: row.version_count };
}

async function readNotes(paths: StorePaths): Promise<Note[]> {
  return (await readNoteFiles(paths)).map(parseNote);
}

/** The current contentHash of every unit the notes are anchored to. */
function latestHashes(db: DatabaseSync, notes: readonly Note[]): Map<Uid, Hash> {
  const latest = new Map<Uid, Hash>();
  for (const anchor of notes.flatMap((note) => note.anchors.units ?? [])) {
    const row = getUnit(db, anchor.uid);
    if (row) latest.set(row.uid, row.latest_content_hash as Hash);
  }
  return latest;
}

async function requireCode(ctx: ReadContext, tool: string): Promise<CodeView> {
  if (!ctx.code) throw new Error(`${tool} needs the code: this server was started without a code view`);
  return ctx.code();
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  return args[key] === undefined ? undefined : stringArg(args, key);
}

function limitArg(args: Record<string, unknown>, fallback: number): number {
  const value = args["limit"] ?? fallback;
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error("limit must be a positive integer");
  return value as number;
}

/** Answers one read-only tool call. Arguments come from an agent, so each handler checks what it reads. */
export async function callReadTool(ctx: ReadContext, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "poetics_search":
      return { units: searchUnits(ctx.db, stringArg(args, "query")).slice(0, limitArg(args, DEFAULT_LIMIT)).map(hit) };
    case "poetics_unit": {
      const unit = await resolveUnit(ctx, stringArg(args, "unit"));
      return {
        ...summarise(unit),
        lineage: unit.lineage ?? [],
        tests: unit.tests ?? [],
        dependencies: Object.keys(unit.versions.at(-1)!.deps ?? {}).map((uid) => brief(ctx.db, uid)),
        callers: dependentsOf(ctx.db, unit.uid).map((uid) => brief(ctx.db, uid)),
      };
    }
    case "poetics_history": {
      const unit = await resolveUnit(ctx, stringArg(args, "unit"));
      const limit = limitArg(args, unit.versions.length);
      const versions = unit.versions.map((version, seq) => ({ seq, ...version })).reverse();
      return { uid: unit.uid, name: unit.name, lineage: unit.lineage ?? [], versions: versions.slice(0, limit) };
    }
    case "poetics_tests_for": {
      const unit = await resolveUnit(ctx, stringArg(args, "unit"));
      const current = unit.versions.at(-1)!.contentHash;
      // Pass/fail needs a test runner integration; until then, report whether a run was recorded against this version.
      return {
        uid: unit.uid,
        contentHash: current,
        tests: (unit.tests ?? []).map((test) => ({ ...test, verified: test.verifiedAgainst === current })),
      };
    }
    case "poetics_notes": {
      const ref = optionalString(args, "unit");
      const query: NoteQuery = { includeRetired: args["includeRetired"] === true };
      for (const key of ["error", "path", "command"] as const) {
        const value = optionalString(args, key);
        if (value !== undefined) query[key] = value;
      }
      if (ref !== undefined) query.unit = (await resolveUnit(ctx, ref)).uid;
      if (!query.error && !query.unit && !query.path && !query.command) throw new Error("Pass an error, unit, path or command");
      const notes = await readNotes(ctx.paths);
      return { notes: matchNotes(notes, query, latestHashes(ctx.db, notes)) };
    }
    case "poetics_impact": {
      const since = optionalString(args, "since");
      const refs = args["units"];
      if (refs !== undefined && (!Array.isArray(refs) || refs.some((ref) => typeof ref !== "string" || ref.length === 0))) {
        throw new Error("units must be an array of unit references");
      }
      if (since === undefined && refs === undefined) throw new Error("Pass since, units, or both");
      const view = await requireCode(ctx, name);
      const changed = new Set<Uid>();
      const interfaceChanged = new Set<Uid>();
      for (const ref of (refs as string[] | undefined) ?? []) changed.add((await resolveUnit(ctx, ref)).uid);
      if (since !== undefined) {
        const fromSet = changedUnits(await changesBetween(ctx.paths, { from: since }));
        for (const uid of fromSet.changed) changed.add(uid);
        for (const uid of fromSet.interfaceChanged) interfaceChanged.add(uid);
      }
      return impactReport(ctx, view, [...changed].sort(), [...interfaceChanged]);
    }
    case "poetics_verify":
      return verifyScope(ctx, await requireCode(ctx, name), optionalString(args, "scope"));
    case "poetics_context_pack": {
      const request: ContextPackRequest = {};
      for (const key of ["unit", "task", "issue"] as const) {
        const value = optionalString(args, key);
        if (value !== undefined) request[key] = value;
      }
      const budget = args["tokenBudget"];
      if (budget !== undefined) {
        if (!Number.isInteger(budget) || (budget as number) < 256) throw new Error("tokenBudget must be an integer of at least 256");
        request.tokenBudget = budget as number;
      }
      return contextPack(ctx, request);
    }
    default:
      return notImplemented(name);
  }
}
