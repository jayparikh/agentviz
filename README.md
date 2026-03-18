# AgentViz

Session replay visualizer for AI agent workflows. Drop in a Claude Code session file and explore the agent's reasoning, tool calls, and output through an interactive timeline.

## Quick Start

```bash
npm install
npm run dev
```

Opens at http://localhost:3000. Drop a `.jsonl` file or click "Load Demo Session."

## Finding Session Data

```bash
# Claude Code sessions
ls ~/.claude/projects/

# Grab any .jsonl file from a project folder
# These are full session transcripts with tool calls, reasoning, and output
```

## Features

**Session Hero** -- After loading a file, a summary card shows key metrics (events, turns, tools, duration, model) with an activity sparkline. Press Space or click "Dive In" to enter the timeline.

**Replay View** -- Chronological event stream with turn boundaries. Click any event to inspect it in the resizable sidebar. Errors highlighted in red. Raw JSON data shown with syntax highlighting.

**Tracks View** -- DAW-style lanes for Reasoning, Tool Calls, Context, and Output. Solo (S) isolates one track. Mute (M) hides it. Turn boundaries shown as vertical markers. Hover any block for detail.

**Stats View** -- Aggregate metrics: event count cards, track distribution bars, tool usage ranking, model info with token counts, and a per-turn summary with error indicators.

**Search** -- Full-text search across event text, tool names, and agent types. Matches highlighted in the event stream and timeline. Enter/Shift+Enter to jump between matches.

**Command Palette** -- Cmd+K (or Ctrl+K) opens a fuzzy-search overlay to jump to turns, search events, filter by tool, or switch views.

**Track Filters** -- Toggle visibility per track type using the filter chips in the header.

**Error Navigation** -- Errors are auto-detected from `is_error` flags and text patterns (exit codes, exceptions, permission denied, etc.). Jump between errors with E/Shift+E.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `Left/Right Arrow` | Seek 2s |
| `1` / `2` / `3` | Switch view (Replay / Tracks / Stats) |
| `/` | Focus search |
| `E` / `Shift+E` | Next / Previous error |
| `Cmd+K` | Command palette |
| `Enter` / `Shift+Enter` | Next / Previous search match (when search focused) |

## Parser Output

`parseClaudeCodeJSONL(text)` returns `{ events, turns, metadata }` or null.

```js
// Normalized event
{ t, agent, track, text, duration, intensity, toolName?, toolInput?, raw, turnIndex, isError, model?, tokenUsage? }

// Turn
{ index, startTime, endTime, eventIndices, userMessage, toolCount, hasError }

// Metadata
{ totalEvents, totalTurns, totalToolCalls, errorCount, duration, models, primaryModel, tokenUsage }
```

## Testing

```bash
npm test          # Run 40 parser tests
npm run test:watch  # Watch mode
```

## Design

"Midnight Circuit" theme -- dark palette with cyan/amber/purple accents. All colors defined in `src/lib/theme.js` as design tokens. JetBrains Mono font throughout.
