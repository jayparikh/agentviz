# AgentViz

Session replay visualizer for AI agent workflows. Renders Claude Code (and eventually Copilot, LangSmith) session logs as interactive timelines.

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
  lib/
    theme.js           # Design token system ("Midnight Circuit" theme), TRACK_TYPES, AGENT_COLORS
    constants.js       # Re-exports from theme + SAMPLE_EVENTS data
    parser.js          # parseClaudeCodeJSONL() - returns { events, turns, metadata }
  components/
    FileUploader.jsx   # Drag-and-drop file input
    Timeline.jsx       # Scrubable playback bar with event markers, turn boundaries
    ReplayView.jsx     # Chronological event stream + resizable inspector sidebar
    TracksView.jsx     # DAW-style multi-track lanes with solo/mute
    StatsView.jsx      # Aggregate metrics, tool ranking, turn summary
    SessionHero.jsx    # Summary card shown after file load (sparkline, metrics)
    CommandPalette.jsx # Cmd+K fuzzy search overlay (events, turns, views)
    SyntaxHighlight.jsx # Lightweight code syntax coloring for raw data
    ResizablePanel.jsx # Drag-to-resize split panel utility
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
- `npm test` - Run 40 parser tests via Vitest
- `npm run test:watch` - Watch mode for tests

## Conventions
- No em dashes in any content or comments
- All styles are inline (no CSS files), all colors reference theme.js tokens
- Unicode characters used directly or as escape sequences in JS
- Components receive data as props, no global state management
- "Midnight Circuit" theme defined in src/lib/theme.js

## Planned features
- Token count tracking and cost estimation per turn
- Tool execution waterfall/flame chart view
- Inline diff viewer for file-editing tool calls
- Conversation flow graph (directed graph of turns/decisions)
- Bookmarks and annotations (persisted to localStorage)
- Vim-style keyboard navigation
- Parsers for: Copilot Chat JSON, Copilot Agent logs, LangSmith traces, OpenTelemetry
- Auto-detect file format and route to correct parser
- Multi-agent hierarchy (parent/child agents, nested tracks)
- Session scoring, achievements, shareable URLs
- Live streaming mode (tail a session file)
- Fork-from-any-point replay
- CLI launcher: npx agentviz session.jsonl
