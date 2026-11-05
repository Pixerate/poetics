// Handlers for the write tools. Every write is append-only and attributed to
// the calling agent's session; arguments come from an agent, so each handler
// checks what it reads, and declarations are checked against the code.
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { declareLineage } from "@poetics/cli";
import { mintUid } from "@poetics/core";
import type { Actor, LineageKind, Note, NoteAnchors, UnitKind } from "@poetics/core";
import { buildGotchas, confirmNote, createNote, readConfig, readUnit, recordRationale, resolveUnit as resolveInStore } from "@poetics/store";
import type { Unit } from "@poetics/core";
import type { CodeView } from "./code.ts";
import type { ReadContext } from "./read-tools.ts";

function resolveUnit(ctx: ReadContext, ref: string): Promise<Unit> {
  return resolveInStore(ctx.paths, ctx.db, ref);
}

export interface WriteToolContext extends ReadContext {
  /** Who the writes are attributed to: the agent session calling the server. */
  actor: Actor;
}

const NOTE_KINDS = ["gotcha", "workaround", "invariant"] as const;
const LINEAGE_KINDS = ["rename", "move", "split", "merge"] as const;

/** Answers one write tool call. */
export async function callWriteTool(ctx: WriteToolContext, name: string, args: Record<string, unknown>): Promise<unknown> {
  const store = { paths: ctx.paths, actor: ctx.actor };
  switch (name) {
    case "poetics_record_rationale": {
      const unit = await resolveUnit(ctx, text(args, "unit"));
      const links = args["links"] === undefined ? [] : strings(args, "links");
      await recordRationale(store, unit.uid, text(args, "rationale"), links);
      const updated = await readUnit(ctx.paths, unit.uid);
      return { uid: unit.uid, name: unit.name, version: updated.versions.length - 1, rationale: updated.versions.at(-1)!.rationale };
    }
    case "poetics_declare_lineage": {
      const kind = text(args, "kind") as LineageKind;
      if (!(LINEAGE_KINDS as readonly string[]).includes(kind)) throw new Error(`kind must be one of ${LINEAGE_KINDS.join(", ")}`);
      const uids: string[] = [];
      for (const ref of strings(args, "from")) uids.push((await resolveUnit(ctx, ref)).uid);
      const view = ctx.code ? await ctx.code() : undefined;
      const to = strings(args, "to").map((ref) => place(ref, view));
      const config = await readConfig(ctx.paths.root);
      const result = await declareLineage(ctx.paths.root, config, { kind, uids, to }, ctx.actor, config.store?.layout);
      return {
        moved: result.moved.map(({ uid, key, lineage }) => ({ uid, to: key, lineage })),
        created: result.created.map((unit) => ({ uid: unit.uid, name: unit.name, file: unit.location.file, lineage: unit.lineage ?? [] })),
        removed: result.removed.map(({ uid, mergedInto }) => ({ uid, mergedInto })),
        next: "Run poetics index to record any code changes, then poetics_record_rationale for each new version.",
      };
    }
    case "poetics_record_note": {
      const confirm = args["confirm"];
      if (typeof confirm === "string" && confirm.length > 0) {
        const note = await confirmNote(store, confirm);
        return { id: note.id, confirmed: true, gotchas: await refreshGotchas(ctx.paths.root) };
      }
      const note = await newNote(ctx, args);
      await createNote(store, note);
      return { id: note.id, confirmed: false, gotchas: await refreshGotchas(ctx.paths.root) };
    }
    default:
      throw new Error(`Unknown write tool: ${name}`);
  }
}

/** A note from the tool's arguments, its unit anchors resolved and observed at their current versions. */
async function newNote(ctx: WriteToolContext, args: Record<string, unknown>): Promise<Note> {
  const kind = text(args, "kind") as Note["kind"];
  if (!(NOTE_KINDS as readonly string[]).includes(kind)) throw new Error(`kind must be one of ${NOTE_KINDS.join(", ")}`);
  const given = (args["anchors"] ?? {}) as Record<string, unknown>;
  if (typeof given !== "object" || Array.isArray(given)) throw new Error("anchors must be an object");
  const anchors: NoteAnchors = {};
  if (given["units"] !== undefined) {
    if (!Array.isArray(given["units"])) throw new Error("anchors.units must be an array of unit references");
    anchors.units = [];
    for (const entry of given["units"] as unknown[]) {
      const ref = typeof entry === "string" ? entry : (entry as { uid?: unknown })?.uid;
      if (typeof ref !== "string") throw new Error("anchors.units must name units");
      const unit = await resolveUnit(ctx, ref);
      anchors.units.push({ uid: unit.uid, observedAt: unit.versions.at(-1)!.contentHash });
    }
  }
  for (const key of ["paths", "commands"] as const) {
    if (given[key] !== undefined) anchors[key] = strings(given, key);
  }
  if (given["dependencies"] !== undefined) anchors.dependencies = given["dependencies"] as NonNullable<NoteAnchors["dependencies"]>;
  const note: Note = {
    id: mintUid(),
    kind,
    area: text(args, "area"),
    title: text(args, "title"),
    symptoms: strings(args, "symptoms"),
    cause: text(args, "cause"),
    fix: text(args, "fix"),
    anchors,
    status: "active",
    actor: ctx.actor,
  };
  if (args["check"] !== undefined) note.check = args["check"] as NonNullable<Note["check"]>;
  return note;
}

/** Regenerates GOTCHAS.md when the repository keeps one, since CI fails when it drifts from the notes. */
async function refreshGotchas(root: string): Promise<"updated" | "none"> {
  const path = join(root, "GOTCHAS.md");
  if (!existsSync(path)) return "none";
  await writeFile(path, await buildGotchas(root));
  return "updated";
}

/** A `file#name` place, with the kind the code there has, so a type and a function are told apart. */
function place(ref: string, view: CodeView | undefined): { file: string; name: string; kind: UnitKind } {
  const at = ref.lastIndexOf("#");
  if (at <= 0 || at === ref.length - 1) throw new Error(`to must name places as file#name, not ${ref}`);
  const file = ref.slice(0, at);
  const name = ref.slice(at + 1);
  const code = view && [...view.byUid.values(), ...view.untracked].find((unit) => unit.span.file === file && unit.name === name);
  return { file, name, kind: code?.kind ?? "function" };
}

function text(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} must be a non-empty string`);
  return value;
}

function strings(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) throw new Error(`${key} must be an array of non-empty strings`);
  return value as string[];
}
