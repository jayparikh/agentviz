# Decisions — The Default Squad

> Significant decisions made during development. Check before starting work.

## Active Decisions

### D-001: Squad initialized with The Default Squad preset
- **By:** snap-squad
- **Date:** 2026-04-01
- **Context:** Project initialized using snap-squad warm-start
- **Decision:** Using the "default" preset (friendly vibe, Community Builders theme)

### D-002: Heuristic-first extraction over AI-powered analysis for Journal View
- **By:** Architect, Coder
- **Date:** 2025-07-21
- **Context:** The Journal View needs to extract narrative moments (pivots, milestones, mistakes, level-ups) from AI session data. Two approaches were viable: (1) use the existing AI Coach pattern (SSE + Copilot SDK) to have an LLM generate the narrative, or (2) build heuristic-based extraction that pattern-matches on session structure without any API calls.
- **Decision:** Heuristic-first. No API key required for the feature to work, value is demonstrated immediately on load, and AI-powered narrative can be layered on top later as an enhancement.
- **Trade-off:** Less sophisticated narrative quality vs. zero-dependency simplicity. A heuristic can't "understand" context the way an LLM can, but it runs instantly, works offline, and keeps the barrier to contribution low for an open-source project.

### D-003: Journal View positioned between Stats and Coach in tab order
- **By:** Architect
- **Date:** 2025-07-21
- **Context:** agentviz has 6 views in order: Replay → Tracks → Waterfall → Graph → Stats → Coach. The Journal View needed a home in this sequence.
- **Decision:** Journal sits after Stats and before Coach (position index 6, pushing Coach to 7). It bridges the gap between raw data views (what happened) and AI analysis (what it means). Stats is the last "data" view; Journal is the first "narrative" view; Coach is the interactive AI layer.
- **Trade-off:** Could have placed Journal first (as the "summary" entry point) but decided users should see raw data before narrative interpretation — earn trust with transparency before offering synthesis.
