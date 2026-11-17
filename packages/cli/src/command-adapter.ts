// An out-of-process adapter (ADR 0025): a command the config names, run once
// per batch with one protocol request on stdin and one response on stdout. The
// response is checked before anything is used, and a failure stops the run
// rather than letting units look deleted.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADAPTER_PROTOCOL, adapterResponseProblems, checkAdapterResponse } from "@poetics/core";
import type { AdapterRequest, AdapterResponse, AdapterUnit, Span } from "@poetics/core";
import { commandAdapterFor } from "@poetics/store";
import type { AdapterEntry, CommandAdapterConfig } from "@poetics/store";
import type { AdaptedUnit, CodeAdapter, TextUnit } from "./adapters.ts";

const DEFAULT_TIMEOUT_SECONDS = 120;
// A large batch's response can be tens of megabytes; past this the adapter should be given smaller batches.
const MAX_RESPONSE_BYTES = 512 * 1024 * 1024;

/** A command adapter that could not answer a batch: the run stops, and no unit is changed for it. */
export class AdapterError extends Error {
  readonly adapter: string;
  constructor(adapter: string, message: string) {
    super(`adapter ${adapter}: ${message}`);
    this.name = "AdapterError";
    this.adapter = adapter;
  }
}

/** The adapter for one command entry in the config. `all` decides which files it reads: those no earlier command adapter claims. */
export function commandAdapter(root: string, entry: CommandAdapterConfig, all: readonly AdapterEntry[] = [entry]): CodeAdapter {
  const run = (files: AdapterRequest["files"]) => {
    const request: AdapterRequest = { protocol: ADAPTER_PROTOCOL, root, files };
    const response = runCommand(root, entry, request);
    const { errors, notRead } = checkAdapterResponse(request, response);
    if (errors.length > 0) throw new AdapterError(entry.name, `its response does not match the request: ${summarise(errors)}`);
    return { response, notRead };
  };
  return {
    name: entry.name,
    reads: (file) => commandAdapterFor(file, all) === entry,
    index(files) {
      const { response, notRead } = run(files.map((path) => ({ path })));
      const units = response.files.flatMap((file) => {
        if (!("units" in file)) return [];
        const lines = linesOf(readFileSync(join(root, file.path), "utf8"));
        return file.units.map((unit) => adapted(file.path, lines, unit));
      });
      return { units, notRead };
    },
    readTexts(files) {
      const texts = new Map(files.map((file) => [file.path, file.text]));
      const { response } = run(files.map(({ path, text }) => ({ path, text })));
      const out = new Map<string, TextUnit[]>();
      for (const file of response.files) {
        if (!("units" in file)) continue;
        const lines = linesOf(texts.get(file.path)!);
        out.set(
          file.path,
          file.units.map((unit) => {
            const { edges: _edges, unresolved: _unresolved, interfaceHash: _interface, owner: _owner, ...read } = adapted(file.path, lines, unit);
            return read;
          }),
        );
      }
      return out;
    },
  };
}

/** Runs the command on one request and returns its response, schema-checked, or throws an AdapterError saying why not. */
function runCommand(root: string, entry: CommandAdapterConfig, request: AdapterRequest): AdapterResponse {
  const [command, ...args] = entry.command;
  const seconds = entry.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const result = spawnSync(command!, args, { cwd: root, input: JSON.stringify(request), encoding: "utf8", timeout: seconds * 1000, maxBuffer: MAX_RESPONSE_BYTES });
  const stderr = result.stderr?.trim() ? `\n${result.stderr.trim().split("\n").slice(-20).join("\n")}` : "";
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT") throw new AdapterError(entry.name, `timed out after ${seconds} s on ${request.files.length} file(s)${stderr}`);
    if (code === "ENOENT") throw new AdapterError(entry.name, `could not start ${command}: is it installed and on PATH?`);
    throw new AdapterError(entry.name, `could not run ${command}: ${result.error.message}${stderr}`);
  }
  if (result.status !== 0) throw new AdapterError(entry.name, `${command} exited with ${result.status ?? result.signal}${stderr}`);
  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    throw new AdapterError(entry.name, `${command} wrote no valid JSON on stdout${stderr}`);
  }
  const problems = adapterResponseProblems(value);
  if (problems.length > 0) throw new AdapterError(entry.name, `its response breaks the adapter protocol: ${summarise(problems)}`);
  const response = value as AdapterResponse;
  if (response.adapter.name !== entry.name) throw new AdapterError(entry.name, `the response names adapter ${response.adapter.name}, not ${entry.name}`);
  return response;
}

function summarise(problems: readonly string[]): string {
  return problems.length <= 10 ? problems.join("; ") : `${problems.slice(0, 10).join("; ")}; and ${problems.length - 10} more`;
}

/** Where each line of a text starts, and how long the text is, for turning line numbers into spans. */
export interface Lines {
  starts: number[];
  length: number;
}

export function linesOf(text: string): Lines {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return { starts, length: text.length };
}

/** The span of lines `start` to `end` (1-based, inclusive), without the last line's newline, clamped to the text. */
export function spanOfLines(file: string, lines: Lines, start: number, end: number): Span {
  const clamp = (offset: number) => Math.min(Math.max(offset, 0), lines.length);
  const from = clamp(lines.starts[start - 1] ?? lines.length);
  const to = clamp(end < lines.starts.length ? lines.starts[end]! - 1 : lines.length);
  return { file, start: from, end: Math.max(from, to) };
}

function adapted(file: string, lines: Lines, unit: AdapterUnit): AdaptedUnit {
  const span = (from: number, to: number) => spanOfLines(file, lines, from, to);
  const out: AdaptedUnit = {
    key: unit.key,
    name: unit.name,
    kind: unit.kind,
    framework: unit.framework,
    span: span(unit.startLine, unit.endLine),
    startLine: unit.startLine,
    endLine: unit.endLine,
    contentHash: unit.contentHash,
    interfaceHash: unit.interfaceHash,
    fingerprint: unit.fingerprint,
    signatureText: unit.signatureText,
    edges: unit.edges.map(({ to, kind, resolution }) => ({ to, kind, resolution })),
    unresolved: unit.unresolved.map(({ kind, line, name, reason }) => ({ kind, span: span(line, line), reason: `${name}: ${reason}` })),
  };
  if (unit.owner !== undefined) out.owner = unit.owner;
  if (unit.docs !== undefined) out.docs = unit.docs;
  if (unit.runtimeHash !== undefined) out.runtimeHash = unit.runtimeHash;
  return out;
}
