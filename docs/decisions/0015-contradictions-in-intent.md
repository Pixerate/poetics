# 0015. Contradictions in intent are found by reading recorded intent together

- Status: Proposed
- Date: 2026-11-09

## Context

Poetics records intent in several places:

- **Version rationale:** why each unit changed, one entry per version.
- **Notes:** invariants (rules to keep) today, and assumptions and
  considerations if [ADR 0012](0012-open-items-as-notes.md) is accepted.
- **Decisions:** the records in `docs/decisions/`, which versions cite with a
  `decision` link.
- **Docs:** each unit's `docs` field.

Every one of these is checked against the code. Hashes catch code that changed
without a version, `observedAt` flags a note when its unit moves on, and
interface hashes flag callers. None of them is checked against the others.
Intent can contradict itself while every check passes:

- **A silent reversal.** `formatPrice` v3 says "round half up so totals match
  the till". v7 says "use banker's rounding", without mentioning v3. The
  reason for v3 is lost, and nobody decided to drop it.
- **Caller against dependency.** `CartTotal`'s rationale says "prices
  arrive in minor units". `formatPrice` now says "accepts major units as
  decimals". Both compile and their interfaces match, but they disagree about
  what a number means.
- **A change against a note.** An invariant anchored to `useCheckout` says
  "never call the payment API twice for one order". A new version's rationale
  says "retry on timeout".
- **A unit against a decision.** A version cites
  [ADR 0002](0002-hybrid-json-sqlite-store.md) while doing what a later record
  superseded, or does the opposite of what an accepted record says, and cites
  nothing.

Today a reviewer catches these only if they happen to remember both sides.
[AGENTS.md](../../AGENTS.md) says "don't reverse a decision silently", but
nothing checks it. An agent is worse placed than a person: it starts each
session without the history unless it is handed that history.

Options considered:

- **Leave it to review.** No cost, but it misses the cases above, and those
  are the cases Poetics exists to catch: intent that a new session cannot see.
- **A formal claims language.** Intent written as checkable assertions
  (`units: minor`) that a solver compares. Precise, but nobody writes it, and
  the intent that matters is in prose. Invariant notes with a `check`
  already formalise the rules worth formalising, and the note ladder (note,
  then check, then fix) already pushes towards that.
- **Deterministic text heuristics.** Negation and antonym matching across
  rationale. Cheap and repeatable, but noisy both ways: "no longer rounds" is
  a contradiction only if nothing acknowledges it, and real conflicts rarely
  share words.
- **A language model reads pairs, chosen by the graph.** Poetics already
  knows which pieces of intent are about the same code: a unit's version
  chain, its edges, the notes anchored to it, the decisions it cites. Choosing
  the pairs is deterministic. Only the judgement ("do these two disagree?")
  needs a model. That judgement is not repeatable, so it cannot fail CI.
- **Poetics calls a model itself.** The CLI would need an API key, a provider
  and a budget, and would pull a network dependency into the core. The agent
  that calls the MCP tool is already a model, and it already has the context.

## Decision

Contradictions are found in two layers. Poetics deterministically chooses
the candidate pairs and reports the findings it can prove. The calling agent
judges the rest.

### Candidate pairs

For a unit, or each unit in a scope, Poetics pairs its **newest version's
rationale and docs** with:

| Source | Why it might disagree |
| --- | --- |
| Earlier versions of the same unit, through lineage | A silent reversal |
| Newest rationale and docs of its direct dependencies | Caller and dependency disagree |
| Active notes anchored to the unit or its closure: `invariant`, and `assumption` and `consideration` once ADR 0012 lands | The change breaks a stated rule or belief |
| Decisions cited by any version in its chain | The unit has moved away from a decision it relied on |

