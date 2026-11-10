# 0017. Rationale is drafted by a command the repository configures

- Status: Proposed
- Date: 2026-11-10

## Context

ADR 0011 gives `poetics backfill` an optional `--draft` step: a model reads a
version's evidence and drafts its rationale. It left open how Poetics calls
the model. Poetics has to stay model- and provider-agnostic: teams use
different providers, local models, or none, and a vendor SDK in
`@poetics/cli` would choose for them, pull in its dependencies, and tie the
drafting rules to one API.

Options considered:

- **A vendor SDK.** One provider, its credentials and its upgrades in every
  install, whether or not anyone drafts.
- **An OpenAI-compatible HTTP endpoint.** Still one API shape, and it leaves
  local tools and agent CLIs that do not speak it out.
- **A command speaking JSON on stdin and stdout.** Anything can sit behind
  it: a script around any provider's API, a local model, an agent CLI. It is
  the shape ADR 0008 already uses for out-of-process adapters.

## Decision

`--draft` runs the command in `backfill.draft.command` in
`.poetics/config.json`: an argv array, run without a shell from the
repository root, with an optional `timeoutSeconds` (default 120). Poetics
names no model or provider anywhere.

For each version, the command receives one **draft request** on stdin:
`protocol` (1), `instructions`, the `unit` (name, kind, file), the `change`
class, the `commit`, the unit's `code` and its `previous` code, the
`evidence` (each with an `id`, `source`, `ref` and `text`), and `doNotQuote`,
the ids of evidence that may be read but not quoted. It writes one **draft**
on stdout: `{"rationale": string, "cites": string[], "diffOnly": boolean}`.

Poetics checks every draft before using it, and keeps the extracted rationale
when a check fails or the command fails, times out or writes no JSON:

- `cites` names only evidence it was given;
- `diffOnly` is true exactly when nothing is cited, and such a draft lowers
  the version's confidence to `low`; otherwise confidence stays what the
  evidence gave, since a draft never raises it;
- the rationale shares no run of eight or more words with evidence in
  `doNotQuote`.

Pull request and review text is in the request only for a public repository
(as the tracker reports it) or with `--draft-private`, and is always in
`doNotQuote`, as ADR 0011 requires. Drafted versions have
`inferred.drafted: true`. Answers are cached in `.poetics/cache/drafts.json`
by command and request, so a dry run and the `--write` after it run the
command once per version.

## Consequences

- Poetics ships no model client and no provider dependency; drafting costs
  nothing until a repository configures a command.
- A repository's drafting command, and the credentials it needs, are its own.
  Code and evidence go wherever that command sends them, so choosing one is a
  data-handling decision for the team.
- The request format is versioned (`protocol`), so a drafter can refuse a
  format it does not know and the format can change without breaking it
  silently.
- Prehistory is write-once, so a drafted walk leaves prehistory recorded
  without drafts alone and counts it; draft before writing to get drafts.
