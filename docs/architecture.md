# AGENTVIZ architecture

Session replay visualizer for AI agent workflows. Supports Claude Code, Codex,
VS Code Copilot Chat, Copilot CLI, Copilot prompt exports, and ATIF / Harbor logs.

Shared agent rules live in [AGENTS.md](../AGENTS.md). Commands and release
procedures live in [README.md](../README.md#development). This document describes
the implementation, not an approved feature roadmap.

## Stack

- React 18 + Vite; see `package.json` for current dependency versions.
- Inline styles, JetBrains Mono, and tokens in `src/lib/theme.js`.
- Components/hooks in JSX/JS; parsers and data libraries in TypeScript.

## Implementation map

Paths below are relative to the repository root.

```text
src/
  App.jsx              # Workflow-only mount, theme/density wiring and chunk recovery
  AppV2.jsx            # Workflow shell, session-scoped Q&A, shortcuts and shared Timeline transport
  main.jsx             # React entry point
  contexts/
    SessionProvider.jsx  # Shared loading, discovery, compare, live, export, and derived state
    PlaybackContext.jsx  # Session-scoped playback/search/filter provider shared across zones
  hooks/
    usePlayback.js     # Playback state: time, playing, speed, seek, playPause
    useSearch.js       # Debounced search with matchSet/matchedEntries
    useKeyboardShortcuts.js # Centralized keyboard handler with stable listener
    useQA.js           # Q&A messages, classifier, SSE streaming, abort
    useSessionLoader.js # Transactional parsing, live bootstrap, session reset
    useLiveStream.js   # Cursor-resumable SSE, debounce and reset handling
    usePersistentState.js # localStorage-backed state with debounced writes
    useDiscoveredSessions.js # Discovery via /api/sessions or manifest URL
    useAsyncStatus.js  # Async operation state machine
    useBreakpoint.js   # Shared responsive breakpoints
    useFocusTrap.js    # Modal focus trap and restoration
    useReducedMotion.js # Shared reduced-motion preference
  lib/
    theme.js           # Design tokens, TRACK_TYPES, AGENT_COLORS
    theme.d.ts         # Type declarations for theme.js
    constants.js       # Demo SAMPLE_EVENTS
    parser.ts          # Claude Code JSONL parser
    codexParser.ts     # Codex rollout JSONL parser
    copilotCliParser.ts # Copilot CLI JSONL parser
    copilotCostParser.ts # Copilot prompt export parser
    vscodeSessionParser.ts # VS Code Copilot Chat JSON parser
    atifParser.ts      # ATIF / Harbor trajectory parser
    liveSessionParser.ts # Incremental parsing of appended session text
    liveNormalization.ts # Indexed aggregates, tool pairing, affected turns
    liveClaudeNormalizer.ts # Retained timestamps, usage, duration boundaries
    liveCopilotNormalizer.ts # Indexed tool/lifecycle dependencies and turns
    liveCodexNormalizer.ts # Stateful emission, cumulative usage, indexed turns
    liveVSCodeNormalizer.ts # Owned patch tree and request/response caches
    liveSessionWorker.ts # Off-main-thread normalization with batch parity
    liveParserClient.js # Single-flight worker backpressure and disposal
    tracksLayout.js    # Bounded overview groups retaining evidence indices
    parseSession.ts    # Format detection and parsing router
    session.ts         # Totals, filtered entries, turn start maps
    sessionLibrary.js  # localStorage session library and content persistence
    sessionParsing.ts  # Parsing utilities and types
    sessionTypes.ts    # Session data types
    cacheMetrics.ts    # Shared cache hit rate helpers
    skillExtractor.ts  # Skill/capability lifecycle extraction
    autonomyMetrics.js # Human response time, idle gaps, intervention scoring
    projectConfig.js   # Project configuration surface detection
    aiCoachAgent.js    # Copilot SDK Coach agent
    qaClassifier.js   # Instant answer classifier and model context
    qaAgent.js         # Copilot SDK Q&A model fallback
    replayLayout.js   # Estimated layout and binary-search windowing
    commandPalette.js # Indexed event/turn search and workflow commands
    diffUtils.js      # File-edit detection and Myers line diff
    waterfall.ts      # Item construction, stats, layout, windowing
    graphLayout.js    # ELKjs DAG construction, layout and position merging
    costAnalysis.js   # Request-aware estimates, reported charges, limitations
    pricing.js        # Model/tier/cache rates and nullable estimation
    exportHtml.js     # Self-contained single/comparison HTML exports
    dataInspector.js  # Payload summaries and previews
    formatTime.js     # Duration and date formatting
    landingSessions.js # Find labels, filters, format options
    lazyImport.js     # Stale-chunk reload recovery
    playbackUtils.js  # Shared playback helpers
  components/
    DebriefView.jsx    # Coach analysis and draft application
    Timeline.jsx       # Playback bar, markers, turn boundaries
    ReplayView.jsx     # Windowed event stream and resizable inspector
    TracksView.jsx     # Track lanes with solo/mute
    WaterfallView.jsx  # Nested tool waterfall and inspector
    GraphView.jsx      # Interactive DAG with ELKjs layout and pan/zoom
    StatsView.jsx      # Metrics, tool ranking, turn summary
    CostView.jsx       # Token spend, cache, context composition
    CompareView.jsx    # A/B scorecard and tool comparison
    CommandPalette.jsx # Event, turn, and workflow search overlay
    DiffViewer.jsx     # Unified file-edit diff
    DataInspector.jsx  # Readable payload inspection and copy
    ShortcutsModal.jsx # Keyboard shortcut overlay
    QADrawer.jsx       # Session Q&A drawer
    SyntaxHighlight.jsx # Lightweight raw-data syntax coloring
    ResizablePanel.jsx # Split panel utility
    ErrorBoundary.jsx  # Reset-key error recovery
    Icon.jsx           # Lucide wrapper; import icons and add them to ICON_MAP
    ui/                # Shared brand, toolbar, export-status and keyboard primitives
    v2/                # FlowRail, V2Header, FindPortfolio, ReviewHub, InvestigateView,
                       # AnalyzeShell, InlineCompare, ImproveView, LiveSessionBanner
    waterfall/         # Chart, row, inspector and time-axis components
routes/
  discovery.js        # Async traversal, enrichment, bounded preview cache
  sessions.js         # Discovery, file serving, SSE streaming
  ai.js               # Coach, Q&A, model info
  config.js           # Config detection, preview and approved application
bin/
  agentviz.js         # CLI: select port, start server, open browser
mcp/
  server.js           # launch_agentviz and close_agentviz tools
server.js             # HTTP server: production SPA and live file-tail SSE
```

## Core data shapes

These are abbreviated orientation examples, not complete type contracts.
See `src/lib/sessionTypes.ts` for full fields, including pricing evidence.

Normalized event:

```text
{ t, agent, track, text, duration, intensity, toolName?, toolInput?,
  toolOutput?, toolCallId?, parentToolCallId?, agentName?, agentDisplayName?,
  raw, turnIndex, isError, model?, reasoningEffort?, tokenUsage? }
```

Turn:

```text
{ index, startTime, endTime, eventIndices, userMessage, toolCount, hasError }
```

Session metadata:

```text
{ totalEvents, totalTurns, totalToolCalls, errorCount, duration, models,
  primaryModel, reasoningEffort?, reasoningEfforts?, tokenUsage, totalCost? }
```

Parser result: `{ events, turns, metadata }` or `null`.

Track types: `reasoning`, `tool_call`, `context`, `output`.
Agent roles: `user`, `assistant`, `system`; named agents are separate metadata.
