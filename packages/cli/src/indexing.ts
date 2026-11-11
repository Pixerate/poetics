// poetics index: reconcile the store with the code. Units already recorded are
// left alone; units edited in place get a version; units that left their
// recorded place are matched to the code that appeared (moves and renames keep
// their uid), and whatever is left is created or removed. Ambiguous matches are
// reported, never guessed, and nothing is written for them. Test links follow
// test files that git saw renamed.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contentTree, createTypeScriptIndexer, fingerprint } from "@poetics/adapter-typescript";
import { detectIn } from "./declarations.ts";
import type { FrameworkPlugin, IndexedUnit } from "@poetics/adapter-typescript";
import { REMOVED_CONTENT_HASH, contentHash, isRemoved, matchIdentities, mintUid } from "@poetics/core";
import type { Actor, ChangeClass, CodeUnit, Hash, LineageDeclaration, LineageEntry, Link, QueuedMatch, RejectedDeclaration, TrackedUnit, Unit, Version } from "@poetics/core";
import { appendVersion, createMatcher, createUnit, filesInScope, isParseable, parseUnit, readUnitFiles, reclassifyUnit, relinkTests, relocateUnit, storePaths } from "@poetics/store";
import type { PoeticsConfig, StoreLayout } from "@poetics/store";
import { pluginsFor } from "./frameworks.ts";
import { changesSince, git, showAt } from "./git.ts";

export interface IndexOptions {
  /** The ref whose code the store was last in step with. Default `HEAD`. */
  since?: string;
  /** Rationale for every version written. Default: the messages of the commits since `since`. */
  rationale?: string;
  /** Renames, moves, splits and merges someone declared, matched first and checked against the code. */
  declarations?: LineageDeclaration[];
}

/** A version to append, with where its unit is, for reporting. */
export interface PlannedVersion {
  uid: string;
  key: string;
  version: Omit<Version, "actor">;
  /** For a removal a declared merge caused: the unit it merged into. */
  mergedInto?: string;
}

/** A unit that moved or was renamed, and the lineage that says so. */
export interface PlannedMove {
  uid: string;
  from: string;
  key: string;
  to: { file: string; name: string; export?: string; owner?: string };
  lineage: LineageEntry[];
  via: string;
  score?: number;
}

/** A unit whose code the adapters now see as a different kind or framework, such as a function React claims as a component. */
export interface PlannedReclassification {
  uid: string;
  key: string;
  from: Pick<Unit, "kind" | "framework">;
  to: Pick<Unit, "kind" | "framework">;
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
  reclassified: PlannedReclassification[];
  queued: QueuedMatch[];
  /** Declarations the code disagrees with, and why. Nothing is written for them. */
  rejected: RejectedDeclaration[];
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
  const plugins = pluginsFor(config);
  const code = createTypeScriptIndexer({ root, files: parseable, cacheFile: join(paths.cache, CACHE), plugins, ...(tsconfig ? { tsconfig } : {}) }).index().units;
  // By scope, not by what exists now: a unit whose file was deleted or moved is exactly what matching is for.
  const inScope = createMatcher(config.include, config.exclude ?? []);
  const indexable = (file: string) => inScope(file) && isParseable(file, config.adapters);
  const live = (await readUnitFiles(paths))
    .map(parseUnit)
    .filter((unit) => !isRemoved(unit))
    .sort((a, b) => (a.uid < b.uid ? -1 : 1));
  const units = live.filter((unit) => indexable(unit.location.file));

  const plan: IndexPlan = { base, rationale, fresh: 0, moves: [], versions: [], created: [], removed: [], relinks: [], reclassified: [], queued: [], rejected: [] };
  // A declared unit goes through matching even when its old place still has code, as a split's original does.
  const declared = new Set((options.declarations ?? []).flatMap((declaration) => declaration.uids));
  // A store recorded before an adapter existed calls its components functions; the code now says otherwise.
  const reclassify = (unit: Unit, at: IndexedUnit) => {
    if (unit.kind === at.kind && unit.framework === at.framework) return;
    plan.reclassified.push({ uid: unit.uid, key: at.key, from: { kind: unit.kind, framework: unit.framework }, to: { kind: at.kind, framework: at.framework } });
  };
  const baseCode = baseSnapshot(root, base, plugins);
  const codeByPlace = new Map(code.map((unit) => [place(unit.span.file, unit.name, unit.kind), unit]));
  const uidOfKey = new Map<string, string>();
  const claimed = new Set<string>();
  const orphans: Unit[] = [];
  const pending: Array<{ unit: Unit; at: IndexedUnit }> = [];

