import { createHash } from "node:crypto";
import { notImplemented } from "./errors.ts";
import type { Hash } from "./types.ts";

const HASH_PATTERN = /^(b3:[0-9a-f]{64}|git:[0-9a-f]{40})$/;

export function isHash(value: unknown): value is Hash {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

export function isProvisional(hash: Hash): boolean {
  return hash.startsWith("git:");
}

/**
 * The provisional hash used before the indexer exists: the git blob hash of a
 * unit's source text, identical to `git hash-object --stdin`.
 */
export function gitBlobHash(source: string): Hash {
  const body = Buffer.from(source, "utf8");
  const header = Buffer.from(`blob ${body.length}\0`, "utf8");
  const digest = createHash("sha1").update(header).update(body).digest("hex");
  return `git:${digest}`;
}

/** BLAKE3 of the unit's normalised syntax tree, comments and formatting stripped. */
export function contentHash(_normalisedTree: unknown): Hash {
  return notImplemented("contentHash");
}

/** BLAKE3 of the unit's public signature only. */
export function interfaceHash(_signature: unknown): Hash {
  return notImplemented("interfaceHash");
}

/** Merkle hash: hash(contentHash(u) + sorted closureHash(d) for each dependency d). */
export function closureHash(_content: Hash, _dependencyClosures: readonly Hash[]): Hash {
  return notImplemented("closureHash");
}
