# AgentViz

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
    useSessionLoader.js # File parsing, sample loading, session reset, hero state
    usePersistentState.js # localStorage-backed useState with debounced writes
  lib/
    theme.js           # Design token system ("Midnight Circuit" theme), TRACK_TYPES, AGENT_COLORS
    constants.js       # SAMPLE_EVENTS data for demo mode
    parser.js          # parseClaudeCodeJSONL() - Claude Code JSONL parser
    copilotCliParser.js # parseCopilotCliJSONL() - Copilot CLI JSONL parser
    parseSession.js    # Auto-detect format router: detectFormat() + parseSession()
    session.js         # Pure helpers: getSessionTotal, buildFilteredEventEntries, buildTurnStartMap
    replayLayout.js    # Estimated layout + binary search windowing for virtualized replay
    commandPalette.js  # Precomputed search index with scoring and per-type caps
    diffUtils.js        # Diff detection (isFileEditEvent) + Myers line diff algorithm
    waterfall.js       # Waterfall view helpers: item building, stats, layout, windowing
  components/
    FileUploader.jsx   # Drag-and-drop file input with error handling
    Timeline.jsx       # Scrubable playback bar with event markers, turn boundaries
    ReplayView.jsx     # Windowed event stream + resizable inspector sidebar
    TracksView.jsx     # DAW-style multi-track lanes with solo/mute
    WaterfallView.jsx  # Tool execution waterfall with nesting, inspector sidebar
    StatsView.jsx      # Aggregate metrics, tool ranking, turn summary
    SessionHero.jsx    # Summary card shown after file load (sparkline, format badge, metrics)
    CommandPalette.jsx # Cmd+K fuzzy search overlay (events, turns, views)
    DiffViewer.jsx     # Inline unified diff view for file-editing tool calls
    SyntaxHighlight.jsx # Lightweight code syntax coloring for raw data
    ResizablePanel.jsx # Drag-to-resize split panel utility
    ErrorBoundary.jsx  # React error boundary with resetKey for recovery
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
- `npm test` - Run 144 tests (40 Claude parser + 42 Copilot parser + 6 UX helpers + 23 waterfall + 33 diff) via Vitest
- `npm run test:watch` - Watch mode for tests

## Conventions
- No em dashes in any content or comments
- All styles are inline (no CSS files), all colors reference theme.js tokens
- Unicode characters used directly or as escape sequences in JS
- Components receive data as props, no global state management
- "Midnight Circuit" theme defined in src/lib/theme.js

## Planned features
- Token count tracking and cost estimation per turn
- Conversation flow graph (directed graph of turns/decisions)
- Bookmarks and annotations (persisted to localStorage)
- Vim-style keyboard navigation
- Parsers for: LangSmith traces, OpenTelemetry
- Multi-agent hierarchy (parent/child agents, nested tracks)
- Session scoring, achievements, shareable URLs
- Live streaming mode (tail a session file)
- Fork-from-any-point replay
- CLI launcher: npx agentviz session.jsonl
