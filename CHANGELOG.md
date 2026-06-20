# Changelog

All notable changes to AGENTVIZ are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-06-19

### Fixed

- Fixed parser regressions in VS Code Copilot Chat, Copilot CLI, Claude Code,
  Codex, and ATIF sessions that could corrupt turn linkage, omit tool calls, or
  under-report session duration.
- Fixed replay turn headers when filtered tracks hide the original turn-start
  event.
- Fixed waterfall concurrency accounting for zero-duration and back-to-back tool
  calls.
- Fixed autonomy idle-gap detection for overlapping long-running events.

### Tests

- Added regression coverage for parser turn invariants, tool output mapping,
  metadata duration, waterfall stats, replay headers, and autonomy metrics.

## [1.0.1] - 2026-06-18

### Fixed

- **Diff viewer dropped a context line after every edit.** The Myers diff
  backtracking guards offset the wrong axis when replaying a snake (the run of
  matching lines that precedes an edit), so the single equal line immediately
  following each insertion or deletion was silently omitted from rendered diffs.
  Both sides of every hunk now reconstruct exactly. (#112)

### Tests

- Added regression coverage for context survival after deletions, insertions,
  and mid-file edits, plus full both-side reconstruction across multiple edit
  shapes.

## [1.0.0] and earlier

Earlier releases are recorded as git tags (`v0.1.1` through `v1.0.0`).
