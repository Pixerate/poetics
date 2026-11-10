// Pull request evidence for backfill (ADR 0011). Offline, a commit subject
// names its pull request. With a tracker, the pull requests that contain the
// commit add links, the issues they close, and confidence when they speak to a
// unit. Their text is read to decide that, never written to .poetics/.
import type { Inferred, IssueTracker, Link, TrackedPullRequest, TrackedReviewComment } from "@poetics/core";
import type { TrackerStatus } from "./github.ts";
import { RateLimitedError } from "./github.ts";

/** What a tracker said about one commit. */
export interface CommitPullRequests {
  pullRequests: TrackedPullRequest[];
  comments: Map<number, TrackedReviewComment[]>;
}

/** Where a unit's code was in a commit, to place review comments. */
export interface UnitLines {
  name: string;
  file: string;
  /** 1-based and inclusive. */
  startLine: number;
  endLine: number;
}

/** A tracker's part in a backfill, for the report. */
export interface TrackerUse {
  name: string;
  status: TrackerStatus;
  /** Pull requests linked from what it returned. */
  pullRequests: number;
}

/** Pull request numbers a commit subject names: `Merge pull request #12 from …` or a squash subject ending `(#12)`. */
export function pullRequestsInSubject(subject: string): string[] {
  const merge = /^Merge pull request #(\d+)\b/.exec(subject);
  if (merge) return [`#${merge[1]}`];
  const squash = /\(#(\d+)\)\s*$/.exec(subject);
  return squash ? [`#${squash[1]}`] : [];
}

/** Issues a pull request closes with GitHub's keywords: `Fixes #3`, `closes #4`, `Resolved #5`. */
export function closingIssues(text: string): string[] {
  return [...new Set([...text.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)\b/gi)].map((m) => `#${m[1]}`))];
}

/**
 * Asks `tracker` about each commit once, keeping what it said. After a rate
 * limit it asks nothing more: the commits it did answer keep their evidence.
 */
export function trackerReader(tracker: IssueTracker | undefined, status: TrackerStatus | undefined): {
  read(commit: string): Promise<CommitPullRequests | undefined>;
  use(): TrackerUse | undefined;
} {
  const seen = new Map<string, CommitPullRequests>();
  const linked = new Set<number>();
  let state = status ?? (tracker ? "used" : undefined);
  return {
    async read(commit) {
      if (!tracker || state !== "used") return undefined;
      if (seen.has(commit)) return seen.get(commit);
      try {
        const pullRequests = await tracker.pullRequestsFor(commit);
        const comments = new Map<number, TrackedReviewComment[]>();
        for (const pr of pullRequests) comments.set(pr.number, await tracker.reviewComments(pr.number));
        const found = { pullRequests, comments };
        for (const pr of pullRequests) linked.add(pr.number);
        seen.set(commit, found);
        return found;
      } catch (error) {
        if (!(error instanceof RateLimitedError)) throw error;
        state = "rate-limited";
        return undefined;
      }
    },
    // Nothing to report when no one connected a tracker or said why not.
    use() {
      return state ? { name: tracker?.name ?? "github", status: state, pullRequests: linked.size } : undefined;
    },
  };
}

/**
 * Links, sources and whether a pull request speaks to `unit`: its title or
 * description names it, or a review comment falls on its lines. Shared text
 * that does neither speaks to the whole change, not to this unit.
 */
export function pullRequestEvidence(subject: string, found: CommitPullRequests | undefined, unit: UnitLines): { links: Link[]; sources: Inferred["sources"]; speaks: boolean } {
  const links: Link[] = [];
  const sources = new Set<Inferred["sources"][number]>();
  const tracked = new Set((found?.pullRequests ?? []).map((pr) => `#${pr.number}`));
  for (const ref of pullRequestsInSubject(subject)) if (!tracked.has(ref)) links.push({ kind: "github-pr", ref });
  let speaks = false;
  for (const pr of found?.pullRequests ?? []) {
    links.push({ kind: "github-pr", ref: `#${pr.number}`, url: pr.url });
    sources.add("pull-request");
    for (const issue of closingIssues(pr.body)) {
      links.push({ kind: "github-issue", ref: issue });
      sources.add("issue");
    }
    if (names(`${pr.title}\n${pr.body}`, unit.name)) speaks = true;
    for (const comment of found!.comments.get(pr.number) ?? []) {
      if (comment.path === unit.file && comment.startLine <= unit.endLine && comment.endLine >= unit.startLine) {
        speaks = true;
        sources.add("comment");
      }
    }
  }
  return { links, sources: [...sources], speaks };
}

/** Confidence once pull requests are counted: one that speaks to the unit makes it high, any other lifts low to medium. */
export function withPullRequests(confidence: Inferred["confidence"], found: CommitPullRequests | undefined, speaks: boolean): Inferred["confidence"] {
  if (speaks) return "high";
  return confidence === "low" && (found?.pullRequests.length ?? 0) > 0 ? "medium" : confidence;
}

/** Text about a unit names it as a word. */
function names(text: string, name: string): boolean {
  return new RegExp(`(?<![\\w$])${name.replace(/[$]/g, "\\$")}(?![\\w$])`).test(text);
}