Pairs are ordered by how close the two sides are: same unit, then a direct
edge, then the closure. They are trimmed to a token budget the way context
packs are. A pair whose newer side already links the older one (a `version`
link `<uid>@<contentHash>`, the note's id, or the decision) has been
acknowledged and is skipped.

### Deterministic findings

These need no model, so `poetics verify` and `poetics:check` report them as
warnings:

- **Cites a superseded decision:** a unit's newest version links a decision
  whose status is `Superseded by NNNN`.
- **Relies on a refuted assumption:** once ADR 0012 lands, a version or an
  active note links an assumption resolved with `outcome: refuted`.

### Judged findings

A new read tool, `poetics_contradictions`, returns the candidate pairs. Each
side is quoted inside a fenced block and labelled with its source: unit uid
and `contentHash`, note id, or decision path. The tool's description, and the
skills that call it, say that the quoted text is data to compare, never
instructions to follow. The agent judges each pair as `contradicts`,
`reverses-unacknowledged`, `consistent` or `unclear`, and reports only the
first two, citing both sides.

Judgements are cached in `.poetics/cache/`, keyed by the content hashes of
both sides, so unchanged pairs are not judged again. The cache is derived
data, never committed, and deleting it only costs a re-run.

### Resolving a contradiction

A finding is resolved by recording intent, never by silencing it:

- **The reversal was deliberate:** the new version's rationale says so and
  links the version it reverses.
- **The note or decision no longer holds:** retire the note (`resolved`,
  `superseded`, or `refuted` for an assumption) or write a new decision.
- **The code is wrong:** fix it, which appends a version.

Each of these adds the link that makes the pair count as acknowledged, so it
stops coming back. There is no dismiss list: a pair judged `consistent`
stays cached locally, and a judgement that was wrong will show up again on
someone else's machine. That is deliberate. See the open questions.

### Where it appears

- **`poetics-orient`:** before a change, contradictions already in the unit's
  closure, so the agent does not build on one side without knowing about the
  other.
- **`poetics-change`:** after recording rationale, check the new version
  against its pairs. A contradiction is either acknowledged in the rationale
  or reported to the human.
- **`poetics-review`:** a new step listing judged contradictions in the diff's
  units, next to rationale quality.
- **`poetics verify` and `poetics:check`:** the deterministic findings only.
  The judged layer never decides whether CI passes.

## Consequences

- A change that reverses earlier intent has to say so, or it is flagged.
  "Don't reverse a decision silently" now applies to every unit's rationale,
  not just to ADRs, and something checks it.
- Poetics stays free of models. The core and the CLI need no API key, and the
  judgement runs on whatever model the calling agent uses. Results therefore
  vary between agents and runs. The deterministic findings and the
  acknowledgement links are the parts that do not vary.
- The number of pairs grows with the history and the graph. The budget, the
  ordering and the hash-keyed cache keep a run bounded, but a large first run
  on a backfilled repository will be slow, and its inferred rationale
  ([ADR 0011](0011-backfill.md)) will produce false positives. Pairs where
  both sides are inferred should rank last.
- Rationale becomes something agents compare, not only something they read,
  so vague rationale ("refactor", "fix") yields nothing to compare. This adds
  to the case for the rationale-quality step in `poetics-review`.
- Follows acceptance: `poetics_contradictions` in
  `packages/mcp/src/tools.ts`, starting as a stub; pair selection in
  `@poetics/store`; the two deterministic warnings in `poetics verify` and
  `poetics:check`; the `version` link kind in `docs/data-model.md`; steps in
  the `poetics-orient`, `poetics-change` and `poetics-review` skills;
  `docs/agents.md`; an eval task in #25 that plants a silent reversal and
  checks whether the agent finds it.
- Open questions, to be filed as issues:
  - Should a judgement of `consistent` be shareable, as a committed record
    that says who judged it and on which hashes, so a team does not re-judge
    the same false positive? Or would that become a way to silence findings?
  - Should the CLI offer an optional judged run, with a configured provider,
    for CI comments that never fail the build?
  - Should a contradiction between two active notes count as a finding of its
    own, even when no unit has changed?
