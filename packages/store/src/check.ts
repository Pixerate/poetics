import { access, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { isProvisional } from "@poetics/core";
import type { Note, Unit } from "@poetics/core";
import { readNoteFiles, readUnitFiles } from "./json-store.ts";
import type { StorePaths } from "./paths.ts";
import type { StoreValidator } from "./schemas.ts";

export interface Problem {
  severity: "error" | "warning";
  file: string;
  message: string;
}

export interface CheckResult {
  units: number;
  notes: number;
  problems: Problem[];
}

/**
 * Validates the whole store: config, lock, every unit file and every note
 * against their JSON Schemas, then the rules a schema cannot express (ids
 * match filenames, version chains are intact, references point at real units,
 * notes and files, and notes are flagged when their units have moved on).
 */
export async function checkStore(paths: StorePaths, validator: StoreValidator): Promise<CheckResult> {
  const problems: Problem[] = [];
  const error = (file: string, message: string) => problems.push({ severity: "error", file, message });
  const warning = (file: string, message: string) => problems.push({ severity: "warning", file, message });

  const config = await readJsonIfPresent(paths.config);
  if (config === undefined) {
    error(".poetics/config.json", "missing");
  } else if (config instanceof Error) {
    error(".poetics/config.json", config.message);
  } else {
    for (const message of validator.config(config).errors) error(".poetics/config.json", message);
  }
  const allowProvisional = (config as { policy?: { allowProvisionalHashes?: boolean } } | undefined)?.policy
    ?.allowProvisionalHashes;

  const lock = await readJsonIfPresent(paths.lock);
  if (lock instanceof Error) error(".poetics/poetics.lock", lock.message);
  else if (lock !== undefined) for (const message of validator.lock(lock).errors) error(".poetics/poetics.lock", message);

  const units = new Map<string, { unit: Unit; file: string }>();
  for (const file of await readUnitFiles(paths)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.raw);
    } catch (cause) {
      error(file.relativePath, `invalid JSON: ${(cause as Error).message}`);
      continue;
    }
    const result = validator.unit(parsed);
    if (!result.valid) {
      for (const message of result.errors) error(file.relativePath, message);
      continue;
    }
    const unit = parsed as Unit;
    if (basename(file.path, ".json") !== unit.uid) {
      error(file.relativePath, `filename does not match uid ${unit.uid}`);
    }
    if (units.has(unit.uid)) {
      error(file.relativePath, `duplicate uid, also in ${units.get(unit.uid)!.file}`);
      continue;
    }
    units.set(unit.uid, { unit, file: file.relativePath });
  }

  for (const { unit, file } of units.values()) {
    checkVersions(unit, file, error, allowProvisional);
    if (!(await exists(join(paths.root, unit.location.file)))) {
      error(file, `location.file ${unit.location.file} does not exist`);
    }
    if (unit.owner !== undefined && !units.has(unit.owner)) error(file, `owner ${unit.owner} is not a known unit`);
    for (const version of unit.versions) {
      for (const dep of Object.keys(version.deps ?? {})) {
        if (!units.has(dep)) error(file, `dependency ${dep} is not a known unit`);
      }
    }
    for (const entry of unit.lineage ?? []) {
      for (const uid of entry.uids ?? []) if (!units.has(uid)) warning(file, `lineage refers to unknown unit ${uid}`);
    }
    for (const test of unit.tests ?? []) {
      if (!(await exists(join(paths.root, test.file)))) error(file, `linked test ${test.file} does not exist`);
    }
  }

  if (lock && !(lock instanceof Error)) {
    for (const uid of Object.keys((lock as { pins?: object }).pins ?? {})) {
      if (!units.has(uid)) error(".poetics/poetics.lock", `pin for unknown unit ${uid}`);
    }
  }

  const notes = await checkNotes(paths, validator, units, error, warning);

  return { units: units.size, notes, problems };
}

async function checkNotes(
  paths: StorePaths,
  validator: StoreValidator,
  units: ReadonlyMap<string, { unit: Unit }>,
  error: (file: string, message: string) => void,
  warning: (file: string, message: string) => void,
): Promise<number> {
  const notes = new Map<string, { note: Note; file: string }>();
  for (const file of await readNoteFiles(paths)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.raw);
    } catch (cause) {
      error(file.relativePath, `invalid JSON: ${(cause as Error).message}`);
      continue;
    }
    const result = validator.note(parsed);
    if (!result.valid) {
      for (const message of result.errors) error(file.relativePath, message);
      continue;
    }
    const note = parsed as Note;
    if (basename(file.path, ".json") !== note.id) error(file.relativePath, `filename does not match id ${note.id}`);
    if (notes.has(note.id)) {
      error(file.relativePath, `duplicate note id, also in ${notes.get(note.id)!.file}`);
      continue;
    }
    notes.set(note.id, { note, file: file.relativePath });
  }

  for (const { note, file } of notes.values()) {
    for (const anchor of note.anchors.units ?? []) {
      const unit = units.get(anchor.uid)?.unit;
      if (!unit) {
        error(file, `anchored unit ${anchor.uid} is not a known unit`);
        continue;
      }
      const latest = unit.versions.at(-1)?.contentHash;
      if (note.status === "active" && anchor.observedAt !== undefined && anchor.observedAt !== latest) {
        warning(file, `${unit.name} has changed since this note was confirmed; re-check it and update observedAt`);
      }
    }
    for (const path of note.anchors.paths ?? []) {
      if (!(await exists(join(paths.root, path)))) error(file, `anchored path ${path} does not exist`);
    }
    if (note.check?.kind === "test" || note.check?.kind === "config") {
      if (!(await exists(join(paths.root, note.check.ref)))) error(file, `check file ${note.check.ref} does not exist`);
    }
    if (note.supersededBy !== undefined) {
      if (!notes.has(note.supersededBy)) error(file, `supersededBy ${note.supersededBy} is not a known note`);
      else if (note.supersededBy === note.id) error(file, "a note cannot supersede itself");
    }
  }
  return notes.size;
}

function checkVersions(
  unit: Unit,
  file: string,
  error: (file: string, message: string) => void,
  allowProvisional: boolean | undefined,
): void {
  const seen = new Set<string>();
  unit.versions.forEach((version, i) => {
    const at = `versions[${i}]`;
    if (seen.has(version.contentHash)) error(file, `${at} repeats contentHash ${version.contentHash}`);
    seen.add(version.contentHash);

    const expectedParent = i === 0 ? null : unit.versions[i - 1]!.contentHash;
    if ((version.parent ?? null) !== expectedParent) {
      error(file, `${at}.parent should be ${expectedParent ?? "null"}`);
    }
    if ((i === 0) !== (version.change === "created")) {
      error(file, i === 0 ? `${at}.change must be "created"` : `${at}.change cannot be "created"`);
    }

    const hashes = [version.contentHash, version.interfaceHash, version.closureHash].filter((h) => h !== undefined);
    const provisional = hashes.some(isProvisional);
    if (provisional && version.provisional !== true) error(file, `${at} has git: hashes but is not marked provisional`);
    if (!provisional && version.provisional === true) error(file, `${at} is marked provisional but has no git: hashes`);
    if (provisional && allowProvisional === false) error(file, `${at} is provisional but policy forbids it`);
  });
}

async function readJsonIfPresent(path: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw cause;
  }
  try {
    return JSON.parse(raw);
  } catch (cause) {
    return new Error(`invalid JSON: ${(cause as Error).message}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
