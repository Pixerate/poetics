// Handlers for the read-only tools, answered from the unit and note files
// through the SQLite index. Tools that need the composition graph or the
// indexer's spans stay stubs until those land.
import type { DatabaseSync } from "node:sqlite";
import { isRemoved, notImplemented } from "@poetics/core";
import type { Hash, Note, Uid, Unit, Version } from "@poetics/core";
import {
  dependentsOf,
  findUnitsByName,
  getUnit,
  parseNote,
  readNoteFiles,
  readUnit,
  searchUnits,
} from "@poetics/store";
import type { StorePaths, UnitRow } from "@poetics/store";

export interface ReadContext {
  paths: StorePaths;
  /** An index already brought up to date with the unit files. */
  db: DatabaseSync;
}

const DEFAULT_LIMIT = 20;
const DEFAULT_TOKEN_BUDGET = 4000;

/**
 * Resolves a tool's unit reference: a uid, a unit name, or `file#name` when a
 * name is shared. Ambiguous names are refused with the candidates, never guessed.
 */
export async function resolveUnit(ctx: ReadContext, ref: string): Promise<Unit> {
  if (getUnit(ctx.db, ref)) return readUnit(ctx.paths, ref);
  const hashAt = ref.lastIndexOf("#");
  const [file, name] = hashAt > 0 ? [ref.slice(0, hashAt), ref.slice(hashAt + 1)] : [undefined, ref];
  const rows = findUnitsByName(ctx.db, name).filter((row) => file === undefined || row.file === file);
  if (rows.length === 1) return readUnit(ctx.paths, rows[0]!.uid);
  if (rows.length === 0) throw new Error(`No unit matches ${ref}; try poetics_search`);
  const candidates = rows.map((row) => `${row.uid} (${row.file}#${row.name})`).join(", ");
  throw new Error(`${ref} is ambiguous: ${candidates}. Pass a uid or file#name`);
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
  unit: ReturnType<typeof summarise>;
  /** Other units the task text matched, when the pack was chosen from `task`. */
  candidates?: SearchHit[];
  notes: Array<Pick<Note, "id" | "kind" | "title" | "symptoms" | "cause" | "fix">>;
  tests: Unit["tests"];
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
  const deps = Object.keys(latest.deps ?? {});
  const allNotes = await readNotes(ctx.paths);
  const notes = matchNotes(allNotes, { unit: unit.uid, path: unit.location.file }, new Map());
  for (const dep of deps) {
    for (const match of matchNotes(allNotes, { unit: dep }, new Map())) {
      if (!notes.some((known) => known.note.id === match.note.id)) notes.push(match);
    }
  }

  const pack: ContextPack = {
    unit: summarise(unit),
    ...(candidates ? { candidates } : {}),
    notes: [],
    tests: [],
    dependencies: [],
    callers: [],
    history: [],
    truncated: {},
    missing: ["code and signatures: they need the TypeScript indexer's spans (#19)"],
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

  const sections: Array<[keyof ContextPack & string, unknown[]]> = [
    ["notes", notes.map(({ note }) => ({ id: note.id, kind: note.kind, title: note.title, symptoms: note.symptoms, cause: note.cause, fix: note.fix }))],
    ["tests", unit.tests ?? []],
    ["dependencies", deps.map((uid) => brief(ctx.db, uid))],
    ["callers", dependentsOf(ctx.db, unit.uid).map((uid) => brief(ctx.db, uid))],
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
