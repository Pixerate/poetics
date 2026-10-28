import { readFileSync } from "node:fs";
import { NotImplementedError } from "@poetics/core";
import { changesBetween, storePaths } from "@poetics/store";
import type { ChangeSet } from "@poetics/store";
import { formatChanges } from "./changes.ts";
import { COMMANDS } from "./commands.ts";

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

// src/ and dist/ both sit one level below package.json.
export const VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
).version;

/** Exit codes: 0 ok, 1 findings (e.g. verify), 2 usage or not-implemented. `root` is the repository root. */
export async function run(argv: readonly string[], io: Io, root: string = process.cwd()): Promise<number> {
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
    if (command.name === "changes") return await changes(args.slice(1), io, json, root);
    throw new NotImplementedError(`poetics ${command.name}`);
  } catch (error) {
    if (error instanceof NotImplementedError) {
      report(io, json, { error: "not-implemented", command: command.name, message: error.message });
      return 2;
    }
    throw error;
  }
}

async function changes(args: readonly string[], io: Io, json: boolean, root: string): Promise<number> {
  // --impact needs the composition graph, which arrives with the indexer.
  if (args.includes("--impact")) throw new NotImplementedError("poetics changes --impact");
  const [from, to, ...extra] = args;
  if (extra.length > 0 || args.some((arg) => arg.startsWith("-"))) {
    report(io, json, { error: "usage", command: "changes", message: "Usage: poetics changes [from] [to]" });
    return 2;
  }
  let set: ChangeSet;
  try {
    set = await changesBetween(storePaths(root), { ...(from ? { from } : {}), ...(to ? { to } : {}) });
  } catch (error) {
    report(io, json, { error: "invalid-argument", command: "changes", message: (error as Error).message });
    return 2;
  }
  io.out(json ? JSON.stringify(set) : formatChanges(set));
  return 0;
}

function report(io: Io, json: boolean, payload: { error: string; message: string; command?: string }): void {
  io.err(json ? JSON.stringify(payload) : payload.message);
}

function helpText(): string {
  const width = Math.max(...COMMANDS.map((command) => command.usage.length));
  const lines = COMMANDS.map((command) => `  ${command.usage.padEnd(width)}  ${command.summary}`);
  return [`poetics ${VERSION}`, "", "Usage:", ...lines, "", "Every command accepts --json for structured output."].join("\n");
}
