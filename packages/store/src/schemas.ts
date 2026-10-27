import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";

export interface SchemaSet {
  unit: object;
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
}

/** Reads `unit.schema.json`, `config.schema.json` and `lock.schema.json` from a directory. */
export async function loadSchemaSet(dir: string): Promise<SchemaSet> {
  const read = async (name: string): Promise<object> => JSON.parse(await readFile(join(dir, name), "utf8")) as object;
  const [unit, config, lock] = await Promise.all([
    read("unit.schema.json"),
    read("config.schema.json"),
    read("lock.schema.json"),
  ]);
  return { unit, config, lock };
}

export function createValidator(schemas: SchemaSet): StoreValidator {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const wrap =
    (validate: ValidateFunction) =>
    (value: unknown): ValidationResult => {
      const valid = validate(value);
      return { valid, errors: valid ? [] : formatErrors(validate.errors ?? []) };
    };
  return {
    unit: wrap(ajv.compile(schemas.unit)),
    config: wrap(ajv.compile(schemas.config)),
    lock: wrap(ajv.compile(schemas.lock)),
  };
}

function formatErrors(errors: readonly ErrorObject[]): string[] {
  return errors.map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`);
}
