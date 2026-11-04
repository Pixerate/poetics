// poetics index: reconcile the store with the code. Units already recorded are
// left alone; units edited in place get a version; units that left their
// recorded place are matched to the code that appeared (moves and renames keep
// their uid), and whatever is left is created or removed. Ambiguous matches are
// reported, never guessed, and nothing is written for them. Test links follow
// test files that git saw renamed.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { contentTree, createTypeScriptIndexer, detectUnits, fingerprint } from "@poetics/adapter-typescript";
import type { IndexedUnit } from "@poetics/adapter-typescript";
import { REMOVED_CONTENT_HASH, contentHash, isRemoved, matchIdentities, mintUid } from "@poetics/core";
import type { Actor, ChangeClass, CodeUnit, Hash, LineageEntry, Link, QueuedMatch, TrackedUnit, Unit, Version } from "@poetics/core";
import { appendVersion, createUnit, parseUnit, readUnitFiles, relinkTests, relocateUnit, storePaths } from "@poetics/store";
import type { StoreLayout } from "@poetics/store";
import type { PoeticsConfig } from "./config.ts";
import { filesInScope } from "./declarations.ts";
import { changesSince, git, showAt } from "./git.ts";
import { createMatcher } from "./glob.ts";

export interface IndexOptions {
  /** The ref whose code the store was last in step with. Default `HEAD`. */
  since?: string;
  /** Rationale for every version written. Default: the messages of the commits since `since`. */
  rationale?: string;
}

/** A version to append, with where its unit is, for reporting. */
export interface PlannedVersion {
  uid: string;
  key: string;
  version: Omit<Version, "actor">;
}

/** A unit that moved or was renamed, and the lineage that says so. */
export interface PlannedMove {
  uid: string;
  from: string;
  key: string;
  to: { file: string; name: string; export?: string };
  lineage: LineageEntry[];
  via: string;
  score?: number;
}

/** A unit whose linked test files were renamed, and where each went. */
export interface PlannedRelink {
  uid: string;
  key: string;
  tests: Array<{ from: string; to: string }>;
}

export interface IndexPlan {
  /** The commit the code was compared with; null in a repository with no commits yet. */
  base: string | null;
  /** Undefined when neither `--rationale` nor any commit since `base` gives one. */
  rationale: string | undefined;
  /** Units whose recorded place already has their latest hash. */
  fresh: number;
  moves: PlannedMove[];
  versions: PlannedVersion[];
  created: Unit[];
  removed: PlannedVersion[];
  relinks: PlannedRelink[];
  queued: QueuedMatch[];
}

const CACHE = "typescript.json";

