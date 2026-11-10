// The identity gate (#26, and phase 2's React gate): scripted renames, moves,
// splits, merges and component wraps on real repositories, recorded by poetics
// index, and checked uid by uid against where each unit should have ended up.
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import ts from "typescript";
import { contentTree, detectUnits, fingerprint } from "@poetics/adapter-typescript";
import type { DetectedUnit } from "@poetics/adapter-typescript";
import { REMOVED_CONTENT_HASH, isRemoved, mintUid } from "@poetics/core";
import type { Unit } from "@poetics/core";
import { applyIndex, planIndex, pluginsFor, unitHashes } from "@poetics/cli";
import { appendVersion, createUnit, filesInScope, parseUnit, readUnitFiles, relocateUnit, storePaths } from "@poetics/store";
import type { PoeticsConfig } from "@poetics/store";

export interface CorpusEntry {
  name: string;
  kind: "react" | "svelte" | "mixed";
  repo: string;
  commit: string;
  include: string[];
  exclude: string[];
  /** The adapters its config lists; `typescript` alone when unset. */
  adapters?: string[];
}

export type RefactorKind = "rename" | "move-file" | "move-unit" | "rename-edit" | "split" | "merge" | "wrap";

export const REFACTORS: readonly RefactorKind[] = ["rename", "move-file", "move-unit", "rename-edit", "split", "merge", "wrap"];

/** The refactors a config can be measured on: wrapping a component in `memo` needs the React adapter to see through it. */
export function refactorsFor(config: { adapters?: readonly string[] }): RefactorKind[] {
  return REFACTORS.filter((kind) => kind !== "wrap" || config.adapters?.includes("react"));
}

/** How one kind of refactor fared. A refactor counts once per uid it should have kept. */
export interface KindResult {
  refactors: number;
  /** Uids that ended where they should. */
  kept: number;
  /** Uids removed although their code still exists elsewhere. */
  lost: number;
  /** Uids at a place other than the one they should be at. */
  misplaced: number;
  /** Uids left in a match poetics index would not guess. */
  queued: number;
  /** Refactors the corpus had no eligible unit for. */
  skipped: number;
}

export interface GateResult {
  corpus: CorpusEntry;
  /** The adapters the run indexed with. */
  adapters: string[];
  files: { indexed: number; notIndexed: number };
  units: number;
  /** Seeded units by kind (`function`, `component`, `hook`, `type`, …). */
  unitKinds: Record<string, number>;
  rounds: number;
  /** Only the refactors this run measured. */
  byKind: Partial<Record<RefactorKind, KindResult>>;
  /** Uids kept out of those a refactor touched, by the unit's kind when it was picked. */
  byUnitKind: Record<string, { kept: number; touched: number }>;
  /** Units poetics index created that no refactor made: lost identities show up here too. */
  spuriousCreated: number;
  timings: { seedMs: number; indexMs: number[] };
  failures: string[];
}

interface Place {
  file: string;
  name: string;
}

/** Where each tracked uid should be, or null once it should be removed. */
type Expected = Map<string, Place | null>;

const human = { kind: "human" } as const;

/** A small, seeded generator, so a gate run is repeatable. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Copies the corpus's in-scope files into a throwaway git repository with a
 * config for the same scope, so the gate never writes into the downloaded tree.
 */
export async function prepareWorkspace(
  source: string,
  corpus: CorpusEntry,
  adapters: readonly string[] = corpus.adapters ?? ["typescript"],
): Promise<{ root: string; config: PoeticsConfig; notIndexed: number }> {
  const root = await mkdtemp(join(tmpdir(), `poetics-gate-${corpus.name}-`));
  const config: PoeticsConfig = { include: corpus.include, exclude: corpus.exclude, adapters: [...adapters] };
  const { parseable, unsupported } = await filesInScope(source, config);
  for (const file of [...parseable, ...unsupported]) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await cp(join(source, file), join(root, file));
  }
  await write(root, ".poetics/config.json", JSON.stringify({ version: 1, ...config }, null, 2));
  await write(root, ".gitignore", ".poetics/cache/\n");
  git(root, "init", "-q", "-b", "main");
  commit(root, `Corpus ${corpus.repo}@${corpus.commit.slice(0, 7)}`);
  return { root, config, notIndexed: unsupported.length };
}

