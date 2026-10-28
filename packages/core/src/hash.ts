import { createHash } from "node:crypto";
import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
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
export function contentHash(normalisedTree: unknown): Hash {
  return b3("content", canonicalJson(normalisedTree));
}

/** BLAKE3 of the unit's public signature only. */
export function interfaceHash(signature: unknown): Hash {
  return b3("interface", canonicalJson(signature));
}

/** Merkle hash: hash(contentHash(u) + sorted closureHash(d) for each dependency d). */
export function closureHash(content: Hash, dependencyClosures: readonly Hash[]): Hash {
  for (const hash of [content, ...dependencyClosures]) {
    if (!isHash(hash)) throw new TypeError(`closureHash: not a hash: ${String(hash)}`);
  }
  // Sorted so the closure does not depend on the order imports were written in.
  return b3("closure", [content, ...[...dependencyClosures].sort()].join("\n"));
}

// The tag keeps a content hash and an interface hash of the same value apart.
function b3(tag: string, text: string): Hash {
  return `b3:${bytesToHex(blake3(utf8ToBytes(`poetics:${tag}\0${text}`)))}`;
}

/**
 * JSON with object keys sorted, so the hash is independent of the order the
 * indexer built the tree in. Values JSON cannot round-trip are rejected rather
 * than silently dropped, since two different trees must never hash alike; only
 * an `undefined` property is dropped, so an absent optional field and a missing
 * one hash the same.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number ${value}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  throw new TypeError(`canonicalJson: cannot hash a ${typeof value}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
