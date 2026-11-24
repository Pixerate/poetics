---
"@poetics/core": patch
---

Units that resemble several others after being edited as their file moved now pair by a name each side has once, when that pair is itself above the similarity threshold, instead of all being queued. Moving Alamofire's `Combine.swift` in the same commit that renamed a method its three publisher types call no longer queues them.
