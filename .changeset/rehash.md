---
"@poetics/core": minor
"@poetics/store": minor
"@poetics/cli": minor
---

Add the rehash (ADR 0014). A new `rehash` change class re-records unchanged code under the indexer's `b3:` hash. `poetics rehash` plans and appends those versions, and `poetics hash` prints a file's unit hashes for hand-written versions. `poetics verify` and `poetics coverage` now compare `b3:` hashes instead of reporting them as unverifiable. `allowProvisionalHashes: false` now applies to each live unit's latest version only, and a note anchored to a unit stays confirmed through a rehash.
