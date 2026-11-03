import type { Actor, LineageEntry, Link, Unit, Version } from "@poetics/core";

/** Renders `poetics log`: every version of a unit, newest first, with its hash, commit, author and rationale. */
export function formatLog(unit: Unit): string {
  const lines = [`${unit.name} (${unit.kind}, ${unit.location.file}) ${unit.uid}: ${unit.versions.length} version(s)`];
  for (let seq = unit.versions.length - 1; seq >= 0; seq--) {
    const version = unit.versions[seq]!;
    const where = [version.contentHash.slice(0, 12), version.commit?.slice(0, 7)].filter(Boolean).join(" ");
    lines.push("", `#${seq} ${version.change} ${where} by ${actorLabel(version.actor)}`, ...details(version, "   "));
  }
  if ((unit.lineage ?? []).length > 0) lines.push("", "Lineage:", ...unit.lineage!.map((entry) => `  ${lineageLabel(entry)}`));
  return lines.join("\n");
}

/** Renders `poetics why`: the rationale chain that led to the current version, oldest first. */
export function formatWhy(unit: Unit): string {
  const lines = [`Why ${unit.name} (${unit.location.file}) is the way it is:`];
  unit.versions.forEach((version, seq) => lines.push("", `${seq + 1}. ${version.change}`, ...details(version, "   ")));
  if ((unit.lineage ?? []).length > 0) lines.push("", "Along the way:", ...unit.lineage!.map((entry) => `  ${lineageLabel(entry)}`));
  return lines.join("\n");
}

function details(version: Version, indent: string): string[] {
  const lines = [`${indent}${version.rationale}`];
  const links = (version.links ?? []).map(linkLabel);
  if (links.length > 0) lines.push(`${indent}links: ${links.join(", ")}`);
  return lines;
}

function actorLabel(actor: Actor): string {
  if (actor.kind !== "agent") return actor.kind;
  return `${actor.tool}${actor.model ? ` (${actor.model})` : ""}${actor.reviewed ? ", reviewed" : ", unreviewed"}`;
}

function linkLabel(link: Link): string {
  return typeof link === "string" ? link : (link.url ?? link.ref);
}

function lineageLabel(entry: LineageEntry): string {
  return `${entry.kind}${entry.from ? ` from ${entry.from}` : ""}${entry.uids ? ` with ${entry.uids.join(", ")}` : ""}${entry.commit ? ` in ${entry.commit.slice(0, 7)}` : ""}`;
}
