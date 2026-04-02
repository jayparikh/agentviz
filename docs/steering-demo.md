# Steering View — Demo Guide

> The Steering view analyzes which human prompts actually changed the direction
> of an AI coding session. It pairs each steering command with the git commits
> and code changes it produced, then runs an agent-assisted analysis to surface
> what happened, what was learned, and the impact.

---

## Quick Start

```bash
cd agentviz
git checkout feature/steering-view
npm install && npm run dev
```

Then start a coding session in another terminal. For example with Copilot:

```bash
copilot "add a /healthcheck endpoint that returns uptime and version"
```

Or with Claude Code:

```bash
claude "refactor the config loading to use environment variables instead of hardcoded values"
```

Work with the agent for a few turns. Redirect it at least once — that's the
steering the view captures. For example:

```
> "that's too verbose, simplify it to just return JSON"
> "don't use console.log, use the existing logger"
```

Then open agentviz, load the session file, and click the Steering tab (last
tab, after Coach). The more you redirect the agent, the richer the timeline.

---

## What You Should See

### 1. Timeline table

Each row is either a human steering command or a git commit:

- Steering commands appear in italic quotes with bright text
- Git commits appear in plain text with a blue commit hash
- Columns: Time, Type, Steering Command, What Happened, Level-Up, Impact

### 2. Background analysis

On mount, the view runs an agent-assisted analysis in the background using the
Copilot SDK (same SDK as Coach, no extra setup). You'll see a pulsing indicator
near the Impact column while analysis is in progress. When complete, the
What Happened, Level-Up, and Impact columns update with richer content than
the static heuristics produce alone.

The analysis retries up to 2 times with backoff if the SDK call fails.

### 3. Filter badges

Click the type badges at the top to filter:
- Steering — human redirections only
- Release — version milestones
- Feature — capability additions
- Fix / Refactor — corrections and restructuring

### 4. Detail panel

Click any row to see:
- The full steering command
- What happened (agent response summary)
- Level-Up (what was learned or unlocked)
- Responding To — what the agent said that prompted the user's steering
- Files changed — list of files affected
- Jump to this moment in Replay — seeks to the event and switches to Replay view

### 5. Steering intelligence panel

Below the timeline, an expandable panel shows session-level analysis:

- Density score — steering commands per hour. High density suggests the agent
  isn't matching your taste; low density suggests alignment.
- Category breakdown — how many steerings were about quality, tone, bugs,
  naming, testing, visual design, or simplification.
- Insights — actionable observations like "Quality was redirected 4 times,
  consider adding a quality-focused skill" or "Simplification corrections
  suggest the agent over-engineers by default."

---

## Two Data Sources

1. Git history (always available) — the repo's commit timeline, classified by
   conventional commit prefix (feat, fix, refactor, chore, release tags).
   Consecutive refactoring commits collapse into one pivot arc.

2. Session events (requires a loaded session) — user messages detected as
   steering by pattern matching (redirections like "instead", "try again",
   "don't", "switch to"). Minimum 15 characters to filter noise.

---

## What Makes This High Taste

1. Narrative, not data. Other views show events, timing, graphs. Steering tells the story.
2. Dual-source truth. Git shows what changed. Session shows why. Both in one timeline.
3. Agent-assisted analysis. Background analysis improves results beyond static heuristics.
4. Honest visual separation. Real human prompts are italic. Commit summaries are plain text.
5. Smart arc detection. Consecutive refactoring commits collapse into one pivot entry.
6. Actionable intelligence. Density scoring and category analysis suggest concrete improvements.

