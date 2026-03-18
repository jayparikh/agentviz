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
  App.jsx              # Main orchestrator: file loading, playback state, keyboard shortcuts, view routing
  main.jsx             # React entry point
  lib/
    constants.js       # FONT, AGENT_COLORS, TRACK_TYPES, SAMPLE_EVENTS
    parser.js          # parseClaudeCodeJSONL() - converts JSONL to normalized event array
  components/
    FileUploader.jsx   # Drag-and-drop file input
    Timeline.jsx       # Scrubable playback bar with event markers
    ReplayView.jsx     # Chronological event stream + inspector sidebar
    TracksView.jsx     # DAW-style multi-track lanes with solo/mute
    StatsView.jsx      # Aggregate metrics, tool ranking
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

## Conventions
- No em dashes in any content or comments
- All styles are inline (no CSS files)
- Unicode characters used directly or as escape sequences in JS
- Components receive data as props, no global state management

## Planned features
- Topology view for multi-agent sessions (force-directed graph)
- Fork-from-any-point replay
- Live streaming mode (tail a session file)
- Shareable session URLs
- Parsers for: Copilot Chat JSON, Copilot Agent logs, LangSmith traces
- Token count tracking and cost estimation
- Git diff overlay per tool call
