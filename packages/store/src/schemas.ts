import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";

export interface SchemaSet {
  unit: object;
  note: object;
  config: object;
  lock: object;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface StoreValidator {
  unit(value: unknown): ValidationResult;
  config(value: unknown): ValidationResult;
  lock(value: unknown): ValidationResult;
  note(value: unknown): ValidationResult;
}

/** Reads the unit, note, config and lock schemas from a directory. */
export async function loadSchemaSet(dir: string): Promise<SchemaSet> {
  const read = async (name: string): Promise<object> => JSON.parse(await readFile(join(dir, name), "utf8")) as object;
  const [unit, note, config, lock] = await Promise.all([
    read("unit.schema.json"),
    read("note.schema.json"),
    read("config.schema.json"),
    read("lock.schema.json"),
  ]);
  return { unit, note, config, lock };
}

export function createValidator(schemas: SchemaSet): StoreValidator {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const wrap =
    (validate: ValidateFunction) =>
    (value: unknown): ValidationResult => {
      const valid = validate(value);
      return { valid, errors: valid ? [] : formatErrors(validate.errors ?? []) };
    };
  // The note schema refers to definitions in the unit schema, so the unit schema is compiled first.
  const unit = wrap(ajv.compile(schemas.unit));
  return {
    unit,
    note: wrap(ajv.compile(schemas.note)),
    config: wrap(ajv.compile(schemas.config)),
    lock: wrap(ajv.compile(schemas.lock)),
  };
}

function formatErrors(errors: readonly ErrorObject[]): string[] {
  return errors.map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`);
}
