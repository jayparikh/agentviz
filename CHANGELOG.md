# Changelog

All notable changes to AGENTVIZ are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Make the workflow the only shell while preserving `#/v2/...` links, preferences
  and v1 session-library/content schemas. Retire Classic, its recent-session
  dropdown, direct A/B upload screen and human-response/idle sort modes.
- Restore shared Timeline playback and keyboard shortcuts in Investigate/Analyze.
  Keep Q&A history and drafts across zones and failed loads; successful replacement
  or explicit Close aborts streams and clears transient state, not saved runs.
- Open newly exported comparisons directly in Compare and preserve offline
  single-session and A/B exports.

## [1.0.4] - 2026-09-06

### Fixed

- Preserve exact event identity when navigating from the command palette or
  Waterfall, and keep deep Replay targets anchored while measured rows settle.
  Manual scrolling cancels automatic correction. (#131)
- Share session-scoped playback and search across v2 zones. Session loading is
  transactional: failed imports preserve the previous session, superseded
  requests are ignored, and FileReader errors remain recoverable. (#131)
- Resume live streams at snapshot/SSE byte boundaries, handle reconnects and
  truncation resets, and keep growing sessions in a stable library entry. (#131)
- Preserve batch-parser parity for late tool results, cumulative usage,
  model/lifecycle changes, reordered records, and empty patched sessions,
  including the no-worker fallback. (#132)

### Changed

- Retain incremental normalization state for Claude Code, Copilot CLI, Codex,
  and VS Code base-plus-patch JSONL. Ordinary appends process only new or
  affected records, with indexed tool dependencies, usage, and turn membership.
  Global timestamp or structural changes still update affected history. (#132)
- Keep live normalization off the main thread with single-flight backpressure.
  Full immutable snapshot copying and worker serialization remain O(history);
  this is not a zero-history-processing pipeline. (#131, #132)
- Make discovery IO asynchronous with bounded format-specific previews,
  newest-first enrichment, and a bounded preview cache. Discovery still
  enumerates and stats candidates for correct ordering. (#131)
- Memoize Tracks geometry and cap overview groups at 200 per lane while keeping
  every original event accessible through paginated detail. Memoize Analyze
  summaries and avoid rebuilding Replay event streams on every tick. (#127,
  #129, #131)
- Improve dark/light text contrast, add persisted normal/comfortable reading
  density, stack compact Replay inspectors, and support keyboard/pointer
  resizing plus keyboard/touch evidence navigation in Graph and Tracks.
  Empty Find prioritizes importing real sessions. (#131)
- Update dependencies and add restricted, provenance-enabled npm publishing
  through GitHub Actions. (#111, #125, #126, #130)

### Tests

- Validate incremental work counts after 100 versus 10,000 historical items,
  late historic results, parser partition parity, and real HTTP/worker streams.
  The release baseline passes 1,027 tests across 66 files and 28 browser tests,
  including Chromium/WebKit portable exports. (#131, #132)

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
