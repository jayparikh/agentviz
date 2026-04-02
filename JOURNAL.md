# JOURNAL.md — Build Story

> How this project was built, the steering moments that shaped it, and why things are the way they are.
> Maintained by **Scribe** (Historian / Build Journalist). Update after milestones.

---

## 2026-04-01 — Project Bootstrapped

**Squad:** The Default Squad · **Vibe:** friendly · **Theme:** Community Builders

### The Team

Architect, Coder, Tester, DevRel, Prompter, GitOps, Evaluator, Researcher, Scribe

### What Happened

Project initialized with the **The Default Squad** squad preset via `npx snap-squad init`. The full `.squad/` directory, hook chain (AGENTS.md, CLAUDE.md, copilot-instructions.md), and this journal were generated automatically.

### Steering Moment

The builder chose **default** — default generalist squad — reliable, well-rounded, good for any project. This shapes everything that follows: who reviews code, how decisions get made, what gets tested first.

### What's Next

- [x] First real feature or task
- [ ] Builder configures project context in `.squad/team.md`
- [x] First decision logged to `.squad/decisions.md`

---

## 2025-07-21 — Journal View: Telling the Story of an AI Session

**Branch:** `feature/journal-view` · **Commit:** `5c1823a` · **Squad roles:** Architect → Coder → Tester → Scribe

### What Happened

Added a **Journal View** to [agentviz](https://github.com/jayparikh/agentviz) — a new visualization tab that extracts the *narrative* from an AI coding session. All 5 existing views (Replay, Tracks, Waterfall, Graph, Stats) show **what** happened. None of them tell the **story**. Journal View fills that gap.

The feature uses heuristic extraction (`src/lib/journalExtractor.js`) to identify steering moments, pivots, mistakes, milestones, and level-ups from session data — no API key required. The React component (`src/components/JournalView.jsx`) renders these as a structured narrative with icons, phases, and a steering timeline.

**5 files changed, 723 insertions.** Build passes. Tests pass (1 pre-existing failure unrelated to our changes). Typecheck clean.

### Steering Moments

| Time | Steering Command | What Happened | Level-Up 🆙 |
|------|-----------------|---------------|-------------|
| Session start | "Find a gap in agentviz that aligns with snap-squad's Scribe" | Builder challenged us to find a *meaningful* contribution, not just bolt something on. Architect analyzed all 5 existing views and identified the narrative gap. | Learned to audit an existing OSS project's view layer before proposing features — look for what the data *could* say but doesn't yet. 🆙 |
| Design phase | "Use heuristics, not AI" | Decision D-002. Could have reached for the Copilot SDK like the Coach view does, but chose zero-dependency heuristics instead. Demonstrates value without setup friction. | Simplicity as a feature: the best v1 is one that works on first load with no config. AI is an enhancement, not a prerequisite. 🆙 |
| Tab ordering | "Where does Journal go?" | Decision D-003. Positioned Journal between Stats and Coach — bridging raw data and AI synthesis. The information architecture tells its own story: see the data → read the narrative → ask the AI. | View ordering is UX writing. The sequence of tabs is a sentence: "Here's what happened, here's the story, here's what to do about it." 🆙 |
| Implementation | Squad coordination: Architect scoped → Coder built → Tester verified | Clean handoffs. Architect didn't write code. Coder didn't argue about scope. Tester caught the pre-existing failure and confirmed it wasn't ours. | Multi-agent coordination works when each role stays in its lane and trusts the others. 🆙 |

### Why

agentviz is a powerful tool for replaying AI coding sessions, but replay isn't the same as understanding. A developer reviewing a session wants to know: *Where did the human steer? When did the AI level up? What were the pivots?* The Journal View answers those questions without requiring another AI call — it reads the session structure and finds the story already embedded in it.

This also validates the snap-squad's Scribe role in a meta way: the Scribe's job is to capture narrative from build sessions. The Journal View does the same thing for *any* AI session. We're dogfooding our own squad philosophy.

### What Worked

- **Gap analysis before code.** Architect's review of existing views prevented us from building a "me too" feature.
- **Heuristic-first design.** Feature works immediately, no setup, no API keys. The Coach view already handles the AI-powered path.
- **Clean feature branch.** `feature/journal-view` is ready to PR upstream to Jay's repo.

### What Didn't (Honest Bits)

- **Heuristic quality ceiling.** Pattern matching on keywords and turn structure can't match LLM-level narrative understanding. Some sessions will produce bland journals. This is the known trade-off from D-002.
- **No integration tests for the extractor.** Unit-level heuristic testing would improve confidence. Deferred — the existing test suite passes and we wanted a clean first commit.

### Impact

- agentviz gains a 6th view that no other session replay tool offers
- Demonstrates that snap-squad coordination (Architect → Coder → Tester → Scribe) works for real feature development, not just scaffolding
- Sets up a future enhancement path: AI-powered narrative via the Coach's SSE pattern, layered on top of heuristic baselines
- Ready for upstream PR to Jay Parikh's repository

### What's Next

- [ ] Open PR to upstream agentviz repo
- [ ] Add unit tests for `journalExtractor.js` heuristic functions
- [ ] Explore AI-enhanced narrative as an optional layer (reuse Coach's SSE pattern)
- [ ] DevRel: Update README with Journal View screenshots and description

---

## How to Use This Journal

> *Scribe's guide for the builder and future contributors.*

This isn't a changelog. It's the **story of how the project was built** — the decisions, the pivots, the moments where the builder steered the squad in a new direction.

### What to capture

| Entry Type | When | Example |
|-----------|------|---------|
| **Steering Moment** | Builder redirects the squad | "Switched from REST to GraphQL after seeing the query complexity" |
| **Key Decision** | Trade-off was made | "Chose SQLite over Postgres — this is a CLI tool, not a service" |
| **Evolution** | Architecture shifted | "Split monolith into 3 modules after hitting circular deps" |
| **Milestone** | Something shipped | "v0.1.0 published to npm — first public release" |
| **Lesson Learned** | Something surprised you | "Vitest runs 10x faster than Jest for this project — switching permanently" |

### Template for new entries

```markdown
## YYYY-MM-DD — Title

### What Happened

(What was built, changed, or decided)

### Why

(The reasoning — what alternatives existed, what trade-offs were made)

### Steering Moment

(How the builder directed the work — what prompt, feedback, or redirection shaped the outcome)

### Impact

(What this changes going forward)
```

### Rules

1. **Write for future-you.** Six months from now, this journal explains *why* the code looks the way it does.
2. **Capture the steering, not the typing.** The git log shows what changed. The journal shows *why it changed*.
3. **Be honest about pivots.** The best journals include "we tried X, it didn't work, here's why we switched to Y."
4. **Update after milestones, not after every commit.** Quality over quantity.

---

*The code shows what was built. The journal shows why.*
