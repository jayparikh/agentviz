# AGENTVIZ

Session replay visualizer for AI agent workflows. Renders Claude Code and Copilot CLI session logs as interactive timelines, with auto-detection of file format.

## Stack
- React 18 + Vite 6
- No CSS framework, all inline styles
- Font: JetBrains Mono (loaded from Google Fonts in index.html)
- No TypeScript yet (plain JSX)

## Architecture
```
src/
  App.jsx              # Main orchestrator: file loading, playback, keyboard shortcuts, view routing
  main.jsx             # React entry point
  hooks/
    usePlayback.js     # Playback state: time, playing, speed, seek, playPause
    useSearch.js       # Debounced search with matchSet/matchedEntries
    useKeyboardShortcuts.js # Centralized keyboard handler (ref-based, stable listener)
    useSessionLoader.js # File parsing, live init from /api/file, session reset, hero state
    useLiveStream.js   # SSE EventSource hook with 500ms debounce for live mode
    usePersistentState.js # localStorage-backed useState with debounced writes
    useDiscoveredSessions.js # Auto-discovery of Copilot CLI sessions via /api/sessions
    useHashRouter.js   # Hash-based routing between inbox and session views
    useAsyncStatus.js  # Async operation state machine (idle/loading/success/error)
  lib/
    theme.js           # Design token system ("Midnight Circuit" theme), TRACK_TYPES, AGENT_COLORS
    constants.js       # SAMPLE_EVENTS data for demo mode
    parser.ts          # parseClaudeCodeJSONL() - Claude Code JSONL parser
    copilotCliParser.ts # parseCopilotCliJSONL() - Copilot CLI JSONL parser
    parseSession.ts    # Auto-detect format router: detectFormat() + parseSession()
    session.ts         # Pure helpers: getSessionTotal, buildFilteredEventEntries, buildTurnStartMap
    sessionLibrary.js  # localStorage-backed session library with content persistence
    sessionParsing.ts  # Session parsing utilities and types
    sessionTypes.ts    # TypeScript type definitions for session data
    autonomyMetrics.js # Human response time, idle gaps, intervention scoring
    projectConfig.js   # Project config surface detection (CLAUDE.md, .github/, etc.)
    aiCoachAgent.js    # AI Coach powered by @github/copilot-sdk (gpt-4o)
    replayLayout.js    # Estimated layout + binary search windowing for virtualized replay
    commandPalette.js  # Precomputed search index with scoring and per-type caps
    diffUtils.js       # Diff detection (isFileEditEvent) + Myers line diff algorithm
    waterfall.ts       # Waterfall view helpers: item building, stats, layout, windowing
    graphLayout.js     # Graph view helpers: ELKjs DAG builder, layout runner, position merger
    pricing.js         # Claude model pricing table and cost estimation
    exportHtml.js      # Self-contained HTML export for single sessions and comparisons
    dataInspector.js   # Payload summary and preview helpers for inspector panels
    formatTime.js      # Duration and date formatting utilities
    playbackUtils.js   # Playback state helpers
  components/
    InboxView.jsx      # Session inbox with auto-discovery, sorting, and review priority
    DebriefView.jsx    # AI Coach panel with cached analysis and one-click apply
    FileUploader.jsx   # Drag-and-drop file input with error handling
    Timeline.jsx       # Scrubable playback bar with event markers, turn boundaries
    ReplayView.jsx     # Windowed event stream + resizable inspector sidebar
    TracksView.jsx     # DAW-style multi-track lanes with solo/mute
    WaterfallView.jsx  # Tool execution waterfall with nesting, inspector sidebar
    GraphView.jsx      # Interactive DAG of turns/tool calls with ELKjs layout, pan/zoom, animations
    StatsView.jsx      # Aggregate metrics, tool ranking, turn summary
    CompareView.jsx    # Side-by-side session comparison: Scorecard + Tools tabs
    CommandPalette.jsx # Cmd+K fuzzy search overlay (events, turns, views)
    DiffViewer.jsx     # Inline unified diff view for file-editing tool calls
    DataInspector.jsx  # Readable payload inspector with summaries and copy support
    LiveIndicator.jsx  # Pulsing LIVE badge shown in CLI streaming mode
    ShortcutsModal.jsx # Keyboard shortcuts overlay
    RecentSessionsPicker.jsx # Recent sessions dropdown picker
    SyntaxHighlight.jsx # Lightweight code syntax coloring for raw data
    ResizablePanel.jsx # Drag-to-resize split panel utility
    ErrorBoundary.jsx  # React error boundary with resetKey for recovery
    Icon.jsx           # Lucide icon wrapper
    app/               # Shell components: AppHeader, AppLandingState, AppLoadingState, CompareShell
    ui/                # Shared primitives: BrandWordmark, ShellFrame, ToolbarButton, ExportStatusButton
    waterfall/         # Waterfall sub-components: WaterfallChart, WaterfallRow, TimeAxis
bin/
  agentviz.js          # CLI entry point: finds free port, starts server, opens browser
mcp/
  server.js            # MCP server: launch_agentviz and close_agentviz tools
server.js              # HTTP server: serves dist/ SPA + SSE /api/stream file tail
```

## Key data types

Normalized event (output of parser, consumed by all views):
```
{ t, agent, track, text, duration, intensity, toolName?, toolInput?, raw, turnIndex, isError, model?, tokenUsage? }
```

Turn (groups events by user-initiated conversation rounds):
```
{ index, startTime, endTime, eventIndices, userMessage, toolCount, hasError }
```

Session metadata (aggregate stats):
```
{ totalEvents, totalTurns, totalToolCalls, errorCount, duration, models, primaryModel, tokenUsage }
```

Parser returns: `{ events, turns, metadata }` or null

Track types: reasoning, tool_call, context, output
Agent types: user, assistant, system

## Dev commands
- `npm run dev` - Start dev server on port 3000
- `npm run build` - Production build to dist/
- `npm test` - Run 253 tests via Vitest (parsers, layout, diff, graph, autonomy, regressions, and more)
- `npm run test:watch` - Watch mode for tests

## Conventions
- No em dashes in any content or comments
- All styles are inline (no CSS files), all colors reference theme.js tokens
- Unicode characters used directly or as escape sequences in JS
- Components receive data as props, no global state management
- "Midnight Circuit" theme defined in src/lib/theme.js

## Planned features
- Bookmarks and annotations (persisted to localStorage)
- Vim-style keyboard navigation
- Parsers for: LangSmith traces, OpenTelemetry
- Multi-agent hierarchy (parent/child agents, nested tracks)
- Fork-from-any-point replay
- `npx agentviz` (publish to npm)
