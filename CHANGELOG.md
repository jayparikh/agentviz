# Changelog

All notable changes to AGENTVIZ are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
