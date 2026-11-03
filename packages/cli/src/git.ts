import { execFileSync } from "node:child_process";

export function git(root: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** File contents at a ref, or undefined if the file did not exist there. */
export function showAt(root: string, ref: string, path: string): string | undefined {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
}

export interface FileChange {
  status: "A" | "M" | "D" | "R";
  path: string;
  /** Previous path, for renames. */
  from?: string;
}

/**
 * Files that differ between `base` and the working tree, including untracked
 * files, with renames detected. `base` is resolved to its merge base with HEAD
 * so a branch is compared with where it forked.
 */
export function changesSince(root: string, base: string): { base: string; changes: FileChange[] } {
  const resolved = base === "HEAD" ? git(root, ["rev-parse", "HEAD"]).trim() : git(root, ["merge-base", base, "HEAD"]).trim();
  const changes: FileChange[] = [];
  for (const line of git(root, ["diff", "--name-status", "-M", resolved]).split("\n")) {
    if (!line) continue;
    const [status, first, second] = line.split("\t");
    const code = status![0];
    if (code === "R") changes.push({ status: "R", from: first!, path: second! });
    else if (code === "A" || code === "M" || code === "D") changes.push({ status: code, path: first! });
    else if (code === "T" || code === "C") changes.push({ status: "M", path: second ?? first! });
  }
  for (const path of git(root, ["ls-files", "--others", "--exclude-standard"]).split("\n")) {
    if (path) changes.push({ status: "A", path });
  }
  return { base: resolved, changes };
}
