---
"@poetics/cli": minor
---

`poetics backfill --history [<from>] [<to>]` walks only the first-parent commits after `<from>` up to `<to>`. Code that exists at `<from>` opens its prehistory at its first change in the range, so a later walk from further back extends it. Units recorded after `<to>` are reported rather than given a prehistory that stops short.