  // 1. Units at their recorded place: recorded already, or edited in place.
  for (const unit of units) {
    const at = codeByPlace.get(place(unit.location.file, unit.name, unit.kind));
    if (!at || declared.has(unit.uid)) {
      orphans.push(unit);
      continue;
    }
    claimed.add(at.key);
    uidOfKey.set(at.key, unit.uid);
    reclassify(unit, at);
    if (unit.versions.at(-1)!.contentHash === at.contentHash) plan.fresh++;
    else pending.push({ unit, at });
  }

  // 2. Units that left their place, matched to code no unit claims, using the code at `base` for their shape.
  const untracked = code.filter((unit) => !claimed.has(unit.key));
  const before: TrackedUnit[] = orphans.map((unit) => {
    const was = baseCode(unit.location.file, unit.name, unit.kind);
    return was ? { ...was, uid: unit.uid } : { key: `${unit.location.file}#${unit.name}`, file: unit.location.file, name: unit.name, kind: unit.kind, contentHash: unit.versions.at(-1)!.contentHash, fingerprint: [], uid: unit.uid };
  });
  const result = matchIdentities(before, untracked.map(codeUnit), options.declarations ?? []);
  plan.rejected = result.rejected;
  const unitByUid = new Map(units.map((unit) => [unit.uid, unit]));
  const codeByKey = new Map(code.map((unit) => [unit.key, unit]));
  // New units first, so a declared split's original can name its parts' uids.
  const createdFrom: Array<{ unit: Unit; at: IndexedUnit; splitFrom?: Unit }> = [];
  for (const created of result.created) {
    const at = codeByKey.get(created.key)!;
    const uid = mintUid();
    uidOfKey.set(at.key, uid);
    const unit = newUnit(root, uid, at);
    const original = created.lineage?.find((entry) => entry.kind === "split")?.uids?.[0];
    if (created.lineage) unit.lineage = created.lineage;
    createdFrom.push({ unit, at, ...(original ? { splitFrom: unitByUid.get(original)! } : {}) });
  }
  for (const match of result.matched) {
    const unit = unitByUid.get(match.uid)!;
    const at = codeByKey.get(match.key)!;
    uidOfKey.set(at.key, unit.uid);
    const lineage = [...match.lineage];
    if (match.splitInto) lineage.push({ kind: "split", uids: match.splitInto.map((key) => uidOfKey.get(key)!) });
    // A declared unit that kept its place and gained no lineage is simply where it was.
    if (lineage.length > 0) {
      const to: PlannedMove["to"] = { file: at.span.file, name: at.name };
      if (at.exportedAs !== undefined) to.export = at.exportedAs;
      const owner = at.owner !== undefined ? uidOfKey.get(at.owner) : undefined;
      if (owner !== undefined) to.owner = owner;
      const move: PlannedMove = { uid: unit.uid, from: `${unit.location.file}#${unit.name}`, key: at.key, to, lineage, via: match.via };
      if (match.score !== undefined) move.score = match.score;
      plan.moves.push(move);
    } else if (unit.versions.at(-1)!.contentHash === at.contentHash) {
      plan.fresh++;
    }
    reclassify(unit, at);
    if (unit.versions.at(-1)!.contentHash !== at.contentHash) pending.push({ unit, at });
  }
  // Owners are named by uid, known now that every unit in the code has one.
  for (const { unit, at } of createdFrom) {
    const owner = at.owner !== undefined ? uidOfKey.get(at.owner) : undefined;
    if (owner !== undefined) unit.owner = owner;
  }
  plan.created = createdFrom.map(({ unit }) => unit);
  plan.queued = result.queued;