/** What poetics index would record: nothing is written until `applyIndex`. */
export async function planIndex(root: string, config: PoeticsConfig, options: IndexOptions = {}): Promise<IndexPlan> {
  const since = changesFromBase(root, options.since ?? "HEAD");
  const base = since?.base ?? null;
  const rationale = options.rationale?.trim() || (base ? commitMessages(root, base) : "") || undefined;
  const { parseable } = await filesInScope(root, config);
  const tsconfig = config.typescript?.tsconfig;
  const paths = storePaths(root);
  const code = createTypeScriptIndexer({ root, files: parseable, cacheFile: join(paths.cache, CACHE), ...(tsconfig ? { tsconfig } : {}) }).index().units;
  // By scope, not by what exists now: a unit whose file was deleted or moved is exactly what matching is for.
  const inScope = createMatcher(config.include, config.exclude ?? []);
  const indexable = (file: string) => inScope(file) && /\.(ts|tsx|mts|cts)$/.test(file) && !file.endsWith(".d.ts");
  const live = (await readUnitFiles(paths))
    .map(parseUnit)
    .filter((unit) => !isRemoved(unit))
    .sort((a, b) => (a.uid < b.uid ? -1 : 1));
  const units = live.filter((unit) => unit.owner === undefined && indexable(unit.location.file));

  const plan: IndexPlan = { base, rationale, fresh: 0, moves: [], versions: [], created: [], removed: [], relinks: [], queued: [] };
  const baseCode = baseSnapshot(root, base);
  const codeByPlace = new Map(code.map((unit) => [place(unit.span.file, unit.name, unit.kind), unit]));
  const uidOfKey = new Map<string, string>();
  const claimed = new Set<string>();
  const orphans: Unit[] = [];
  const pending: Array<{ unit: Unit; at: IndexedUnit }> = [];

  // 1. Units at their recorded place: recorded already, or edited in place.
  for (const unit of units) {
    const at = codeByPlace.get(place(unit.location.file, unit.name, unit.kind));
    if (!at) {
      orphans.push(unit);
      continue;
    }
    claimed.add(at.key);
    uidOfKey.set(at.key, unit.uid);
    if (unit.versions.at(-1)!.contentHash === at.contentHash) plan.fresh++;
    else pending.push({ unit, at });
  }

  // 2. Units that left their place, matched to code no unit claims, using the code at `base` for their shape.
  const untracked = code.filter((unit) => !claimed.has(unit.key));
  const before: TrackedUnit[] = orphans.map((unit) => {
    const was = baseCode(unit.location.file, unit.name, unit.kind);
    return was ? { ...was, uid: unit.uid } : { key: `${unit.location.file}#${unit.name}`, file: unit.location.file, name: unit.name, kind: unit.kind, contentHash: unit.versions.at(-1)!.contentHash, fingerprint: [], uid: unit.uid };
  });
  const result = matchIdentities(before, untracked.map(codeUnit));
  const unitByUid = new Map(units.map((unit) => [unit.uid, unit]));
  const codeByKey = new Map(code.map((unit) => [unit.key, unit]));
  for (const match of result.matched) {
    const unit = unitByUid.get(match.uid)!;
    const at = codeByKey.get(match.key)!;
    uidOfKey.set(at.key, unit.uid);
    const to: PlannedMove["to"] = { file: at.span.file, name: at.name };
    if (at.exportedAs !== undefined) to.export = at.exportedAs;
    const move: PlannedMove = { uid: unit.uid, from: `${unit.location.file}#${unit.name}`, key: at.key, to, lineage: match.lineage, via: match.via };
    if (match.score !== undefined) move.score = match.score;
    plan.moves.push(move);
    if (unit.versions.at(-1)!.contentHash !== at.contentHash) pending.push({ unit, at });
  }
  const createdFrom: Array<{ unit: Unit; at: IndexedUnit }> = [];
  for (const created of result.created) {
    const at = codeByKey.get(created.key)!;
    const uid = mintUid();
    uidOfKey.set(at.key, uid);
    createdFrom.push({ unit: newUnit(root, uid, at), at });
  }
  plan.created = createdFrom.map(({ unit }) => unit);
  plan.queued = result.queued;

  // 3. Versions, now that every key has its uid for deps.
  const words = rationale ?? "";
  const links = issueLinks(words);
  const depsOf = (at: IndexedUnit) => {
    const deps: Record<string, Hash> = {};
    for (const edge of at.edges) {
      const uid = uidOfKey.get(edge.to);
      const target = codeByKey.get(edge.to);
      if (uid && target) deps[uid] = target.contentHash;
    }
    return Object.keys(deps).length > 0 ? deps : undefined;
  };
  for (const { unit, at } of pending) {
    const previous = unit.versions.at(-1)!;
    const was = baseCode(unit.location.file, unit.name, unit.kind);
    const version: Omit<Version, "actor"> = {
      contentHash: at.contentHash,
      interfaceHash: at.interfaceHash,
      parent: previous.contentHash,
      change: classify(previous, at, was?.contentHash === previous.contentHash ? was.runtimeHash : undefined),
      rationale: words,
    };
    if (links.length > 0) version.links = links;
    const deps = depsOf(at);
    if (deps) version.deps = deps;
    plan.versions.push({ uid: unit.uid, key: at.key, version });
  }
  for (const { unit, at } of createdFrom) {
    const first = unit.versions[0]!;
    first.rationale = words;
    if (links.length > 0) first.links = links;
    const deps = depsOf(at);
    if (deps) first.deps = deps;
  }
  for (const { uid } of result.removed) {
    const unit = unitByUid.get(uid)!;
    const version: Omit<Version, "actor"> = { contentHash: REMOVED_CONTENT_HASH, provisional: true, parent: unit.versions.at(-1)!.contentHash, change: "removed", rationale: words };
    if (links.length > 0) version.links = links;
    plan.removed.push({ uid, key: `${unit.location.file}#${unit.name}`, version });
  }
  // 4. Test links, for every live unit (moved or not, in scope or not): a renamed test file would leave them dangling.
  const renamed = new Map((since?.changes ?? []).filter((change) => change.status === "R").map((change) => [change.from!, change.path]));
  const movedTo = new Map(plan.moves.map((move) => [move.uid, move.key]));
  for (const unit of live) {
    const files = [...new Set((unit.tests ?? []).map((test) => test.file))].filter((file) => renamed.has(file));
    if (files.length === 0) continue;
    const key = movedTo.get(unit.uid) ?? `${unit.location.file}#${unit.name}`;
    plan.relinks.push({ uid: unit.uid, key, tests: files.map((from) => ({ from, to: renamed.get(from)! })) });
  }
  const byKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  plan.moves.sort(byKey);
  plan.versions.sort(byKey);
  plan.removed.sort(byKey);
  plan.relinks.sort(byKey);
  plan.created.sort((a, b) => byKey({ key: `${a.location.file}#${a.name}` }, { key: `${b.location.file}#${b.name}` }));
  return plan;
}

