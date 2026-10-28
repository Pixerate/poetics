import type { ChangeSet, UnitChange } from "@poetics/store";

const MARK: Record<UnitChange["status"], string> = { added: "+", changed: "~", removed: "-" };

/** Renders a change set for a terminal: each commit's units with change class and rationale. */
export function formatChanges(set: ChangeSet): string {
  const units = set.commits.reduce((n, commit) => n + commit.units.length, 0);
  const lines = [`Changes from ${short(set.from)} to ${short(set.to)}: ${set.commits.length} commit(s), ${units} unit change(s)`];

  for (const commit of set.commits) {
    lines.push("", `${short(commit.commit)} ${commit.subject}`);
    for (const unit of commit.units) {
      const classes = unit.versions.map((v) => v.change).join(", ");
      lines.push(`  ${MARK[unit.status]} ${unit.name} (${unit.kind}, ${unit.file})${classes ? ` ${classes}` : ""}`);
      for (const entry of unit.lineage) {
        lines.push(`      ${entry.kind}${entry.from ? ` from ${entry.from}` : ""}${entry.uids ? ` with ${entry.uids.join(", ")}` : ""}`);
      }
      for (const version of unit.versions) {
        lines.push(`      ${version.rationale}`);
        const links = (version.links ?? []).map((link) => (typeof link === "string" ? link : link.url ?? link.ref));
        if (links.length > 0) lines.push(`      links: ${links.join(", ")}`);
      }
      if (unit.status === "removed" && unit.versions.length === 0) lines.push("      unit file deleted; no rationale recorded");
    }
  }

  if (set.unrecorded.length > 0) {
    lines.push("", "Commits that recorded no unit change:");
    for (const commit of set.unrecorded) lines.push(`  ${short(commit.commit)} ${commit.subject}`);
  }
  if (set.decisions.length > 0) lines.push("", `Decisions: ${set.decisions.join(", ")}`);
  if (set.notes.length > 0) lines.push("", `Notes: ${set.notes.join(", ")}`);
  return lines.join("\n");
}

function short(ref: string): string {
  return /^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 7) : ref;
}
