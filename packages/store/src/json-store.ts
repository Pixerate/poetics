import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { isRemoved, notImplemented } from "@poetics/core";
import type { Hash, LineageEntry, Link, Note, TestLink, Unit, Version } from "@poetics/core";
import { unitFilePath } from "./paths.ts";
import type { StoreLayout, StorePaths } from "./paths.ts";
import type { StoreValidator } from "./schemas.ts";

/** A JSON file read from the store: a unit file or a note file. */
export interface UnitFile {
  /** Absolute path. */
  path: string;
  /** Path relative to the repo root, POSIX separators. */
  relativePath: string;
  raw: string;
}

/** Every `*.json` under `.poetics/units/`, in either layout, sorted by path. */
export async function listUnitFiles(paths: StorePaths): Promise<string[]> {
  return listJsonFiles(paths.units);
}

/** Every `*.json` under `.poetics/notes/`, sorted by path. */
export async function listNoteFiles(paths: StorePaths): Promise<string[]> {
  return listJsonFiles(paths.notes);
}

async function listJsonFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

export async function readUnitFiles(paths: StorePaths): Promise<UnitFile[]> {
  return readFiles(paths, await listUnitFiles(paths));
}

export async function readNoteFiles(paths: StorePaths): Promise<UnitFile[]> {
  return readFiles(paths, await listNoteFiles(paths));
}

async function readFiles(paths: StorePaths, files: string[]): Promise<UnitFile[]> {
  return Promise.all(
    files.map(async (path) => ({
      path,
      relativePath: toPosix(relative(paths.root, path)),
      raw: await readFile(path, "utf8"),
    })),
  );
}

/** Reads and parses the unit file for `uid`, in whichever layout it was written. */
export async function readUnit(paths: StorePaths, uid: string): Promise<Unit> {
  return parseUnit(await readUnitFile(paths, uid));
}

export function parseUnit(file: UnitFile): Unit {
  try {
    return JSON.parse(file.raw) as Unit;
  } catch (error) {
    throw new SyntaxError(`${file.relativePath}: ${(error as Error).message}`);
  }
}

export function parseNote(file: UnitFile): Note {
  try {
    return JSON.parse(file.raw) as Note;
  } catch (error) {
    throw new SyntaxError(`${file.relativePath}: ${(error as Error).message}`);
  }
}

export function toPosix(path: string): string {
  return path.split(sep).join("/");
}

export interface WriteContext {
  paths: StorePaths;
  actor: Version["actor"];
  /** When given, the updated unit must pass the unit schema before it is written. */
  validator?: StoreValidator;
}

/**
 * Appends a version to a unit file. Append-only; never rewrites history.
 * The written version's actor is `ctx.actor`: who wrote it is the writer's to
 * say, not the payload's.
 */
export async function appendVersion(ctx: WriteContext, uid: string, version: Version): Promise<void> {
  const file = await readUnitFile(ctx.paths, uid);
  const unit = parseUnit(file);
  const latest = unit.versions.at(-1);
  const fail = (reason: string): never => {
    throw new Error(`Cannot append a version to ${uid}: ${reason}`);
  };

  if (unit.uid !== uid) fail(`${file.relativePath} holds ${unit.uid}`);
  if (!latest) fail("it has no versions");
  // ADR 0010: `created` is only ever first and `removed` only ever last.
  if (isRemoved(unit)) fail("its latest version is removed");
  if (version.change === "created") fail("only a unit's first version is created");
  if (version.parent !== latest!.contentHash) fail(`parent is ${version.parent ?? "null"}, latest is ${latest!.contentHash}`);

  unit.versions.push({ ...version, actor: ctx.actor });
  await writeUnit(ctx, file.path, unit, fail);
}

/**
 * Writes a new unit file. Its only version must be `created`, as `ctx.actor`,
 * and no unit file may exist for its uid in either layout.
 */
