# AGENTVIZ

Session replay visualizer for AI agent workflows. Renders Claude Code, Codex, VS Code Copilot Chat, Copilot CLI, Copilot prompt exports, and ATIF / Harbor session logs as interactive timelines, with auto-detection of file format.

## Stack
- React 18 + Vite 6
- No CSS framework, all inline styles
- Font: JetBrains Mono (loaded from Google Fonts in index.html)
- Mixed JS/TS: components and hooks are plain JSX, parsers and data libs are TypeScript

## Architecture
```
src/
  App.jsx              # Workflow-only mount, theme/density wiring and chunk recovery
  AppV2.jsx            # Workflow shell, session-scoped Q&A, shortcuts and shared Timeline transport
  main.jsx             # React entry point
  contexts/
    SessionProvider.jsx  # Shared session loading, discovery, compare, live, export, and derived state
    PlaybackContext.jsx  # Session-scoped playback/search/filter provider shared across v2 zones
  hooks/
    usePlayback.js     # Playback state: time, playing, speed, seek, playPause
    useSearch.js       # Debounced search with matchSet/matchedEntries
    useKeyboardShortcuts.js # Centralized keyboard handler (ref-based, stable listener)
    useQA.js           # Session Q&A state: messages, classifier, SSE streaming, abort
    useSessionLoader.js # Transactional parsing, completion signaling, live snapshot bootstrap, session reset
    useLiveStream.js   # Cursor-resumable SSE hook with 500ms debounce and reset handling
    usePersistentState.js # localStorage-backed useState with debounced writes
    useDiscoveredSessions.js # Auto-discovery of sessions via /api/sessions or ?manifest= URL
    useAsyncStatus.js  # Async operation state machine (idle/loading/success/error)
    useBreakpoint.js   # Shared compact/narrow/wide responsive breakpoint hook
    useFocusTrap.js    # Modal focus trap with Escape close and focus restoration
    useReducedMotion.js # Shared prefers-reduced-motion hook for inline/SVG animation guards
  lib/
    theme.js           # Design token system, TRACK_TYPES, AGENT_COLORS
    theme.d.ts         # TypeScript declarations for theme.js
    constants.js       # SAMPLE_EVENTS data for demo mode
    parser.ts          # parseClaudeCodeJSONL() - Claude Code JSONL parser
    codexParser.ts     # parseCodexJSONL() - Codex rollout JSONL parser
    copilotCliParser.ts # parseCopilotCliJSONL() - Copilot CLI JSONL parser
    copilotCostParser.ts # parseCopilotPromptsJSON() - Copilot prompt export parser for token/cost analysis
    vscodeSessionParser.ts # parseVSCodeChatJSON() - VS Code Copilot Chat JSON parser
    atifParser.ts       # parseAtifJSON() - ATIF / Harbor trajectory JSON parser (schema_version ATIF-v1.6)
    liveSessionParser.ts # Incremental live JSONL parser for appended session text
    liveNormalization.ts # Indexed aggregates, tool pairing, and affected-turn helpers
    liveClaudeNormalizer.ts # Retained timestamps, cumulative usage, and duration boundaries
    liveCopilotNormalizer.ts # Indexed tool/lifecycle dependencies and turn aggregates
    liveCodexNormalizer.ts # Stateful emission, cumulative usage, and indexed turns
    liveVSCodeNormalizer.ts # Owned patch tree with request and response-part caches
    liveSessionWorker.ts # Off-main-thread normalization with batch-parser parity
    liveParserClient.js # Single-flight worker backpressure, reset and disposal
    tracksLayout.js     # Bounded overview groups retaining original evidence indices
    parseSession.ts    # Auto-detect format router: detectFormat() + parseSession()
    session.ts         # Pure helpers: getSessionTotal, buildFilteredEventEntries, buildTurnStartMap
    sessionLibrary.js  # localStorage-backed session library with content persistence
    sessionParsing.ts  # Session parsing utilities and types
    sessionTypes.ts    # TypeScript type definitions for session data
    cacheMetrics.ts    # Shared cache hit rate helpers
    skillExtractor.ts  # Skill/capability lifecycle extractor (skills, instructions, agents, MCP servers, tools, prompts)
    autonomyMetrics.js # Human response time, idle gaps, intervention scoring
    projectConfig.js   # Project config surface detection (CLAUDE.md, .github/, etc.)
    aiCoachAgent.js    # AI Coach powered by @github/copilot-sdk (gpt-4o)
    qaClassifier.js    # Session Q&A instant answer engine (9 patterns + model context)
    qaAgent.js         # Q&A agent powered by @github/copilot-sdk for model fallback
    replayLayout.js    # Estimated layout + binary search windowing for virtualized replay
    commandPalette.js  # Indexed event/turn search and workflow zone/panel commands
    diffUtils.js       # Diff detection (isFileEditEvent) + Myers line diff algorithm
    waterfall.ts       # Waterfall view helpers: item building, stats, layout, windowing
    graphLayout.js     # Graph view helpers: ELKjs DAG builder, layout runner, position merger
    costAnalysis.js    # Per-call cost, context, cache-miss, and token aggregation helpers
    pricing.js         # Claude and OpenAI/Copilot model pricing table and cost estimation
    exportHtml.js      # Self-contained HTML export for single sessions and comparisons
    dataInspector.js   # Payload summary and preview helpers for inspector panels
    formatTime.js      # Duration and date formatting utilities
    landingSessions.js # Shared landing browser labels, filters, and format options
    lazyImport.js      # Dynamic import wrapper with stale-chunk reload recovery
    playbackUtils.js   # Playback state helpers
  components/
    DebriefView.jsx    # AI Coach panel with cached analysis and one-click apply
    Timeline.jsx       # Scrubable playback bar with event markers, turn boundaries
    ReplayView.jsx     # Windowed event stream + resizable inspector sidebar
    TracksView.jsx     # DAW-style multi-track lanes with solo/mute
    WaterfallView.jsx  # Tool execution waterfall with nesting, inspector sidebar
    GraphView.jsx      # Interactive DAG of turns/tool calls with ELKjs layout, pan/zoom, animations
    StatsView.jsx      # Aggregate metrics, tool ranking, turn summary
    CostView.jsx       # Token spend, cache, and context-composition analysis
    CompareView.jsx    # Side-by-side session comparison: Scorecard + Tools tabs
    CommandPalette.jsx # Cmd+K fuzzy search overlay (events, turns, views)
    DiffViewer.jsx     # Inline unified diff view for file-editing tool calls
    DataInspector.jsx  # Readable payload inspector with summaries and copy support
    ShortcutsModal.jsx # Keyboard shortcuts overlay
    QADrawer.jsx       # Session Q&A slide-over drawer with instant answers
    SyntaxHighlight.jsx # Lightweight code syntax coloring for raw data
    ResizablePanel.jsx # Drag-to-resize split panel utility
    ErrorBoundary.jsx  # React error boundary with resetKey for recovery
    Icon.jsx           # Lucide icon wrapper; all icons must be imported AND added to ICON_MAP
    ui/                # Shared primitives: BrandWordmark, ToolbarButton, ToolbarSelect, ExportStatusButton, KeyboardHint
    v2/                # Default workflow UI: FlowRail, V2Header, FindPortfolio, ReviewHub, InvestigateView, AnalyzeShell, InlineCompare, ImproveView, LiveSessionBanner
    waterfall/         # Waterfall sub-components: WaterfallChart, WaterfallRow, WaterfallInspector, TimeAxis
routes/
  discovery.js       # Async traversal, newest-first enrichment and bounded preview cache
  sessions.js        # Session discovery, file serving, SSE streaming
  ai.js              # Coach analysis, Q&A, model info (SSE streaming)
  config.js          # Project config surface detection, file preview, apply
bin/
  agentviz.js          # CLI entry point: finds free port, starts server, opens browser
mcp/
  server.js            # MCP server: launch_agentviz and close_agentviz tools
server.js              # HTTP server: serves dist/ SPA + SSE /api/stream file tail
```

