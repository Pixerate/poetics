import { readFileSync } from "node:fs";
import { NotImplementedError } from "@poetics/core";
import { COMMANDS } from "./commands.ts";

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

// src/ and dist/ both sit one level below package.json.
export const VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
).version;

/** Exit codes: 0 ok, 1 findings (e.g. verify), 2 usage or not-implemented. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  const json = argv.includes("--json");
  const args = argv.filter((arg) => arg !== "--json");
  const [name] = args;

  if (name === undefined || name === "help" || name === "--help" || name === "-h") {
    io.out(json ? JSON.stringify({ version: VERSION, commands: COMMANDS }) : helpText());
    return 0;
  }
  if (name === "--version" || name === "-v") {
    io.out(json ? JSON.stringify({ version: VERSION }) : VERSION);
    return 0;
  }

  const command = COMMANDS.find((spec) => spec.name === name);
  if (!command) {
    report(io, json, { error: "unknown-command", message: `Unknown command: ${name}. Run poetics help.` });
    return 2;
  }

  try {
    throw new NotImplementedError(`poetics ${command.name}`);
  } catch (error) {
    if (error instanceof NotImplementedError) {
      report(io, json, { error: "not-implemented", command: command.name, message: error.message });
      return 2;
    }
    throw error;
  }
}

function report(io: Io, json: boolean, payload: { error: string; message: string; command?: string }): void {
  io.err(json ? JSON.stringify(payload) : payload.message);
}

function helpText(): string {
  const width = Math.max(...COMMANDS.map((command) => command.usage.length));
  const lines = COMMANDS.map((command) => `  ${command.usage.padEnd(width)}  ${command.summary}`);
  return [`poetics ${VERSION}`, "", "Usage:", ...lines, "", "Every command accepts --json for structured output."].join("\n");
}
