import { execFileSync } from "node:child_process";
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

/**
 * Records what an adapter now says a unit is (a `component` of `react`, say)
 * when the code itself has not changed. Versions are untouched. A unit never
 * crosses between types and values: that would be a different unit.
 */
export async function reclassifyUnit(ctx: WriteContext, uid: string, to: Pick<Unit, "kind" | "framework">): Promise<void> {
  const file = await readUnitFile(ctx.paths, uid);
  const unit = parseUnit(file);
  const fail = (reason: string): never => {
    throw new Error(`Cannot reclassify ${uid}: ${reason}`);
  };
  if (isRemoved(unit)) fail("its latest version is removed");
  if ((unit.kind === "type") !== (to.kind === "type")) fail(`a ${unit.kind} cannot become a ${to.kind}`);
  await writeUnit(ctx, file.path, { ...unit, kind: to.kind, framework: to.framework }, fail);
}

/**
 * Whether `now` keeps recorded prehistory `was` as its tail, reaching further
 * back. Reaching back gives the old first entry a predecessor, so that entry
 * alone may change its `change` (from `created`) and its `parent`.
 */
export function extendsPrehistory(was: readonly Version[], now: readonly Version[]): boolean {
  if (was.length === 0) return true;
  if (now.length < was.length) return false;
  const tail = now.slice(now.length - was.length);
  const same = (a: Version, b: Version) => JSON.stringify(a) === JSON.stringify(b);
  if (!tail.slice(1).every((version, i) => same(version, was[i + 1]!))) return false;
  if (now.length === was.length) return same(tail[0]!, was[0]!);
  const { change: _change, parent: _parent, ...first } = tail[0]!;
  const { change: _was, parent: _wasParent, ...before } = was[0]!;
  return JSON.stringify(first) === JSON.stringify(before);
}

/**
 * Gives a unit the versions from before it was first recorded. Write-once: a
 * unit that has prehistory only accepts one that keeps it as its tail, reaching
 * further back.
 */
export async function setPrehistory(ctx: WriteContext, uid: string, prehistory: readonly Version[]): Promise<void> {
  const file = await readUnitFile(ctx.paths, uid);
  const unit = parseUnit(file);
  const fail = (reason: string): never => {
    throw new Error(`Cannot set the prehistory of ${uid}: ${reason}`);
  };
  if (prehistory.length === 0) fail("it is empty");
  if (!extendsPrehistory(unit.prehistory ?? [], prehistory)) fail("it would change recorded prehistory, which may only be extended further back");
  await writeUnit(ctx, file.path, { ...unit, prehistory: [...prehistory] }, fail);
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

/**
 * Gives the newest version of a unit its rationale, and adds links. History is
 * append-only, so only a version not yet committed may be changed: one that
 * `poetics index` just wrote with a run-wide rationale, say. A rationale someone
 * writes is no longer inferred.
 */
export async function recordRationale(ctx: WriteContext, uid: string, rationale: string, links: readonly Link[] = []): Promise<void> {
  const file = await readUnitFile(ctx.paths, uid);
  const unit = parseUnit(file);
  const fail = (reason: string): never => {
    throw new Error(`Cannot record a rationale for ${uid}: ${reason}`);
  };
  if (rationale.trim() === "") fail("the rationale is empty");
  const newest = unit.versions.length - 1;
  if (newest < committedVersions(ctx.paths.root, file.relativePath)) {
    fail(`its newest version (versions[${newest}]) is committed, and history is append-only; give the reason in the next version you record`);
  }
  const version = { ...unit.versions[newest]!, rationale: rationale.trim() };
  delete version.inferred;
  const merged = [...(version.links ?? []), ...links];
  const key = (link: Link) => (typeof link === "string" ? link : `${link.kind}:${link.ref}`);
  if (merged.length > 0) version.links = merged.filter((link, i) => merged.findIndex((other) => key(other) === key(link)) === i);
  await writeUnit(ctx, file.path, { ...unit, versions: [...unit.versions.slice(0, newest), version] }, fail);
}

/** Writes a new note file. Its id must be new, and it is attributed to `ctx.actor`. */
export async function createNote(ctx: WriteContext, note: Note): Promise<void> {
  const path = join(ctx.paths.notes, `${note.id}.json`);
  const fail = (reason: string): never => {
    throw new Error(`Cannot record note ${note.id}: ${reason}`);
  };
  const existing = await readFile(path, "utf8").catch(() => undefined);
  if (existing !== undefined) fail("a note with that id exists");
  const written: Note = { ...note, actor: ctx.actor };
  if (ctx.validator) {
    const result = ctx.validator.note(written);
    if (!result.valid) fail(result.errors.join("; "));
  }
  await mkdir(ctx.paths.notes, { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(written, null, 2)}\n`);
  await rename(temp, path);
}

/**
 * Confirms an active note against the code as it is: each anchored unit's
 * `observedAt` becomes its latest content hash, so the note is no longer
 * flagged for re-checking.
 */
export async function confirmNote(ctx: WriteContext, id: string): Promise<Note> {
  const path = join(ctx.paths.notes, `${id}.json`);
  const raw = await readFile(path, "utf8").catch(() => undefined);
  if (raw === undefined) throw new Error(`Cannot confirm note ${id}: there is no such note`);
  const note = parseNote({ path, relativePath: toPosix(relative(ctx.paths.root, path)), raw });
  if (note.status !== "active") throw new Error(`Cannot confirm note ${id}: it is ${note.status}, not active`);
  const units = note.anchors.units ?? [];
  for (const anchor of units) {
    const unit = parseUnit(await readUnitFile(ctx.paths, anchor.uid));
    if (isRemoved(unit)) throw new Error(`Cannot confirm note ${id}: anchored unit ${unit.name} (${unit.uid}) has been removed; retire the note or move its anchor`);
    anchor.observedAt = unit.versions.at(-1)!.contentHash;
  }
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(note, null, 2)}\n`);
  await rename(temp, path);
  return note;
}

/** How many versions the unit file had at HEAD: those are history. Zero for a file not committed yet. */
function committedVersions(root: string, relativePath: string): number {
  let raw: string;
  try {
    raw = execFileSync("git", ["show", `HEAD:${relativePath}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    // Not committed (or no repository): nothing about the file is history yet.
    return 0;
  }
  return (JSON.parse(raw) as Unit).versions.length;
}

export function linkTest(_ctx: WriteContext, _uid: string, _link: TestLink): Promise<void> {
  return notImplemented("linkTest");
}

export function setDocs(_ctx: WriteContext, _uid: string, _docs: string, _against: Hash): Promise<void> {
  return notImplemented("setDocs");
}
