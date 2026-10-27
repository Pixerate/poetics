# Benchmark tasks

Each task is a Markdown file with front matter, run by an agent against a
fixture with and without Poetics. The harness (`@poetics/evals`, phase 1)
compares task success, tokens used, and whether lineage and rationale survive.
Every skill and tool-description change is gated on these once the harness
exists.

Front matter fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable task id. |
| `fixture` | Folder under `evals/fixtures/`. |
| `kind` | `feature`, `refactor` or `regression`. |
| `success` | Checks the harness runs to decide pass or fail. |
| `poetics` | What the store must show afterwards. |
