import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { notImplemented } from "@poetics/core";
import type { Hash, LineageEntry, Link, Note, TestLink, Unit, Version } from "@poetics/core";
import type { StorePaths } from "./paths.ts";

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
}

/** Appends a version to a unit file. Append-only; never rewrites history. */
export function appendVersion(_ctx: WriteContext, _uid: string, _version: Version): Promise<void> {
  return notImplemented("appendVersion");
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
