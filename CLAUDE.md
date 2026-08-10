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
  App.jsx              # Default v2 mount + Classic UI fallback, theme wiring, session entry routing
  AppV2.jsx            # Default workflow shell: Find, Review, Investigate, Analyze, Compare, Improve
  main.jsx             # React entry point
  contexts/
    SessionProvider.jsx  # Shared session loading, discovery, compare, live, export, and derived state
    PlaybackContext.jsx  # Playback, search, track filtering, and derived state provider
  hooks/
    usePlayback.js     # Playback state: time, playing, speed, seek, playPause
    useSearch.js       # Debounced search with matchSet/matchedEntries
    useKeyboardShortcuts.js # Centralized keyboard handler (ref-based, stable listener)
    useQA.js           # Session Q&A state: messages, classifier, SSE streaming, abort
    useFeatureFlag.js  # localStorage-backed feature flag evaluation
    useSessionLoader.js # File parsing, live init from /api/file, session reset, hero state
    useLiveStream.js   # SSE EventSource hook with 500ms debounce for live mode
    usePersistentState.js # localStorage-backed useState with debounced writes
    useDiscoveredSessions.js # Auto-discovery of sessions via /api/sessions or ?manifest= URL
    useHashRouter.js   # Hash-based routing between inbox and session views
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
    commandPalette.js  # Precomputed search index with scoring, legacy views, and v2 workflow commands
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
    InboxView.jsx      # Session inbox with auto-discovery, sorting, refresh, and review priority
    DashboardView.jsx  # Landing dashboard card grid with shared landing controls, aggregate stats, and quick open
    DebriefView.jsx    # AI Coach panel with cached analysis and one-click apply
    FileUploader.jsx   # Drag-and-drop file input with error handling
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
    LiveIndicator.jsx  # Pulsing LIVE badge shown in CLI streaming mode
    ShortcutsModal.jsx # Keyboard shortcuts overlay
    QADrawer.jsx       # Session Q&A slide-over drawer with instant answers
    RecentSessionsPicker.jsx # Recent sessions dropdown picker
    SyntaxHighlight.jsx # Lightweight code syntax coloring for raw data
    ResizablePanel.jsx # Drag-to-resize split panel utility
    ErrorBoundary.jsx  # React error boundary with resetKey for recovery
    Icon.jsx           # Lucide icon wrapper; all icons must be imported AND added to ICON_MAP
    app/               # Shell components: AppHeader, AppLandingState, AppLoadingState, CompareLandingState, CompareShell (AppLandingState switches between inbox and dashboard landing modes)
    ui/                # Shared primitives: BrandWordmark, ShellFrame, ToolbarButton, ToolbarSelect, ExportStatusButton, KeyboardHint
    v2/                # Default workflow UI: FlowRail, V2Header, FindPortfolio, ReviewHub, InvestigateView, AnalyzeShell, InlineCompare, ImproveView, LiveSessionBanner
    waterfall/         # Waterfall sub-components: WaterfallChart, WaterfallRow, WaterfallInspector, TimeAxis
routes/
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
- `npm run test:v2` - Run v2 golden data, UI, and v1 regression coverage
- `npm run test:e2e:v2` - Run the Playwright v2 browser smoke test on the hermetic Vite test server
- `npm run test:watch` - Watch mode for tests
- `npm run typecheck` - Type-check with tsc --noEmit

`npm run dev` auto-starts the API backend on port 4242.
Vite proxies `/api/*` to the backend automatically.
Run `npx playwright install chromium` once before the first browser test run.

## Conventions
- No em dashes in any content or comments
- All styles are inline (no CSS files), all colors reference theme.js tokens
- Unicode characters used directly or as escape sequences in JS
- Components receive data as props. Shared contexts are limited to SessionProvider for session orchestration and PlaybackContext for active-session playback/search/filter state
- Design tokens defined in src/lib/theme.js
- Product name is always AGENTVIZ (all caps, no spaces)
- UI/UX design system: see docs/ui-ux-style-guide.md -- all UI changes must conform to it
- Cache usage summaries omit the cache-write segment when `cacheWrite` is zero
- Copilot CLI Session Info lists every explicit reasoning effort in first-seen order; selected events show the effective value, and effort is never inferred from reasoning text or token usage
- The default UI is the v2 workflow shell. Classic UI remains available through the `agentviz:v2:enabled` preference and header toggle.
- Shared session actions must remain available in both shells; single-session HTML export uses `ExportStatusButton` in the v2 and Classic headers.
- Investigate search preserves timeline context; Enter and Shift+Enter, plus adjacent arrow controls, navigate next and previous matches.
- User-only filtering uses the normalized `event.agent === "user"` field across every parser, and search operates on the filtered event set.
- Codex Session Info distinguishes user threads from named subagent traces when rollout metadata provides `thread_source` and `source.subagent`.

## Planned features
- Bookmarks and annotations (persisted to localStorage)
- Vim-style keyboard navigation
- Parsers for: LangSmith traces, OpenTelemetry
- ATIF auto-discovery (Harbor has no canonical output directory yet)
- Multi-agent hierarchy (parent/child agents, nested tracks)
- Fork-from-any-point replay
- Publish to npm (`npx agentviz`)
