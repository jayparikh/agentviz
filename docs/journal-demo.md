# 📖 Journal View — Demo Guide

> **What you're tasting:** A new view that tells the *story* of a repo's evolution,
> not just the data. While Replay/Tracks/Waterfall/Graph/Stats show *what happened*,
> Journal shows *why it happened* — steering moments, level-ups, and pivots.

---

## Quick Start

```bash
cd agentviz
git checkout feature/journal-view
npm install && npm run dev
# → opens http://localhost:3000
```

## What You Should See

### 1. Click the **Journal** tab (📖 icon, between Stats and Coach)

You'll see agentviz's own git history rendered as a **Scribe-style timeline table**:

| Time | Type | Steering Command | Level-Up 🆙 |
|------|------|------------------|-------------|
| Mar 23, 15:23 | 🆙 Feature | add Graph view with interactive DAG visualization | New capability unlocked |
| Mar 25, 15:31 | 🆙 Feature | inbox auto-discovery + AI Coach agent | New capability unlocked |
| Mar 29, 23:00 | 🔄 Refactor | 4-phase refactoring initiative | Architecture leveled up through disciplined multi-phase refactoring |
| Mar 29, 22:30 | ✅ Release | v0.1.1 | Shipped v0.1.1 — a versioned milestone |
| Mar 30, 00:31 | ✅ Release | Release v0.2.0 | Shipped v0.2.0 |
| Mar 30, 21:50 | ✅ Release | v0.3.0: multi-agent visualization with fork/join DAG | Shipped v0.3.0 |

### 2. The summary header shows repo vitals

`📖 agentviz · 35 moments · ✅ 4 releases · 🆙 11 features · ❌ 18 fixes · 9 contributors`

### 3. Use the **filter badges** to focus

- Click `✅ Release` to see only version milestones
- Click `🆙 Feature` to see only capability unlocks
- Click `🔄 Refactor` to see architecture pivots
- Click `❌ Fix` to see the honest failure/recovery story

### 4. Click any row to see the **detail panel**

Shows:
- The steering command (what was decided)
- What happened (the full commit message)
- Level-Up 🆙 (the insight or capability gain)
- Commit hash and author

---

## What Makes This High Taste

1. **Narrative, not data.** Other views show events, timing, graphs. Journal tells the *story*.
2. **Scribe format.** Uses the `| Time | Steering | What Happened | Level-Up 🆙 |` table
   from snap-squad's Scribe charter — the same format used to document builds.
3. **Smart arc detection.** Consecutive refactoring commits collapse into a single
   "4-phase refactoring initiative" pivot entry instead of noise.
4. **Zero dependencies.** No API key, no AI model — pure git history analysis. Works offline.
5. **Any repo.** Run agentviz from any git repo and the Journal shows *that* repo's story.

---

## Architecture (2 files)

```
routes/journal.js          — GET /api/journal/git (server-side git log analysis)
src/components/JournalView.jsx — React view (Scribe-style timeline table)
src/lib/journalExtractor.js    — Session-level heuristic extractor (secondary)
```

The backend runs `git log`, classifies commits using conventional-commit patterns,
synthesizes level-up narratives, and collapses refactoring arcs.
The frontend fetches on mount and renders the timeline.
