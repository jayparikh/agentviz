# Journal View — Eval Baselines

> Quality baselines for the Journal View feature.
> Updated by Evaluator after each milestone.
> Grading follows the SCORECARD.md rubric.

## Test Coverage

| Suite | Tests | Status |
|-------|-------|--------|
| journalExtractor.test.js | 18 | Pending first run |
| journalRoute.test.js | 10 | Pending first run |

## Extraction Quality Rubric

Grading the heuristic extractor against real session data.

### Steering Detection

| Signal | Expected | Grading |
|--------|----------|---------|
| "instead" / "switch to" | Detected as steering | Pass if ≥80% recall |
| "try again" / "wrong" | Detected as steering | Pass if ≥80% recall |
| First turn (initial prompt) | Never flagged as steering | Pass if 0% false positives |
| Short messages (<5 chars) | Ignored | Pass if 0% false positives |

### Error Recovery Arcs

| Signal | Expected | Grading |
|--------|----------|---------|
| Error turn followed by success | Mistake + Level-Up pair | Pass if both created |
| Error turn at end of session | Mistake only, no false level-up | Pass if no orphan level-up |
| Consecutive errors | One mistake per error turn | Pass if deduplicated |

### Milestone Detection

| Signal | Expected | Grading |
|--------|----------|---------|
| Session start/end | Always bookended | Pass if present in all sessions |
| Heavy tool turns (>2.5x avg) | Flagged as milestone | Pass if threshold reasonable |
| Test/build/deploy tools | Classified as milestone, not generic | Pass if tool pattern match works |

### Git History Classification

| Signal | Expected | Grading |
|--------|----------|---------|
| Version tags (v0.1.0) | Classified as release milestone | Pass if 100% recall |
| `feat:` commits | Classified as level-up | Pass if 100% recall |
| `fix:` commits | Classified as mistake | Pass if 100% recall |
| `refactor:` commits | Classified as pivot | Pass if 100% recall |
| 3+ consecutive refactors | Collapsed into one pivot arc | Pass if arc detected |

### Narrative Quality

| Dimension | Baseline | Grading |
|-----------|----------|---------|
| Level-Up text is meaningful (not generic) | Each type has distinct phrasing | Pass if 4+ distinct templates |
| Steering commands extracted from conventional commits | Prefix stripped, PR number stripped | Pass if clean text |
| Chronological ordering | All entries sorted ascending | Pass if no out-of-order |
| Deduplication | No same-type-same-turn duplicates | Pass if zero duplicates |

## Source Merge Quality

| Dimension | Baseline | Grading |
|-----------|----------|---------|
| Git entries have `source: "git"` | All git entries tagged | Pass if 100% |
| Session entries have `source: "session"` | All session entries tagged | Pass if 100% |
| Both sources visible in unified timeline | Mixed entries render correctly | Pass if no render errors |
| Session entries include seek-to-replay | Click navigates to Replay view | Manual verification |

## Visual Quality Spot-Checks

Following the ui-ux-style-guide.md standards:

- [ ] Uses JetBrains Mono throughout
- [ ] Theme tokens from `src/lib/theme.js` (no hardcoded colors outside ENTRY_COLORS)
- [ ] Dark and light mode render correctly
- [ ] Filter badges toggle correctly
- [ ] Detail panel updates on row click
- [ ] Resizable split panel works (drag handle)
- [ ] Source badges legible at small sizes
- [ ] Empty state renders when no data available

## Grading Scale

| Score | Meaning |
|-------|---------|
| All baselines pass | Feature is production-ready |
| 1-2 failures | Minor gaps — document and ship |
| 3+ failures | Block until addressed |

---

*Maintained by Evaluator. Update after changes to journalExtractor.js or JournalView.jsx.*
