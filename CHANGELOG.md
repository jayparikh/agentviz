# Changelog

All notable changes to AGENTVIZ are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Rejected cross-site requests to the local API. Any website the user visited
  could previously `POST` to `/api/apply` and write arbitrary files under the
  project directory (for example `.git/hooks/pre-commit`), which is remote code
  execution the next time the developer ran git or a build. Requests that carry
  a foreign `Origin`/`Sec-Fetch-Site`, or a body that is not `application/json`,
  are now refused before any route runs.
- Rejected requests whose `Host` header is not a loopback name. Without this, an
  attacker domain that resolves to `127.0.0.1` (DNS rebinding) was treated as
  same-origin by the browser and could read `/api/sessions`, `/api/session`,
  `/api/file`, and `/api/read-file` -- that is, every AI session transcript on
  the machine.

## [1.0.3] - 2026-08-11

### Fixed

- Fixed shared HTML exports that only opened on the machine that produced them.
  Exports no longer use an import map keyed by `http://127.0.0.1:<port>` URLs or
  `data:` URL modules (which WebKit refuses to evaluate); every chunk is now
  embedded as source and instantiated from a `blob:` URL at boot.
- Exported files now answer every `/api/*` route locally, so session discovery,
  config, and Coach requests return an explicit "Not available in exported view"
  response instead of throwing `URL scheme "file" is not supported`.
- Exported files no longer request a webfont from Google Fonts and now carry the
  theme bootstrap tokens from `index.html`, so they render correctly offline in
  both dark and light mode.

### Added

- Boot-failure fallback in exported files: a readable message with browser
  compatibility hints replaces the previous blank page.
- Export generation aborts loudly if the produced bundle still references the
  exporting server's origin.
- `npm run test:e2e:export` plus a `webkit-export` Playwright project that open a
  real export from `file://` with the network blocked.

### Changed

- Exported HTML is gzip-compressed, cutting a typical shared file from about
  3.7 MB to under 900 KB.
- Added cross-format filtering for user-authored input.
- Displayed explicit Copilot CLI reasoning-effort metadata in session details
  and selected events.
- Standardized filter chips and metric labels across views.
- Fixed Codex reasoning-token double-counting.

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
