export type { CheckResult, Problem } from "./check.ts";
export { checkStore } from "./check.ts";
export type { RebuildStats, UnitRow } from "./index-db.ts";
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
  declareLineage,
  linkTest,
  listUnitFiles,
  parseUnit,
  readUnitFiles,
  recordRationale,
  setDocs,
} from "./json-store.ts";
export type { StoreLayout, StorePaths } from "./paths.ts";
export { storePaths, unitFilePath } from "./paths.ts";
export type { SchemaSet, StoreValidator, ValidationResult } from "./schemas.ts";
export { createValidator, loadSchemaSet } from "./schemas.ts";
