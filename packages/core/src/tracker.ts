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

/** The pull requests behind a commit, and what reviewers said on them. */
export interface IssueTracker {
  /** `github`, `jira`, …: where links it produces point. */
  name: string;
  pullRequestsFor(commit: string): Promise<TrackedPullRequest[]>;
  reviewComments(pullRequest: number): Promise<TrackedReviewComment[]>;
}