## Key data types

Normalized event (output of parser, consumed by all views):
```
{ t, agent, track, text, duration, intensity, toolName?, toolInput?, toolOutput?, toolCallId?, parentToolCallId?, agentName?, agentDisplayName?, raw, turnIndex, isError, model?, reasoningEffort?, tokenUsage? }
```

Turn (groups events by user-initiated conversation rounds):
```
{ index, startTime, endTime, eventIndices, userMessage, toolCount, hasError }
```

Session metadata (aggregate stats):
```
{ totalEvents, totalTurns, totalToolCalls, errorCount, duration, models, primaryModel, reasoningEffort?, reasoningEfforts?, tokenUsage, totalCost? }
```

Parser returns: `{ events, turns, metadata }` or null

Track types: reasoning, tool_call, context, output
Agent types: user, assistant, system

## Commands
- `npm start` - Build and launch AGENTVIZ in browser (production)
- `npm run dev` - Vite dev server + API backend (both auto-started)
- `npm run build` - Production build to dist/
- `npm test` - Run 800+ tests via Vitest with a stable worker cap (parsers, layout, diff, graph, autonomy, QA, regressions, and more)
- `npm run test:v2` - Run workflow golden data, UI, and app regression coverage
- `npm run test:e2e:v2` - Run the Playwright v2 browser smoke test on the hermetic Vite test server
- `npm run test:e2e:export` - Build and test single/comparison HTML offline in Chromium and WebKit
- `npm run test:watch` - Watch mode for tests
- `npm run typecheck` - Type-check with tsc --noEmit

`npm run dev` auto-starts the API backend on port 4242.
Vite proxies `/api/*` to the backend automatically.
Run `npx playwright install chromium` once before the first browser test run.

