import type { DatabaseSync } from "node:sqlite";
import type { Unit } from "@poetics/core";
import { findUnitsByName, getUnit } from "./index-db.ts";
import { readUnit } from "./json-store.ts";
import type { StorePaths } from "./paths.ts";

/**
 * Resolves a unit reference: a uid, a unit name, or `file#name` when a name is
 * shared. Ambiguous names are refused with the candidates, never guessed.
 * `db` must already be up to date with the unit files.
 */
export async function resolveUnit(paths: StorePaths, db: DatabaseSync, ref: string): Promise<Unit> {
  if (getUnit(db, ref)) return readUnit(paths, ref);
  const hashAt = ref.lastIndexOf("#");
  const [file, name] = hashAt > 0 ? [ref.slice(0, hashAt), ref.slice(hashAt + 1)] : [undefined, ref];
  const rows = findUnitsByName(db, name).filter((row) => file === undefined || row.file === file);
  if (rows.length === 1) return readUnit(paths, rows[0]!.uid);
  if (rows.length === 0) throw new Error(`No unit matches ${ref}; search for it by name, docs or rationale`);
  const candidates = rows.map((row) => `${row.uid} (${row.file}#${row.name})`).join(", ");
  throw new Error(`${ref} is ambiguous: ${candidates}. Pass a uid or file#name`);
}