  // 3. Versions, now that every key has its uid for deps.
  const words = rationale ?? "";
  // An explicit rationale speaks for the whole run; a commit's references belong to the units in the files it touched.
  const explicit = options.rationale?.trim() ? issueLinks(options.rationale) : [];
  const commits = base ? commitReferences(root, base) : [];
  const linksFor = (...files: string[]): Link[] => {
    const found = [...explicit, ...commits.filter((c) => files.some((file) => c.files.has(file))).flatMap((c) => c.links)];
    return found.filter((link, i) => found.findIndex((other) => linkKey(other) === linkKey(link)) === i);
  };
  // A unit's own children are part of its source, so its version names theirs, whether or not it calls them.
  const childrenOf = new Map<string, IndexedUnit[]>();
  for (const unit of code) if (unit.owner !== undefined) childrenOf.set(unit.owner, [...(childrenOf.get(unit.owner) ?? []), unit]);
  const depsOf = (at: IndexedUnit) => {
    const deps: Record<string, Hash> = {};
    for (const edge of at.edges) {
      const uid = uidOfKey.get(edge.to);
      const target = codeByKey.get(edge.to);
      if (uid && target) deps[uid] = target.contentHash;
    }
    for (const child of childrenOf.get(at.key) ?? []) {
      const uid = uidOfKey.get(child.key);
      if (uid) deps[uid] = child.contentHash;
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
    const links = linksFor(at.span.file, unit.location.file);
    if (links.length > 0) version.links = links;
    const deps = depsOf(at);
    if (deps) version.deps = deps;
    plan.versions.push({ uid: unit.uid, key: at.key, version });
  }
  for (const { unit, at, splitFrom } of createdFrom) {
    const first = unit.versions[0]!;
    // A declared split says where the part came from; that is its reason to exist.
    first.rationale = splitFrom ? `Split out of ${splitFrom.name} (${splitFrom.uid}).` : words;
    const links = linksFor(at.span.file);
    if (links.length > 0) first.links = links;
    const deps = depsOf(at);
    if (deps) first.deps = deps;
  }
  for (const { uid, mergedInto } of result.removed) {
    const unit = unitByUid.get(uid)!;
    const survivor = mergedInto ? unitByUid.get(mergedInto) : undefined;
    const reason = survivor ? `Merged into ${survivor.name} (${survivor.uid}).` : words;
    const version: Omit<Version, "actor"> = { contentHash: REMOVED_CONTENT_HASH, provisional: true, parent: unit.versions.at(-1)!.contentHash, change: "removed", rationale: reason };
    const links = linksFor(unit.location.file);
    if (links.length > 0) version.links = links;
    plan.removed.push({ uid, key: `${unit.location.file}#${unit.name}`, version, ...(mergedInto ? { mergedInto } : {}) });
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
  plan.reclassified.sort(byKey);
  plan.created.sort((a, b) => byKey({ key: `${a.location.file}#${a.name}` }, { key: `${b.location.file}#${b.name}` }));
  return plan;
}

/** Writes the plan as `actor`. Queued units are left as they are. Returns how many unit files changed. */
export async function applyIndex(root: string, plan: IndexPlan, actor: Actor, layout: StoreLayout = "flat"): Promise<number> {
  if (plan.rationale === undefined && needsRationale(plan)) throw new Error("No rationale: pass --rationale, or commit with a message first");
  const ctx = { paths: storePaths(root), actor };
  for (const move of plan.moves) await relocateUnit(ctx, move.uid, move.to, move.lineage);
  for (const { uid, version } of [...plan.versions, ...plan.removed]) await appendVersion(ctx, uid, { ...version, actor });
  for (const unit of plan.created) await createUnit(ctx, unit, layout);
  for (const { uid, tests } of plan.relinks) await relinkTests(ctx, uid, new Map(tests.map(({ from, to }) => [from, to])));
  for (const { uid, to } of plan.reclassified) await reclassifyUnit(ctx, uid, to);
  return new Set([...plan.moves, ...plan.versions, ...plan.removed, ...plan.relinks, ...plan.reclassified].map((entry) => entry.uid)).size + plan.created.length;
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
  for (const { key, from, to } of plan.reclassified) lines.push(`* ${key} ${from.kind} (${from.framework}) -> ${to.kind} (${to.framework})`);
  for (const q of plan.queued) lines.push(`? ${q.reason}: ${q.uids.join(", ")} -> ${q.keys.join(", ")}; declare which is which with lineage (poetics-refactor)`);
  for (const r of plan.rejected) lines.push(`! declared ${r.declaration.kind} of ${r.declaration.uids.join(", ")} rejected: ${r.reason}`);
  if (plan.rationale === undefined && needsRationale(plan)) lines.push("No rationale yet: pass --rationale, or commit with a message first.");
  const counts = `${plan.moves.length} moved, ${plan.versions.length} changed, ${plan.created.length} new, ${plan.removed.length} removed, ${plan.relinks.length} relinked, ${plan.reclassified.length} reclassified, ${plan.queued.length} queued, ${plan.fresh} up to date`;
  lines.push(written === undefined ? `Would record: ${counts}. Run with --write to record it.` : `Recorded ${written} unit file(s): ${counts}.`);
  return lines.join("\n");
}

/** Whether applying the plan would write anything. */
export function hasWrites(plan: IndexPlan): boolean {
  return needsRationale(plan) || plan.reclassified.length > 0;
}

/**
 * Whether the plan writes a version with no rationale of its own. Moves, test
 * links and reclassifications carry none; a declared split or merge brings its
 * own.
 */
export function needsRationale(plan: IndexPlan): boolean {
  return [...plan.versions.map((v) => v.version), ...plan.removed.map((v) => v.version), ...plan.created.map((u) => u.versions[0]!)].some((v) => v.rationale === "");
}

/**
 * Records one declared rename, move, split or merge, checked the way
 * `poetics index` matches: the declaration is refused, with the reason, when
 * the code disagrees. Only identity is written (places, lineage, split parts,
 * merged removals); code changes are left for `poetics index` to record.
 */
export async function declareLineage(
  root: string,
  config: PoeticsConfig,
  declaration: LineageDeclaration,
  actor: Actor,
  layout: StoreLayout = "flat",
): Promise<{ moved: PlannedMove[]; created: Unit[]; removed: PlannedVersion[] }> {
  const plan = await planIndex(root, config, { declarations: [declaration], rationale: "" });
  const rejected = plan.rejected[0];
  if (rejected) throw new Error(`Declaration rejected: ${rejected.reason}`);
  const uids = new Set(declaration.uids);
  const own: IndexPlan = {
    ...plan,
    fresh: 0,
    moves: plan.moves.filter((move) => uids.has(move.uid)),
    versions: [],
    created: plan.created.filter((unit) => unit.lineage?.some((entry) => entry.kind === "split" && entry.uids?.some((uid) => uids.has(uid)))),
    removed: plan.removed.filter((entry) => entry.mergedInto !== undefined && uids.has(entry.uid)),
    relinks: [],
    reclassified: plan.reclassified.filter((entry) => uids.has(entry.uid)),
    queued: [],
  };
  await applyIndex(root, own, actor, layout);
  return { moved: own.moves, created: own.created, removed: own.removed };
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
function baseSnapshot(root: string, base: string | null, plugins: readonly FrameworkPlugin[]) {
  const files = new Map<string, Map<string, CodeUnit & { runtimeHash: Hash }>>();
  return (file: string, name: string, kind: Unit["kind"]) => {
    if (!files.has(file)) {
      const found = new Map<string, CodeUnit & { runtimeHash: Hash }>();
      const text = base === null ? undefined : showAt(root, base, file);
      if (text !== undefined) {
        for (const unit of detectIn(file, text, plugins).units) {
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

/** `#123` and `owner/repo#123` references in text, as issue links, so a version cites its source. */
function issueLinks(text: string): Link[] {
  const refs = [...new Set([...text.matchAll(/(?:^|[\s(])((?:[\w.-]+\/[\w.-]+)?#\d+)\b/g)].map((m) => m[1]!))];
  return refs.map((ref) => ({ kind: "github-issue", ref }));
}

/** Each commit from `base` to HEAD: the files it touched and the issues its message references. */
function commitReferences(root: string, base: string): Array<{ files: Set<string>; links: Link[] }> {
  return git(root, ["log", "--name-only", "--format=%x1e%B%x1f", `${base}..HEAD`])
    .split("\x1e")
    .filter((record) => record.trim() !== "")
    .map((record) => {
      const [message = "", files = ""] = record.split("\x1f");
      return { files: new Set(files.split("\n").filter(Boolean)), links: issueLinks(message) };
    })
    .filter((commit) => commit.links.length > 0);
}

function linkKey(link: Link): string {
  return typeof link === "string" ? link : `${link.kind}:${link.ref}`;
}

// Types and values live in separate namespaces.
function place(file: string, name: string, kind: Unit["kind"]): string {
  return `${file}#${name}#${kind === "type" ? "type" : "value"}`;
}