/** Runs the gate on one prepared corpus: seed the store, then `rounds` rounds of one refactor of each kind. `adapters` overrides the corpus's. */
export async function runGate(corpus: CorpusEntry, source: string, options: { rounds: number; seed: number; adapters?: readonly string[] }): Promise<GateResult> {
  const { root, config, notIndexed } = await prepareWorkspace(source, corpus, options.adapters);
  const kinds = refactorsFor(config);
  try {
    const random = seededRandom(options.seed);
    let started = performance.now();
    const seed = await planIndex(root, config, { rationale: "Seed" });
    await applyIndex(root, seed, human);
    commit(root, "Seed the store");
    const seedMs = Math.round(performance.now() - started);
    const { parseable } = await filesInScope(root, config);

    const expected: Expected = new Map();
    const unitKinds: Record<string, number> = {};
    for (const unit of await liveUnits(root)) {
      expected.set(unit.uid, { file: unit.location.file, name: unit.name });
      unitKinds[unit.kind] = (unitKinds[unit.kind] ?? 0) + 1;
    }
    const result: GateResult = {
      corpus,
      adapters: [...(config.adapters ?? ["typescript"])],
      files: { indexed: parseable.length, notIndexed },
      units: expected.size,
      unitKinds,
      rounds: options.rounds,
      byKind: Object.fromEntries(kinds.map((kind) => [kind, { refactors: 0, kept: 0, lost: 0, misplaced: 0, queued: 0, skipped: 0 }])),
      byUnitKind: {},
      spuriousCreated: 0,
      timings: { seedMs, indexMs: [] },
      failures: [],
    };

    const used = new Set<string>();
    for (let round = 1; round <= options.rounds; round++) {
      const touched = new Map<string, RefactorKind>();
      const sizes = new Map<string, string>();
      const madeByRefactor = new Set<string>();
      const kindOf = new Map((await liveUnits(root)).map((unit) => [unit.uid, unit.kind as string]));
      for (const kind of kinds) {
        const done = await refactor(kind, root, config, expected, used, random);
        if (!done) {
          result.byKind[kind]!.skipped++;
          continue;
        }
        result.byKind[kind]!.refactors++;
        for (const uid of done.uids) touched.set(uid, kind);
        for (const uid of done.created) madeByRefactor.add(uid);
        for (const [uid, size] of done.sizes ?? []) sizes.set(uid, size);
      }
      commit(root, `Round ${round}`);

      started = performance.now();
      const plan = await planIndex(root, config, { since: "HEAD~1", rationale: `Round ${round}` });
      await applyIndex(root, plan, human);
      result.timings.indexMs.push(Math.round(performance.now() - started));
      commit(root, `Record round ${round}`);

      const queued = new Set(plan.queued.flatMap((q) => q.uids));
      const store = new Map((await allUnits(root)).map((unit) => [unit.uid, unit]));
      for (const unit of plan.created) {
        if (madeByRefactor.has(unit.uid)) continue;
        result.spuriousCreated++;
        // A lost uid's code under a new one: refactoring it again would count the same miss twice.
        use(used, unit.uid);
      }
      for (const [uid, kind] of touched) {
        const tally = result.byKind[kind]!;
        const unitKind = kindOf.get(uid) ?? store.get(uid)?.kind ?? "function";
        const byUnit = (result.byUnitKind[unitKind] ??= { kept: 0, touched: 0 });
        byUnit.touched++;
        const keptBefore = tally.kept;
        const want = expected.get(uid);
        const unit = store.get(uid);
        const where = (u: Unit | undefined) => (!u ? "nowhere" : isRemoved(u) ? "removed" : `${u.location.file}#${u.name}`);
        if (queued.has(uid)) {
          tally.queued++;
          // The person who resolves the queue declares the match; the gate records the outcome and does the same.
          if (want && unit && !isRemoved(unit)) {
            const lineage: NonNullable<Unit["lineage"]> = [];
            if (unit.location.file !== want.file) lineage.push({ kind: "move", from: unit.location.file });
            if (unit.name !== want.name) lineage.push({ kind: "rename", from: unit.name });
            if (lineage.length > 0) await relocateUnit({ paths: storePaths(root), actor: human }, uid, want, lineage);
          }
        } else if (want === null ? unit && isRemoved(unit) : unit && !isRemoved(unit) && unit.location.file === want!.file && unit.name === want!.name) {
          tally.kept++;
        } else if (unit && isRemoved(unit)) {
          tally.lost++;
          const size = sizes.has(uid) ? ` (${sizes.get(uid)})` : "";
          result.failures.push(`round ${round} ${kind}: ${uid} removed, should be at ${want!.file}#${want!.name}${size}`);
        } else {
          tally.misplaced++;
          result.failures.push(`round ${round} ${kind}: ${uid} at ${where(unit)}, should be at ${want ? `${want.file}#${want.name}` : "removed"}`);
        }
        if (tally.kept > keptBefore) byUnit.kept++;
      }
      // Carry on from what the store now says, so one miss does not count again in later rounds.
      for (const unit of store.values()) {
        if (isRemoved(unit)) expected.set(unit.uid, null);
        else expected.set(unit.uid, { file: unit.location.file, name: unit.name });
      }
      commit(root, `Settle round ${round}`);
    }
    return result;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Applies one refactor of `kind` to units not used before, updating `expected`. Undefined when nothing fits. */
async function refactor(
  kind: RefactorKind,
  root: string,
  config: PoeticsConfig,
  expected: Expected,
  used: Set<string>,
  random: () => number,
): Promise<{ uids: string[]; created: string[]; sizes?: Map<string, string> } | undefined> {
  const units = (await liveUnits(root)).filter((unit) => !used.has(unit.uid) && unit.kind !== "type");
  const declared = await declarationCounts(root, config);
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  const code = async (unit: Unit) => findUnit(root, config, unit.location.file, unit.name);
  const blockBody = (found: Found | undefined, min = 1) =>
    found && ts.isFunctionDeclaration(found.unit.declarations[0]!) && found.unit.declarations.length === 1 && (found.unit.declarations[0]!.body?.statements.length ?? 0) >= min;

  if (kind === "rename" || kind === "rename-edit") {
    const candidates = units.filter((unit) => unit.name.length >= 4 && declared.get(unit.name) === 1 && unit.name !== "default");
    for (let tries = 0; tries < 20 && candidates.length > 0; tries++) {
      const unit = pick(candidates)!;
      const found = await code(unit);
      if (!found || (kind === "rename-edit" && !blockBody(found))) continue;
      const next = `${unit.name}Gate`;
      if (kind === "rename-edit") {
        // A one-statement edit at the top of the body, alongside the rename.
        const body = (found.unit.declarations[0] as ts.FunctionDeclaration).body!;
        await writeText(root, unit.location.file, insertAt(found.text, body.getStart(found.source) + 1, "\n  void 0;"));
      }
      const size = describeSize(found);
      await renameEverywhere(root, config, unit.name, next);
      use(used, unit.uid);
      expected.set(unit.uid, { file: unit.location.file, name: next });
      return { uids: [unit.uid], created: [], sizes: new Map([[unit.uid, size]]) };
    }
    return undefined;
  }

  if (kind === "move-file") {
    const byFile = new Map<string, Unit[]>();
    for (const unit of units) byFile.set(unit.location.file, [...(byFile.get(unit.location.file) ?? []), unit]);
    const files = [...byFile.keys()].filter((file) => !file.includes("/gate-moved/"));
    if (files.length === 0) return undefined;
    const file = pick(files)!;
    // Into a folder beside it, so the file stays inside the corpus's include globs.
    const to = posix.join(posix.dirname(file), "gate-moved", posix.basename(file));
    await mkdir(dirname(join(root, to)), { recursive: true });
    git(root, "mv", file, to);
    // The whole file moved, including units this round already touched, so follow every unit in it.
    const all = (await liveUnits(root)).filter((unit) => unit.location.file === file);
    for (const unit of all) {
      use(used, unit.uid);
      const want = expected.get(unit.uid);
      if (want) expected.set(unit.uid, { ...want, file: to });
    }
    return { uids: byFile.get(file)!.map((unit) => unit.uid), created: [] };
  }

  if (kind === "move-unit") {
    // From disk, not the store: a file moved earlier this round is not where the store says yet.
    const files = (await filesInScope(root, config)).parseable;
    for (let tries = 0; tries < 20; tries++) {
      const unit = pick(units);
      if (!unit) return undefined;
      const found = await code(unit);
      const target = pick(files.filter((file) => file !== unit.location.file && sameFamily(file, unit.location.file)));
      // Only a declaration that exports itself moves with its export; one listed in `export { … }` would not.
      if (!found || !found.text.startsWith("export", found.start) || !target || (await findUnit(root, config, target, unit.name))) continue;
      await writeText(root, unit.location.file, found.text.slice(0, found.start) + found.text.slice(found.end));
      const into = await readFile(join(root, target), "utf8");
      await writeText(root, target, `${into.trimEnd()}\n\n${found.text.slice(found.start, found.end)}\n`);
      use(used, unit.uid);
      expected.set(unit.uid, { file: target, name: unit.name });
      return { uids: [unit.uid], created: [] };
    }
    return undefined;
  }

  if (kind === "split") {
    for (let tries = 0; tries < 30; tries++) {
      const unit = pick(units);
      if (!unit) return undefined;
      const found = await code(unit);
      if (!blockBody(found, 4) || declared.has(`${unit.name}Rest`)) continue;
      const body = (found!.unit.declarations[0] as ts.FunctionDeclaration).body!;
      const half = Math.floor(body.statements.length / 2);
      const cut = body.statements[half]!.getFullStart();
      const rest = found!.text.slice(cut, body.statements.at(-1)!.end);
      const text = found!.text;
      const split = `${text.slice(0, cut)}\n}\n\nexport function ${unit.name}Rest() {${rest}\n}`;
      await writeText(root, unit.location.file, split + text.slice(found!.end));
      // Declared as the poetics-refactor skill says: a new unit for the part, lineage both ways.
      const part = await declareNew(root, config, unit.location.file, `${unit.name}Rest`, [{ kind: "split", uids: [unit.uid] }]);
      await relocateUnit({ paths: storePaths(root), actor: human }, unit.uid, { file: unit.location.file, name: unit.name }, [{ kind: "split", uids: [part] }]);
      use(used, unit.uid, part);
      expected.set(part, { file: unit.location.file, name: `${unit.name}Rest` });
      return { uids: [unit.uid, part], created: [part] };
    }
    return undefined;
  }

  if (kind === "wrap") {
    // A component declared as `export function Name(…) {…}` becomes `export const Name = memo(function Name(…) {…})`,
    // as someone memoising it would write it; the React adapter sees through the wrapper, so the uid should stay.
    const components = units.filter((unit) => unit.kind === "component");
    for (let tries = 0; tries < 20 && components.length > 0; tries++) {
      const unit = pick(components)!;
      const found = await code(unit);
      const head = `export function ${unit.name}`;
      if (!found || !blockBody(found) || !found.text.startsWith(head, found.start) || /(?<![\w$.])memo(?![\w$])/.test(found.text)) continue;
      const wrapped = `export const ${unit.name} = memo(function ${unit.name}${found.text.slice(found.start + head.length, found.end)});`;
      const text = `import { memo } from "react";\n${found.text.slice(0, found.start)}${wrapped}${found.text.slice(found.end)}`;
      const size = describeSize(found);
      await writeText(root, unit.location.file, text);
      use(used, unit.uid);
      return { uids: [unit.uid], created: [], sizes: new Map([[unit.uid, size]]) };
    }
    return undefined;
  }

  // merge: two block-bodied functions in one file become the first.
  const byFile = new Map<string, Unit[]>();
  for (const unit of units) byFile.set(unit.location.file, [...(byFile.get(unit.location.file) ?? []), unit]);
  for (const [file, inFile] of [...byFile].sort(() => random() - 0.5)) {
    if (inFile.length < 2) continue;
    const [first, second] = [...inFile].sort(() => random() - 0.5);
    const [a, b] = [await code(first!), await code(second!)];
    if (!blockBody(a) || !blockBody(b)) continue;
    const bodyA = (a!.unit.declarations[0] as ts.FunctionDeclaration).body!;
    const bodyB = (b!.unit.declarations[0] as ts.FunctionDeclaration).body!;
    const inner = b!.text.slice(bodyB.getStart(b!.source) + 1, bodyB.end - 1);
    // Two edits to one text: apply the later one first, so the earlier one's offsets still hold.
    const into = bodyA.end - 1;
    const remove = (text: string) => text.slice(0, b!.start) + text.slice(b!.end);
    const add = (text: string) => insertAt(text, into, `${inner}\n`);
    const text = b!.start > into ? add(remove(a!.text)) : remove(add(a!.text));
    await writeText(root, file, text);
    const ctx = { paths: storePaths(root), actor: human };
    await relocateUnit(ctx, first!.uid, { file, name: first!.name }, [{ kind: "merge", uids: [second!.uid] }]);
    await appendVersion(ctx, second!.uid, {
      contentHash: REMOVED_CONTENT_HASH,
      provisional: true,
      parent: second!.versions.at(-1)!.contentHash,
      change: "removed",
      actor: human,
      rationale: `Merged into ${first!.uid}`,
    });
    use(used, first!.uid, second!.uid);
    expected.set(second!.uid, null);
    return { uids: [first!.uid, second!.uid], created: [] };
  }
  return undefined;
}

interface Found {
  unit: DetectedUnit;
  source: ts.SourceFile;
  text: string;
  start: number;
  end: number;
}

/** A unit's size before a refactor, to explain a miss: statements in its body and fingerprint entries. */
function describeSize(found: Found): string {
  const declaration = found.unit.declarations[0]!;
  const fn = ts.isFunctionDeclaration(declaration) ? declaration : undefined;
  const statements = fn?.body ? `${fn.body.statements.length} statement(s), ` : "";
  return `${statements}${fingerprint(contentTree(found.unit)).length} fingerprint entries`;
}

async function findUnit(root: string, config: PoeticsConfig, file: string, name: string): Promise<Found | undefined> {
  const text = await readFile(join(root, file), "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  // With the same plugins poetics index runs, so a component wrapped in memo is still found.
  const unit = detectUnits(source, file, pluginsFor(config)).find((u) => u.name === name && u.kind !== "type");
  return unit && { unit, source, text, start: unit.span.start, end: unit.span.end };
}

/** How many units declare each name across the workspace, so a rename never touches two. */
async function declarationCounts(root: string, config: PoeticsConfig): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const file of (await filesInScope(root, config)).parseable) {
    const text = await readFile(join(root, file), "utf8");
    for (const unit of detectUnits(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true), file, pluginsFor(config))) counts.set(unit.name, (counts.get(unit.name) ?? 0) + 1);
  }
  return counts;
}

/** Renames an identifier in every file in scope, the way an editor's rename would. */
async function renameEverywhere(root: string, config: PoeticsConfig, from: string, to: string): Promise<void> {
  const pattern = new RegExp(`(?<![\\w$])${from.replace(/[$]/g, "\\$")}(?![\\w$])`, "g");
  const { parseable, unsupported } = await filesInScope(root, config);
  for (const file of [...parseable, ...unsupported]) {
    const text = await readFile(join(root, file), "utf8");
    if (pattern.test(text)) await writeText(root, file, text.replace(pattern, to));
    pattern.lastIndex = 0;
  }
}

/** Creates the unit file for code just written, as an agent following the skills would. */
async function declareNew(root: string, config: PoeticsConfig, file: string, name: string, lineage: Unit["lineage"]): Promise<string> {
  const hashes = (await unitHashes(root, config, file)).find((u) => u.name === name);
  if (!hashes) throw new Error(`No unit ${name} in ${file} after the refactor`);
  const framework = (await findUnit(root, config, file, name))?.unit.framework ?? "none";
  const uid = mintUid();
  await createUnit(
    { paths: storePaths(root), actor: human },
    {
      uid,
      kind: hashes.kind,
      framework,
      name,
      location: { file },
      versions: [{ contentHash: hashes.contentHash, interfaceHash: hashes.interfaceHash, parent: null, change: "created", actor: human, rationale: "Split out" }],
      ...(lineage ? { lineage } : {}),
    },
  );
  return uid;
}

/** The gate's results as a Markdown report, one table per corpus. */
export function formatResults(results: readonly GateResult[], meta: { date: string; rounds: number; seed: number }): string {
  const lines = [
    "# Gate results",
    "",
    `Generated by \`pnpm gate\` on ${meta.date} (${meta.rounds} rounds, seed ${meta.seed}). Each round applies one refactor of each kind to units not touched before, commits, and runs \`poetics index --write\`; every affected uid is then checked against where it should be. See [README.md](README.md) for what each refactor does.`,
    "",
  ];
  for (const result of results) {
    const { corpus } = result;
    const totals = Object.values(result.byKind).reduce((sum, k) => ({ kept: sum.kept + k.kept, all: sum.all + k.kept + k.lost + k.misplaced + k.queued }), { kept: 0, all: 0 });
    const median = [...result.timings.indexMs].sort((a, b) => a - b)[Math.floor(result.timings.indexMs.length / 2)] ?? 0;
    const kinds = Object.entries(result.unitKinds)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([kind, n]) => `${n} ${kind}`)
      .join(", ");
    const byUnit = Object.entries(result.byUnitKind)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([kind, k]) => `${kind} ${k.kept} of ${k.touched}`)
      .join(", ");
    lines.push(
      `## ${corpus.name} (${corpus.kind})`,
      "",
      `[${corpus.repo}](https://github.com/${corpus.repo}/tree/${corpus.commit}) at \`${corpus.commit.slice(0, 7)}\`, adapters ${result.adapters.join(", ")}: ${result.files.indexed} files indexed, ${result.files.notIndexed} in scope but not readable by the TypeScript indexer (\`.svelte\`), ${result.units} units (${kinds}). Seeding took ${result.timings.seedMs} ms; a round's \`poetics index\` took ${median} ms (median).`,
      "",
      "| Refactor | Done | Skipped | Uids kept | Lost | Misplaced | Queued |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...REFACTORS.filter((kind) => result.byKind[kind]).map((kind) => {
        const k = result.byKind[kind]!;
        return `| ${kind} | ${k.refactors} | ${k.skipped} | ${k.kept} | ${k.lost} | ${k.misplaced} | ${k.queued} |`;
      }),
      "",
      `Uids kept: **${totals.kept} of ${totals.all}**${totals.all ? ` (${((totals.kept / totals.all) * 100).toFixed(1)}%)` : ""}. By unit kind: ${byUnit}. Units created that no refactor made: ${result.spuriousCreated}.`,
      "",
    );
    if (result.failures.length > 0) lines.push("<details><summary>Misses</summary>", "", ...result.failures.map((f) => `- ${f}`), "", "</details>", "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

async function liveUnits(root: string): Promise<Unit[]> {
  // By place, not uid: uids are minted at random, and the same seed must pick the same units.
  const key = (unit: Unit) => `${unit.location.file}#${unit.name}`;
  return (await allUnits(root)).filter((unit) => !isRemoved(unit)).sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

async function allUnits(root: string): Promise<Unit[]> {
  return (await readUnitFiles(storePaths(root))).map(parseUnit);
}

function use(used: Set<string>, ...uids: string[]) {
  for (const uid of uids) used.add(uid);
}

function sameFamily(a: string, b: string): boolean {
  return a.endsWith(".tsx") === b.endsWith(".tsx") && !a.endsWith(".svelte") && !b.endsWith(".svelte");
}

function insertAt(text: string, at: number, insert: string): string {
  return text.slice(0, at) + insert + text.slice(at);
}

async function write(root: string, file: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
}

async function writeText(root: string, file: string, text: string): Promise<void> {
  await writeFile(join(root, file), text);
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Gate", "-c", "user.email=gate@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function commit(root: string, message: string): void {
  git(root, "add", "-A");
  git(root, "commit", "-q", "--allow-empty", "-m", message);
}