/** Writes the plan as `actor`. Queued units are left as they are. Returns how many unit files changed. */
export async function applyIndex(root: string, plan: IndexPlan, actor: Actor, layout: StoreLayout = "flat"): Promise<number> {
  if (plan.rationale === undefined && hasWrites(plan)) throw new Error("No rationale: pass --rationale, or commit with a message first");
  const ctx = { paths: storePaths(root), actor };
  for (const move of plan.moves) await relocateUnit(ctx, move.uid, move.to, move.lineage);
  for (const { uid, version } of [...plan.versions, ...plan.removed]) await appendVersion(ctx, uid, { ...version, actor });
  for (const unit of plan.created) await createUnit(ctx, unit, layout);
  for (const { uid, tests } of plan.relinks) await relinkTests(ctx, uid, new Map(tests.map(({ from, to }) => [from, to])));
  return new Set([...plan.moves, ...plan.versions, ...plan.removed, ...plan.relinks].map((entry) => entry.uid)).size + plan.created.length;
}

/** The plan for people: one line per unit, then a summary. `written` is set after a write. */
export function formatIndexPlan(plan: IndexPlan, written?: number): string {
  const lines: string[] = [];
  for (const move of plan.moves) {
    lines.push(`> ${move.from} -> ${move.key} (${move.via}${move.score !== undefined ? ` ${move.score}` : ""}): ${move.lineage.map((l) => l.kind).join(", ")}`);
  }
  for (const { key, version } of plan.versions) lines.push(`~ ${key} ${version.change}`);
  for (const unit of plan.created) lines.push(`+ ${unit.location.file}#${unit.name} (${unit.kind}, new uid ${unit.uid})`);
  for (const { key } of plan.removed) lines.push(`- ${key} removed`);
  for (const { key, tests } of plan.relinks) lines.push(`= ${key} tests: ${tests.map(({ from, to }) => `${from} -> ${to}`).join(", ")}`);
  for (const q of plan.queued) lines.push(`? ${q.reason}: ${q.uids.join(", ")} -> ${q.keys.join(", ")}; declare which is which with lineage (poetics-refactor)`);
  if (plan.rationale === undefined && hasWrites(plan)) lines.push("No rationale yet: pass --rationale, or commit with a message first.");
  const counts = `${plan.moves.length} moved, ${plan.versions.length} changed, ${plan.created.length} new, ${plan.removed.length} removed, ${plan.relinks.length} relinked, ${plan.queued.length} queued, ${plan.fresh} up to date`;
  lines.push(written === undefined ? `Would record: ${counts}. Run with --write to record it.` : `Recorded ${written} unit file(s): ${counts}.`);
  return lines.join("\n");
}