export async function createUnit(ctx: WriteContext, unit: Unit, layout: StoreLayout = "flat"): Promise<void> {
  const fail = (reason: string): never => {
    throw new Error(`Cannot create unit ${unit.uid}: ${reason}`);
  };
  if (unit.versions.length !== 1 || unit.versions[0]!.change !== "created" || unit.versions[0]!.parent != null) {
    fail("a new unit has exactly one version, created, with no parent");
  }
  const existing = await readUnitFile(ctx.paths, unit.uid).catch(() => undefined);
  if (existing) fail(`${existing.relativePath} already exists`);
  const path = unitFilePath(ctx.paths, unit.uid, layout);
  await mkdir(dirname(path), { recursive: true });
  await writeUnit(ctx, path, { ...unit, versions: [{ ...unit.versions[0]!, actor: ctx.actor }] }, fail);
}

/**
 * Records that a unit now lives at `to`, appending the lineage entries that say
 * how it got there. Versions are untouched; a move with no lineage is refused,
 * since identity must never rest on an unexplained change of place.
 */
export async function relocateUnit(
  ctx: WriteContext,
  uid: string,
  to: { file: string; name: string; export?: string },
  lineage: readonly LineageEntry[],
): Promise<void> {
  const file = await readUnitFile(ctx.paths, uid);
  const unit = parseUnit(file);
  const fail = (reason: string): never => {
    throw new Error(`Cannot relocate ${uid}: ${reason}`);
  };
  if (lineage.length === 0) fail("no lineage entry says how it moved");
  if (isRemoved(unit)) fail("its latest version is removed");
  const location: Unit["location"] = { file: to.file };
  if (to.export !== undefined) location.export = to.export;
  await writeUnit(ctx, file.path, { ...unit, name: to.name, location, lineage: [...(unit.lineage ?? []), ...lineage] }, fail);
}

/**
 * Points a unit's test links at the files their tests moved to. Only
 * `tests[].file` changes; a rename must name a file the unit links, so a stale
 * plan fails instead of silently doing nothing.
 */
export async function relinkTests(ctx: WriteContext, uid: string, renames: ReadonlyMap<string, string>): Promise<void> {
  const file = await readUnitFile(ctx.paths, uid);
  const unit = parseUnit(file);
  const fail = (reason: string): never => {
    throw new Error(`Cannot relink the tests of ${uid}: ${reason}`);
  };
  if (isRemoved(unit)) fail("its latest version is removed");
  const tests = unit.tests ?? [];
  for (const from of renames.keys()) {
    if (!tests.some((test) => test.file === from)) fail(`it links no test in ${from}`);
  }
  await writeUnit(ctx, file.path, { ...unit, tests: tests.map((test) => ({ ...test, file: renames.get(test.file) ?? test.file })) }, fail);
}

async function writeUnit(ctx: WriteContext, path: string, unit: Unit, fail: (reason: string) => never): Promise<void> {
  if (ctx.validator) {
    const result = ctx.validator.unit(unit);
    if (!result.valid) fail(result.errors.join("; "));
  }
  // Write then rename, so a crash never leaves a half-written unit file.
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(unit, null, 2)}\n`);
  await rename(temp, path);
}

/** The unit file for `uid`, in whichever layout it was written. */
async function readUnitFile(paths: StorePaths, uid: string): Promise<UnitFile> {
  for (const path of [unitFilePath(paths, uid, "flat"), unitFilePath(paths, uid, "sharded")]) {
    try {
      return { path, relativePath: toPosix(relative(paths.root, path)), raw: await readFile(path, "utf8") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(`No unit file for ${uid} under ${toPosix(relative(paths.root, paths.units))}`);
}

/** Attaches rationale and links to the newest version of a unit. */
export function recordRationale(_ctx: WriteContext, _uid: string, _rationale: string, _links?: Link[]): Promise<void> {
  return notImplemented("recordRationale");
}

/** Records a rename, move, split or merge; rejected if the diff disagrees. */
export function declareLineage(_ctx: WriteContext, _uid: string, _entry: LineageEntry): Promise<void> {
  return notImplemented("declareLineage");
}

export function linkTest(_ctx: WriteContext, _uid: string, _link: TestLink): Promise<void> {
  return notImplemented("linkTest");
}

export function setDocs(_ctx: WriteContext, _uid: string, _docs: string, _against: Hash): Promise<void> {
  return notImplemented("setDocs");
}
