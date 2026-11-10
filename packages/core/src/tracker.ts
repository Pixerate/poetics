// What backfill asks an issue tracker (ADR 0011). GitHub is the first; others
// implement the same interface, so the collectors never change for them.

/** A pull request as a tracker reports it. Its text is evidence only and is never written to `.poetics/`. */
export interface TrackedPullRequest {
  number: number;
  url: string;
  title: string;
  body: string;
  labels: string[];
}

/** A review comment, with the lines it was left on in the file as the pull request saw it. */
export interface TrackedReviewComment {
  path: string;
  /** 1-based and inclusive. */
  startLine: number;
  endLine: number;
  body: string;
}

/** An issue, or a pull request read as one. Its text is read on demand for agents and never written to `.poetics/`. */
export interface TrackedIssue {
  number: number;
  url: string;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  /** GitHub numbers issues and pull requests together. */
  pullRequest: boolean;
}

/** The pull requests behind a commit, what reviewers said on them, and the issues agents ask about. */
export interface IssueTracker {
  /** `github`, `jira`, …: where links it produces point. */
  name: string;
  pullRequestsFor(commit: string): Promise<TrackedPullRequest[]>;
  reviewComments(pullRequest: number): Promise<TrackedReviewComment[]>;
  /** One issue or pull request by number, or undefined when there is none. Optional: backfill never asks. */
  issue?(number: number): Promise<TrackedIssue | undefined>;
  /** Whether anyone can read the repository: its pull request text may then be drafted from (ADR 0011). Unknown counts as private. */
  visibility?(): Promise<"public" | "private">;
}
