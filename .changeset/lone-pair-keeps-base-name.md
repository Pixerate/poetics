---
"@poetics/core": patch
---

A file's lone leftover pair now matches at any similarity when it keeps its base name, the name before any argument labels (ADR 0030). Giving a small Swift function or initializer a new parameter, or changing a label, no longer loses its uid: `ExploreView.init()` becoming `ExploreView.init(scrollToTopSignal:)` keeps its history.