## Conventions
- Deep Replay targets remain scroll-anchored through measured layout changes; manual wheel, touch, pointer or scroll movement cancels automatic correction.
- Discovery preview IO is asynchronous with format-specific bounded buffers; synchronous compatibility readers share the same pure preview extractors.
- Reading density is an explicit header preference at `agentviz:density`. Use `theme.reading` for evidence text, row padding and detail targets, not global scaling.
- Meaningful text uses primary/secondary/muted/dim at 4.5:1 or better on neutral surfaces; ghost is nonessential. Track groups use 18% tint with primary labels.
- Replay observes pane width and remeasures virtual rows; compact layouts stack. Separators support pointer capture, keyboard arrows/Home/End and restore body styles on cancellation.
- Graph uses one tab stop with active-descendant tree navigation; Tracks uses one per lane and retains every event in persistent paginated detail.
- Empty Find keeps real-session import primary and omits empty metrics.
- Live JSONL normalization retains format-specific state. Ordinary appends process new/affected records, not history; late tool completions update indexed aggregates without removing/reinserting unchanged turn membership. Batch parsers remain the parity oracle. See `docs/live-normalization.md` for invalidation boundaries and measurements.
- Live parser state is a single-owner mutable accumulator. Published results are independent snapshots by default; only the worker uses `snapshot: false` because `postMessage` clones the result. Full snapshot copying, raw-text transfer, and rendering are still O(history), separate from normalization.
- Tracks overview geometry is memoized and capped at 200 groups per lane, with every original event reachable through paginated detail.
- Claude metadata preserves explicit sessionId, so appended snapshots update one library entry.
- Evidence navigation carries original event indices, not just timestamps. Palette event and turn results preserve index zero and equal-time identities.
- V2 zones share one PlaybackProvider keyed by successful session replacement, not request start or live event updates. Consume explicit navigation targets once per request, not on every session-object render.
- Session opens resolve to success only after parsing. Preserve the previous events and raw text on failure, and ignore superseded async requests.
- Live bootstrap reads `/api/file?live=1` and subscribes using `X-Agentviz-Cursor`; SSE IDs resume reconnects. Reset payloads discard both pending batches and previous parser records. Non-live file reads remain complete.
- No em dashes in any content or comments
- All styles are inline (no CSS files), all colors reference theme.js tokens
- Unicode characters used directly or as escape sequences in JS
- Components receive data as props. Shared contexts are limited to SessionProvider for session orchestration and PlaybackContext for active-session playback/search/filter state
- Design tokens defined in src/lib/theme.js
- Product name is always AGENTVIZ (all caps, no spaces)
- UI/UX design system: see docs/ui-ux-style-guide.md -- all UI changes must conform to it
- Cache usage summaries omit the cache-write segment when `cacheWrite` is zero
- Copilot CLI Session Info lists every explicit reasoning effort in first-seen order; selected events show the effective value, and effort is never inferred from reasoning text or token usage
- The workflow is the only shell. Keep `#/v2/...` URLs, internal v2 filenames and preferences, and session-library/content v1 schema keys. Ignore obsolete UI preferences; never clear saved data to remove a shell.
- Timeline transport in Investigate and Analyze shares PlaybackProvider state. Speeds live in playbackUtils.js. One shortcut dispatcher preserves 1-6 zones and the 7 Improve alias, without stealing native control keys.
- Bottom-mounted ToolbarSelect menus use `placement="top"` and fit their trigger width. Browser regressions verify actual viewport bounds and selection at desktop/compact sizes.
- WorkflowSession memoizes its zone subtree so transport ticks do not rerender unrelated Find/Review content. Only consumers of playback context should update on time ticks.
- Q&A and its draft live beneath the successful-session key, above zone rendering. Failed loads and zone changes retain them; successful replacement or Close aborts streams and resets them.
- Close session clears active A/B, overlays and live subscriptions, not saved library entries or preferences. Going to Find retains the session.
- Close remains available for an empty live stream, including before its first event and after a live reset.
- Single-session and comparison HTML exports use ExportStatusButton and the current workflow-only production build.
- Investigate search preserves timeline context; Enter and Shift+Enter, plus adjacent arrow controls, navigate next and previous matches.
- User-only filtering uses the normalized `event.agent === "user"` field across every parser, and search operates on the filtered event set.
- Filter chips and generic metric labels use sentence case; peer chips do not embed a count in only one label.
- Codex Session Info distinguishes user threads from named subagent traces when rollout metadata provides `thread_source` and `source.subagent`.

## Planned features
- Bookmarks and annotations (persisted to localStorage)
- Vim-style keyboard navigation
- Parsers for: LangSmith traces, OpenTelemetry
- ATIF auto-discovery (Harbor has no canonical output directory yet)
- Multi-agent hierarchy (parent/child agents, nested tracks)
- Fork-from-any-point replay
- Publish to npm (`npx agentviz`)
