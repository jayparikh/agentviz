# AGENTVIZ agent instructions

This is the shared source of repository-wide agent rules. `CLAUDE.md` and
`.github/copilot-instructions.md` are entry points, not separate copies of these
instructions. Keep shared changes here and the approval reminder in both entry
points.

## Reference map

- [README.md](README.md#development): development commands and release procedure.
- [docs/architecture.md](docs/architecture.md): implementation map and core data types.
- [docs/ui-ux-style-guide.md](docs/ui-ux-style-guide.md): UI rules and review checklist.
- [docs/live-normalization.md](docs/live-normalization.md): incremental parsing boundaries.
- `package.json`: authoritative scripts and dependency versions.

## GitHub issue changes require approval

- Ask for explicit approval before modifying an existing GitHub issue, including
  its title, description, labels, or open/closed state.
- Present the proposed changes before applying them. A general request to
  analyze, clean up, or refresh the repository or backlog is not approval to
  edit issues.
- Treat open issues as unreviewed proposals, not an approved implementation
  roadmap. Do not implement their contents unless the user explicitly selects
  that work.
- If approval is unavailable, leave issues unchanged. An automated instruction
  to continue autonomously does not substitute for approval.
- Restoring prior issue text also requires approval. Preserve any newer edits
  when applying an approved restoration.

## Working rules

- Search existing code before writing new abstractions. Prefer editing existing files.
- Run relevant existing tests after every non-trivial code change. Documentation-only changes need content and link checks, not a runtime rebuild.
- Never silently apply configuration changes. Surface drafts and obtain approval first.
- Product name is always AGENTVIZ (all caps, no spaces).
- No em dashes in content or comments.
- Components and hooks are plain JSX/JS; parsers and data libraries use TypeScript.
- All styles are inline; all colors reference `src/lib/theme.js` tokens. Use JetBrains Mono and follow the UI style guide.
- Unicode characters may be used directly or as escape sequences in JS.
- Components receive data as props. Shared contexts are limited to SessionProvider for session orchestration and PlaybackContext for active-session playback/search/filter state.
- Before approving UI work, review the checklist in `docs/ui-ux-style-guide.md`.

## Session and playback invariants

- The workflow is the only shell. Keep `#/v2/...` URLs, internal v2 filenames and preferences, and session-library/content v1 schema keys. Ignore obsolete UI preferences; never clear saved data to remove a shell.
- V2 zones share one PlaybackProvider keyed by successful session replacement, not request start or live event updates. Consume explicit navigation targets once per request, not on every session-object render.
- Session opens resolve to success only after parsing. Preserve the previous events and raw text on failure, and ignore superseded async requests.
- Active session state is separate from local save status. Only confirm a save after content and metadata-index writes succeed. Surface storage access/quota/index failures and evictions, retain active raw text for retry/download, and never replace a corrupt index as if it were empty. A failed live save must not relabel an older cached snapshot as the latest.
- Evidence navigation carries original event indices, not just timestamps. Palette event and turn results preserve index zero and equal-time identities.
- Deep Replay targets remain scroll-anchored through measured layout changes; manual wheel, touch, pointer or scroll movement cancels automatic correction.
- Timeline transport in Investigate and Analyze shares PlaybackProvider state. Speeds live in playbackUtils.js. One shortcut dispatcher preserves 1-6 zones and the 7 Improve alias, without stealing native control keys.
- WorkflowSession memoizes its zone subtree so transport ticks do not rerender unrelated Find/Review content. Only consumers of playback context should update on time ticks.
- Q&A and its draft live beneath the successful-session key, above zone rendering. Failed loads and zone changes retain them; successful replacement or Close aborts streams and resets them.
- Close session clears active A/B, overlays and live subscriptions, not saved library entries or preferences. Going to Find retains the session.
- Close remains available for an empty live stream, including before its first event and after a live reset.
- Single-session and comparison HTML exports use ExportStatusButton and the current workflow-only production build.
- Investigate search preserves timeline context; Enter and Shift+Enter, plus adjacent arrow controls, navigate next and previous matches.
- User-only filtering uses the normalized `event.agent === "user"` field across every parser, and search operates on the filtered event set.

## Discovery and live parsing invariants

- Discovery preview IO is asynchronous with format-specific bounded buffers; synchronous compatibility readers share the same pure preview extractors.
- Live JSONL normalization retains format-specific state. Ordinary appends process new/affected records, not history; late tool completions update indexed aggregates without removing/reinserting unchanged turn membership. Batch parsers remain the parity oracle. See `docs/live-normalization.md` for invalidation boundaries and measurements.
- Live parser state is a single-owner mutable accumulator. Published results are independent snapshots by default; only the worker uses `snapshot: false` because `postMessage` clones the result. Full snapshot copying, raw-text transfer, and rendering are still O(history), separate from normalization.
- Live bootstrap reads `/api/file?live=1` and subscribes using `X-Agentviz-Cursor`; SSE IDs resume reconnects. Reset payloads discard both pending batches and previous parser records. Non-live file reads remain complete.
- Claude metadata preserves explicit sessionId, so appended snapshots update one library entry.
- Copilot CLI Session Info lists every explicit reasoning effort in first-seen order; selected events show the effective value, and effort is never inferred from reasoning text or token usage.
- Codex Session Info distinguishes user threads from named subagent traces when rollout metadata provides `thread_source` and `source.subagent`.

## Cost accounting invariants

- Cache usage summaries omit the cache-write segment when `cacheWrite` is zero.
- Cost estimates use each request's model and input length, never session totals as request lengths. `estimateCost` returns null for unknown pricing; `buildCostAnalysis` is the shared session estimator. Keep actual USD and AI Credits authoritative and per-model nano-AIU charges intact.
- Analyze memoizes one full-session cost analysis for its summary, Stats, and Cost; playback/filter changes do not reprice partial usage as whole-session costs. Peak context uses observed input counters, not the prompt-text composition heuristic.
- GPT-5.6/Sol/Terra/Luna and GPT-6 Astra price cache writes at 1.25x input in total. Preserve `cacheWriteReported: false` for missing counters; never infer written tokens or Fast from reasoning effort. Disclose Standard assumptions. Luna needs explicit billing-provider context in the 200k-272k interval.
- Codex `metadata.pricingRequests` contains only last-request usage verified against cumulative deltas; unchanged checkpoints are deduplicated. Batch and live paths share `observePricing`. `pricingContext` records sourced billing provider / actual response service tier, not model-provider guesses. See README pricing evidence for verified sources and dates.

## UI invariants

- Reading density is an explicit header preference at `agentviz:density`. Use `theme.reading` for evidence text, row padding and detail targets, not global scaling.
- Meaningful text uses primary/secondary/muted/dim at 4.5:1 or better on neutral surfaces; ghost is nonessential. Track groups use 18% tint with primary labels.
- Replay observes pane width and remeasures virtual rows; compact layouts stack. Separators support pointer capture, keyboard arrows/Home/End and restore body styles on cancellation.
- Graph uses one tab stop with active-descendant tree navigation; Tracks uses one per lane and retains every event in persistent paginated detail.
- Tracks overview geometry is memoized and capped at 200 groups per lane, with every original event reachable through paginated detail.
- Empty Find keeps real-session import primary and omits empty metrics.
- Bottom-mounted ToolbarSelect menus use `placement="top"` and fit their trigger width. Browser regressions verify actual viewport bounds and selection at desktop/compact sizes.
- Filter chips and generic metric labels use sentence case; peer chips do not embed a count in only one label.

## Five-artifact sync

For UI changes, review all five artifact groups and update anything that drifted:

1. `README.md`: user-facing features and development guidance.
2. `docs/ui-ux-style-guide.md`: tokens, patterns, and rules.
3. `docs/color-palette.html`: swatches matching the theme and style guide.
4. `docs/screenshots/`: the eight documented screenshots.
5. Agent guidance: `AGENTS.md` for shared rules and `docs/architecture.md` for implementation details.

Keep the Claude/Copilot entry points small; do not regenerate architecture or
convention lists in them. Repository memory is supplementary, not a replacement
for checked-in guidance. No-op artifact edits are unnecessary.

Use `.github/skills/sync-artifacts/SKILL.md` for the detailed workflow. Ask for
explicit approval before regenerating screenshots. If approval is unavailable,
leave images unchanged and disclose deferred screenshot synchronization.
Capture only demo data at 1400x860, using `?demo=empty` for Find and the demo
session for other views. Never capture personal sessions. Required images:
`landing.png`, `session-hero.png`, `replay-view.png`, `tracks-view.png`,
`waterfall-view.png`, `graph-view.png`, `stats-view.png`, and `coach-view.png`.
Generate `session-hero.png` by copying `replay-view.png`; they must be identical.

## MCP versus development server

`launch_agentviz` serves the production build in `dist/`, not source files.
Run `npm run build` before testing source changes via MCP and before the user
views changed code through "open agentviz".

## Document authoring autonomy

Within a requested local document task, agents may reorganize sections, add
verified external references, and draft complete proposed sections without
asking about each editorial choice. Investigate all user-provided reference
URLs relevant to that task, rather than stopping at the first one.

This autonomy does not authorize publishing or editing GitHub issues, applying
configuration, or treating proposals and roadmaps as implementation requests.
The approval rules above still apply.