/** Whether applying the plan would write anything. */
export function hasWrites(plan: IndexPlan): boolean {
  return plan.moves.length + plan.versions.length + plan.created.length + plan.removed.length + plan.relinks.length > 0;
}

/**
 * The change class from hashes alone: a new interface hash is `interface`; the
 * same runtime tree (types and docs aside) is `cosmetic`; anything else, or a
 * previous version whose runtime tree is unknown, is `behaviour`.
 */
function classify(previous: Version, at: IndexedUnit, previousRuntime: Hash | undefined): ChangeClass {
  if (previous.interfaceHash !== undefined && previous.interfaceHash !== at.interfaceHash) return "interface";
  if (previousRuntime !== undefined && previousRuntime === at.runtimeHash) return "cosmetic";
  return "behaviour";
}

function newUnit(root: string, uid: string, at: IndexedUnit): Unit {
  const unit: Unit = {
    uid,
    kind: at.kind,
    framework: at.framework,
    name: at.name,
    location: at.exportedAs !== undefined ? { file: at.span.file, export: at.exportedAs } : { file: at.span.file },
    versions: [{ contentHash: at.contentHash, interfaceHash: at.interfaceHash, parent: null, change: "created", actor: { kind: "human" }, rationale: "" }],
  };
  if (at.docs !== undefined) unit.docs = at.docs;
  // A sibling test file that names the unit is a static link, the convention AGENTS.md asks for.
  const test = at.span.file.replace(/\.(tsx?|mts|cts)$/, ".test.$1");
  if (test !== at.span.file && existsSync(join(root, test)) && readFileSync(join(root, test), "utf8").includes(at.name)) {
    unit.tests = [{ file: test, via: "static" }];
  }
  return unit;
}

/** `since` resolved to a commit with the files changed from it, or null when it is `HEAD` and nothing is committed yet. */
function changesFromBase(root: string, since: string): ReturnType<typeof changesSince> | null {
  if (since === "HEAD") {
    try {
      git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
    } catch {
      return null;
    }
  }
  return changesSince(root, since);
}

/** The units of a file as it was at `base`, read syntactically: enough for content hashes and fingerprints. */
function baseSnapshot(root: string, base: string | null) {
  const files = new Map<string, Map<string, CodeUnit & { runtimeHash: Hash }>>();
  return (file: string, name: string, kind: Unit["kind"]) => {
    if (!files.has(file)) {
      const found = new Map<string, CodeUnit & { runtimeHash: Hash }>();
      const text = base === null ? undefined : showAt(root, base, file);
      if (text !== undefined) {
        for (const unit of detectUnits(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true), file)) {
          const tree = contentTree(unit);
          found.set(place(file, unit.name, unit.kind), {
            key: unit.key,
            file,
            name: unit.name,
            kind: unit.kind,
            contentHash: contentHash(tree),
            runtimeHash: contentHash(contentTree(unit, true)),
            fingerprint: fingerprint(tree),
          });
        }
      }
      files.set(file, found);
    }
    return files.get(file)!.get(place(file, name, kind));
  };
}

function codeUnit(unit: IndexedUnit): CodeUnit {
  return { key: unit.key, file: unit.span.file, name: unit.name, kind: unit.kind, contentHash: unit.contentHash, fingerprint: unit.fingerprint };
}

/** The messages of the commits from `base` to HEAD, oldest first, as the default rationale. */
function commitMessages(root: string, base: string): string {
  return git(root, ["log", "--reverse", "--format=%B", `${base}..HEAD`])
    .split("\n")
    .filter((line) => !/^Co-Authored-By:/i.test(line))
    .join("\n")
    .trim();
}

/** `#123` references in the rationale, as issue links, so the version cites its source. */
function issueLinks(text: string): Link[] {
  const refs = [...new Set([...text.matchAll(/(?:^|[\s(])#(\d+)\b/g)].map((m) => `#${m[1]}`))];
  return refs.map((ref) => ({ kind: "github-issue", ref }));
}

// Types and values live in separate namespaces.
function place(file: string, name: string, kind: Unit["kind"]): string {
  return `${file}#${name}#${kind === "type" ? "type" : "value"}`;
}
