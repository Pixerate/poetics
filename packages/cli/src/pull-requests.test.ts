import { describe, expect, it } from "vitest";
import type { IssueTracker } from "@poetics/core";
import { RateLimitedError } from "./github.ts";
import { closingIssues, pullRequestEvidence, pullRequestsInSubject, trackerReader, withPullRequests } from "./pull-requests.ts";
import type { CommitPullRequests } from "./pull-requests.ts";

const PR = { number: 12, url: "https://github.com/acme/shop/pull/12", title: "Round prices", body: "Closes #3 and fixes: #4. See #5.", labels: [] };
const UNIT = { name: "formatPrice", file: "src/price.ts", startLine: 10, endLine: 20 };

describe("pullRequestsInSubject", () => {
  it("reads merge and squash subjects only", () => {
    expect(pullRequestsInSubject("Merge pull request #51 from acme/feat")).toEqual(["#51"]);
    expect(pullRequestsInSubject("feat(cli): add backfill (#43)")).toEqual(["#43"]);
    expect(pullRequestsInSubject("Fix #12 in formatPrice")).toEqual([]);
  });
});

describe("closingIssues", () => {
  it("finds GitHub's closing keywords and ignores other references", () => {
    expect(closingIssues(PR.body)).toEqual(["#3", "#4"]);
    expect(closingIssues("Resolved #9, resolves #9")).toEqual(["#9"]);
  });
});

describe("pullRequestEvidence", () => {
  const found = (comments: CommitPullRequests["comments"] = new Map()): CommitPullRequests => ({ pullRequests: [PR], comments });

  it("links the pull request and the issues it closes, without speaking to the unit", () => {
    expect(pullRequestEvidence("Merge pull request #12 from x", found(), UNIT)).toEqual({
      links: [
        { kind: "github-pr", ref: "#12", url: PR.url },
        { kind: "github-issue", ref: "#3" },
        { kind: "github-issue", ref: "#4" },
      ],
      sources: ["pull-request", "issue"],
      speaks: false,
    });
  });

  it("speaks to a unit a review comment falls on, not one its title or description only names", () => {
    expect(pullRequestEvidence("x", { pullRequests: [{ ...PR, title: "Round formatPrice", body: "formatPrice rounds half up." }], comments: new Map() }, UNIT).speaks).toBe(false);
    const onLines = pullRequestEvidence("x", found(new Map([[12, [{ path: "src/price.ts", startLine: 18, endLine: 25, body: "why?" }]]])), UNIT);
    expect([onLines.speaks, onLines.sources]).toEqual([true, ["pull-request", "issue", "comment"]]);
    const elsewhere = found(new Map([[12, [{ path: "src/price.ts", startLine: 21, endLine: 25, body: "" }, { path: "src/other.ts", startLine: 10, endLine: 10, body: "" }]]]));
    expect(pullRequestEvidence("x", elsewhere, UNIT).speaks).toBe(false);
  });

  it("links a subject's pull request offline, once", () => {
    expect(pullRequestEvidence("feat: x (#12)", undefined, UNIT)).toEqual({ links: [{ kind: "github-pr", ref: "#12" }], sources: [], speaks: false });
    expect(pullRequestEvidence("feat: x (#12)", found(), UNIT).links.filter((l) => typeof l !== "string" && l.kind === "github-pr")).toHaveLength(1);
  });
});

describe("withPullRequests", () => {
  it("raises to high when a pull request speaks to the unit, and low to medium for any other", () => {
    const one: CommitPullRequests = { pullRequests: [PR], comments: new Map() };
    expect(withPullRequests("medium", one, true)).toBe("high");
    expect(withPullRequests("low", one, false)).toBe("medium");
    expect(withPullRequests("medium", one, false)).toBe("medium");
    expect(withPullRequests("low", undefined, false)).toBe("low");
  });
});

describe("trackerReader", () => {
  it("asks once per commit, stops at a rate limit and reports what it linked", async () => {
    let asked = 0;
    const tracker: IssueTracker = {
      name: "github",
      async pullRequestsFor(commit) {
        asked++;
        if (commit === "limited") throw new RateLimitedError("limit");
        return [PR];
      },
      async reviewComments() {
        return [];
      },
    };
    const reader = trackerReader(tracker, "used");
    expect((await reader.read("a"))?.pullRequests).toEqual([PR]);
    await reader.read("a");
    expect(await reader.read("limited")).toBeUndefined();
    expect(await reader.read("b")).toBeUndefined();
    expect(asked).toBe(2);
    expect(reader.use()).toEqual({ name: "github", status: "rate-limited", pullRequests: 1 });
  });

  it("reports why it has no tracker, and nothing when no one said", async () => {
    expect(trackerReader(undefined, "no-token").use()).toEqual({ name: "github", status: "no-token", pullRequests: 0 });
    expect(await trackerReader(undefined, "no-token").read("a")).toBeUndefined();
    expect(trackerReader(undefined, undefined).use()).toBeUndefined();
  });
});
