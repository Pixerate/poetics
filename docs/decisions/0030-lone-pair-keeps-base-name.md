# 0030. A lone pair that keeps its base name matches at any similarity

- Status: Accepted (2026-11-26)
- Date: 2026-11-26
- Refines: [ADR 0028](0028-lone-pair-in-a-file.md)

## Context

ADR 0028 pairs a file's lone leftover tracked unit and new unit when their
similarity is at least 0.2. Its Swift evidence was a stand-in: every pair of
functions in one Alamofire file, as if one had been deleted and the other
written. About a third of those pairs scored 0.2 or more, and no floor kept
renamed units while rejecting them. We looked for a stricter guard against that
stand-in:

| Guard | Rename-edits kept | Unrelated same-file pairs it would pair |
| --- | --- | --- |
| Similarity, floor 0.3 | 91% | 27% |
| Rare subtrees weighted more, floor 0.2 | 92% | 28% |
| Overlap measured against the smaller unit, floor 0.3 | 96% | 33% |
| Same signature apart from the name | 67% | 32% |

None separates the two groups, because sibling Swift functions really are
alike. But siblings are not what the stage meets. So we went to real history:
every non-merge commit of Alamofire (1,530) and of IceCubesApp (1,500),
indexing each modified Swift file before and after and running matching with
the floor at 0. That found 90 lone pairs. We judged each one from its names
and commit message, not by reading every diff.

| Similarity | Lone pairs | Same unit | Different unit | Unclear |
| --- | --- | --- | --- | --- |
| 0.2 or more | 63 | about 61 | about 2 | 0 |
| Below 0.2 | 27 | about 17 | about 7 | 3 |

- At 0.2 or more the stage is nearly always right. Most of these pairs are
  signature changes: a Swift name includes its argument labels, so adding a
  parameter renames the function, as in `init(timeline:scrollToTopSignal:)` to
  `init(timeline:scrollToTopSignal:canFilterTimeline:)`. The two doubtful
  ones are a rewritten test method in a renamed test class (0.455) and a
  notification hook replaced by another (0.421).
- Below 0.2 most pairs are still the same unit, and the base name (the name
  before the labels) tells them apart. All 11 that keep their base name are
  the same unit, for example `ExploreView.init()` to
  `ExploreView.init(scrollToTopSignal:)` at 0.0, `playSound(of:)` to
  `playSound(_:)` at 0.078, and `Session.didCompleteTask(_:)` to
  `Session.didCompleteTask(_:completion:)` at 0.1. Every pair that is clearly
  a different unit changed its base name: `viewDidLoad()` to
  `tableView(_:didSelectRowAt:)`, `setUp()` to a test method.

A small unit with a new parameter scores low because its fingerprint barely
exists: `init()` with two entries shares nothing with `init(scrollToTopSignal:)`.

Options considered:

- **A stricter floor or another measure in Swift.** It would lose real
  signature changes to avoid about 2 wrong pairs in 63, which the
  `lone-match` warning already shows a reviewer (ADR 0029).
- **Pair a lone pair at any similarity when it keeps its base name.** It
  recovers the 11 with no wrong pair in the sample.
- **Ask adapters for a name without labels.** Every adapter would need a new
  field, for a rule only Swift's naming needs.

## Decision

**In stage 6, a lone pair that keeps its base name matches whatever its
similarity.**

- A unit's base name is its name up to the first `(`, or the whole name if it
  has none. It includes the owner's path, so `A.init()` and `B.init(x:)` do
  not share one.
- Everything else about the stage is unchanged: one unit left on each side,
  in one file and namespace, after every earlier stage. The match is still
  `via: "lone"`, with its score, and still raises `lone-match` in review.
- Names without labels gain nothing: a pair with the same whole name in one
  file is matched by place in stage 2.

## Consequences

- Giving a small Swift function, initializer or subscript a new parameter,
  or changing a label, keeps its uid however much its body changed.
- When overloads are folded into one in a single commit, the one overload
  left unmatched pairs with the result, as
  `append(_:withName:mimeType:)` to `append(_:withName:)` did when Alamofire
  condensed three into one. The others are removed, as before.
- Rewriting a function completely while keeping its base name, in a file
  where it is the only change of its kind, carries the old history across.
  That is usually the right story, and `lone-match` puts it in front of a
  reviewer.
- The sample is two repositories and 27 pairs below 0.2. The real-history
  scan is the measurement to repeat if this needs revisiting; it does not
  live in the repository yet.
