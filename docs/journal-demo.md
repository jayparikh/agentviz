# 📖 Steering View — Demo Guide

> **What you're tasting:** A new view that tells the *story* of a repo's evolution,
> not just the data. While Replay/Tracks/Waterfall/Graph/Stats show *what happened*,
> Journal shows *why it happened* — steering moments, level-ups, and pivots.

---

## Two Data Sources

The Journal draws from two sources:

1. **Git history** (always available) — shows the repo's evolution: releases,
   features, refactoring arcs, bug fixes. This data appears automatically
   when you run agentviz from any git repo.

2. **Session steering** (requires a loaded session) — shows the actual human
   prompts that redirected the AI, in *italic quotes*. These only appear
   when you load a session that contains steering moments — user messages
   with redirections like "instead", "try again", "don't", "switch to", etc.

**To see steering in action:** Run an AI coding session with real back-and-forth
(redirect the agent, correct mistakes, change approaches), then load that
session in agentviz and click Steering. The richer your steering, the richer
the Journal.

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
| Mar 30, 21:50 | ✅ Release | v0.3.0: multi-agent visualization with fork/join DAG | Shipped v0.3.0 |

### 2. Load a session with steering to see the full picture

If your session includes user redirections, you'll see them interleaved:

| Time | Type | Steering Command | Level-Up 🆙 |
|------|------|------------------|-------------|
| ... | 🎯 Steering `session` | *"I don't see the key evolutionary moments from the REPO itself"* | Pivoted to repo-level narrative |
| ... | 🆙 Feature `git` | git-powered Journal — repo evolution as Scribe-style timeline | New capability unlocked |

Git entries are plain text. Session steering entries are *"quoted and italic"*.

### 3. The summary header shows both sources

`📖 agentviz · 43 moments · 39 git · 4 session · ✅ 4 releases · 🆙 11 features`

### 4. Use the **filter badges** to focus

- Click `🎯 Steering` to see only human redirections
- Click `✅ Release` to see only version milestones
- Click `🆙 Level-Up` to see only capability unlocks

### 5. Click any row to see the **detail panel**

Shows:
- The steering command (what was decided)
- What happened (the full commit message or user prompt)
- Level-Up 🆙 (the specific insight or capability gain)
- For session entries: **"Jump to this moment in Replay"** button

---

## What Makes This High Taste

1. **Narrative, not data.** Other views show events, timing, graphs. Journal tells the *story*.
2. **Dual-source truth.** Git shows what changed. Session shows why. Both in one timeline.
3. **Honest visual separation.** Real human prompts are *"quoted and italic"*. Commit summaries are plain.
4. **Smart arc detection.** Consecutive refactoring commits collapse into one pivot entry.
5. **Zero dependencies.** No API key, no AI model — works offline, any repo.
6. **Gets richer as you work.** The more you steer, the more the Journal captures.

