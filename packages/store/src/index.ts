export type { ChangeSet, ChangesOptions, CommitChanges, CommitSummary, UnitChange } from "./changes.ts";
export { changesBetween } from "./changes.ts";
export type { CheckResult, Problem } from "./check.ts";
export type { CoverageThresholds, PoeticsConfig } from "./config.ts";
export { readConfig } from "./config.ts";
export { createMatcher, globToRegExp } from "./glob.ts";
export { checkStore } from "./check.ts";
export type { RenderOptions } from "./gotchas.ts";
export { AREA_TITLES, buildGotchas, renderGotchas } from "./gotchas.ts";
export type { RebuildStats, SearchOptions, UnitRow } from "./index-db.ts";
export {
  INDEX_SCHEMA_VERSION,
  dependentsOf,
  dumpIndex,
  findUnitsByName,
  getUnit,
  openIndex,
  rebuildIndex,
  searchUnits,
} from "./index-db.ts";
export type { UnitFile, WriteContext } from "./json-store.ts";
export {
  appendVersion,
  confirmNote,
  createNote,
  createUnit,
  extendsPrehistory,
  linkTest,
  listNoteFiles,
  listUnitFiles,
  parseNote,
  parseUnit,
  readNoteFiles,
  readUnit,
  readUnitFiles,
  reclassifyUnit,
  recordRationale,
  relinkTests,
  relocateUnit,
  setPrehistory,
  setDocs,
} from "./json-store.ts";
export type { StoreLayout, StorePaths } from "./paths.ts";
export { resolveUnit } from "./resolve.ts";
export type { Scope } from "./scope.ts";
export { filesInScope } from "./scope.ts";
export { storePaths, unitFilePath } from "./paths.ts";
export type { SchemaSet, StoreValidator, ValidationResult } from "./schemas.ts";
export { createValidator, loadSchemaSet } from "./schemas.ts";
