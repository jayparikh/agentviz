<div align="center">

# ◇ AgentViz

**See what your AI agents actually do.**

Drop a Claude Code or Copilot CLI session file and explore the agent's reasoning, tool calls, and output through an interactive timeline.

[![CI](https://github.com/jayparikh/agentviz/actions/workflows/ci.yml/badge.svg)](https://github.com/jayparikh/agentviz/actions/workflows/ci.yml)
![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

<br />

<img src="docs/screenshots/replay-view.png" alt="AgentViz Replay View" width="800" />

*Replay an AI coding session event by event, with full tool call inspection.*

</div>

---

## Why AgentViz?

AI coding agents (Claude Code, Copilot CLI, etc.) generate dense session logs, but reading raw JSONL is painful. AgentViz turns those logs into something you can actually explore:

- **Replay** sessions like a video, stepping through each tool call and reasoning step
- **Visualize** timing and concurrency in a DAW-style multi-track timeline
- **Analyze** tool usage patterns, error rates, and model behavior at a glance
- **Debug** failures by jumping directly between errors with one keystroke

No backend. No sign-up. Just drag, drop, and explore.

## Quick Start

```bash
git clone https://github.com/jayparikh/agentviz.git
cd agentviz
npm install
npm run dev
```

Opens at [localhost:3000](http://localhost:3000). Drop a `.jsonl` session file or click **Load Demo Session** to try it instantly.

### Finding your session files

```bash
# Claude Code sessions
ls ~/.claude/projects/

# Copilot CLI event traces (location varies by config)
```

## Features

### Session Overview

After loading a file, a summary card shows key metrics with an activity sparkline. Format and model are auto-detected. Press Space or click **Dive In** to enter the timeline.

<div align="center">
<img src="docs/screenshots/session-hero.png" alt="Session Hero" width="700" />
</div>

### Replay View

Chronological event stream with a resizable inspector sidebar. Click any event to see full details, raw JSON, and tool inputs. The colorful timeline bar at top shows event density and error locations.

<div align="center">
<img src="docs/screenshots/replay-view.png" alt="Replay View" width="800" />
</div>

### Tracks View

DAW-style multi-track lanes for Reasoning, Tool Calls, Context, and Output. Solo (**S**) isolates one track. Mute (**M**) hides it. See at a glance how your agent's time was spent.

<div align="center">
<img src="docs/screenshots/tracks-view.png" alt="Tracks View" width="800" />
</div>

### Waterfall View

Gantt-style timeline of every tool call, sorted by start time with nesting for overlapping calls. Hover any bar to see duration and timing. Click to open the full inspector, including inline diffs for file edits.

### Stats View

Aggregate metrics, event distribution bars, tool usage ranking, and a per-turn summary. Quickly spot which tools dominate a session and where errors occurred.

<div align="center">
<img src="docs/screenshots/stats-view.png" alt="Stats View" width="800" />
</div>

### More Features

| Feature | Description |
|---------|-------------|
| **Search** | Full-text search across events, tools, and agents. Matches highlighted in real time. |
| **Command Palette** | `Cmd+K` fuzzy search to jump to any turn, event, or view instantly. |
| **Error Navigation** | Auto-detects errors from flags and text patterns. Jump with `E` / `Shift+E`. |
| **Track Filters** | Toggle visibility per track type with filter chips in the header. |
| **Playback Control** | Play/pause with variable speed (0.5x to 8x). Seek with arrow keys. |
| **Diff Viewer** | Inline unified diff with dual-gutter line numbers for file-editing tool calls. |
| **Token and Cost Tracking** | Per-turn token usage with estimated USD cost for Claude models. |
| **Auto-detect Format** | Supports Claude Code and Copilot CLI JSONL. Format detected from first line. |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `Left` / `Right` | Seek 2 seconds |
| `1` / `2` / `3` / `4` | Switch view (Replay / Tracks / Waterfall / Stats) |
| `/` | Focus search |
| `E` / `Shift+E` | Next / Previous error |
| `Cmd+K` | Command palette |
| `Enter` / `Shift+Enter` | Next / Previous search match |

## Supported Formats

| Format | File type | Auto-detected by |
|--------|-----------|-----------------|
| Claude Code | `.jsonl` from `~/.claude/projects/` | Default fallback |
| Copilot CLI | `.jsonl` event traces | `session.start` with `producer: "copilot-agent"` |

More formats planned: LangSmith traces, OpenTelemetry spans.

## Architecture

```
src/
  App.jsx                # Main orchestrator: file loading, playback, view routing
  hooks/
    usePlayback.js       # Play/pause, speed, seek state machine
    useSearch.js         # Debounced full-text search with match highlighting
    useKeyboardShortcuts.js  # Centralized keyboard handler
    useSessionLoader.js  # File parsing, format detection, session reset
    usePersistentState.js    # localStorage-backed useState with debounced writes
  lib/
    parseSession.js      # Auto-detect format router
    parser.js            # Claude Code JSONL parser
    copilotCliParser.js  # Copilot CLI JSONL parser
    session.js           # Pure helpers: getSessionTotal, buildFilteredEventEntries
    theme.js             # "Midnight Circuit" design tokens
    constants.js         # Sample events for demo mode
    replayLayout.js      # Virtualized windowing for large sessions
    commandPalette.js    # Precomputed fuzzy search index
    diffUtils.js         # Diff detection and Myers line diff algorithm
    waterfall.js         # Waterfall view helpers: item building, stats, layout
    pricing.js           # Claude model pricing table and cost estimation
  components/
    ReplayView.jsx       # Windowed event stream + inspector sidebar
    TracksView.jsx       # DAW-style multi-track timeline
    WaterfallView.jsx    # Tool execution waterfall with nesting and inspector
    StatsView.jsx        # Aggregate metrics and tool ranking
    SessionHero.jsx      # Post-load summary card with sparkline
    CommandPalette.jsx   # Cmd+K fuzzy search overlay
    Timeline.jsx         # Scrubable playback bar with event markers
    DiffViewer.jsx       # Inline unified diff for file-editing tool calls
    SyntaxHighlight.jsx  # Lightweight code syntax coloring for raw data
    ResizablePanel.jsx   # Drag-to-resize split panel utility
    FileUploader.jsx     # Drag-and-drop file input with error handling
    ErrorBoundary.jsx    # React error boundary with resetKey for recovery
    Icon.jsx             # SVG icon component
```

### Parser API

`parseSession(text)` auto-detects the format and returns a normalized structure:

```js
// Every event has the same shape regardless of source format
{ t, agent, track, text, duration, intensity, toolName?, toolInput?, raw, turnIndex, isError, model?, tokenUsage? }

// Turns group events by conversation round
{ index, startTime, endTime, eventIndices, userMessage, toolCount, hasError }

// Session-level stats
{ totalEvents, totalTurns, totalToolCalls, errorCount, duration, models, primaryModel, tokenUsage }
```

## Development

```bash
npm run dev         # Dev server on port 3000
npm run build       # Production build to dist/
npm test            # Run all tests via Vitest
npm run test:watch  # Watch mode
```

### Design System

The design uses a true black base with blue, purple, grey, and teal accents. All colors are defined as design tokens in `src/lib/theme.js`. JetBrains Mono throughout. No CSS framework; all styles are inline.

## Contributing

Contributions are welcome! Here are some areas where help is appreciated:

- **New parsers**: LangSmith, OpenTelemetry, custom agent frameworks
- **Visualizations**: Flame chart view, conversation flow graph
- **Features**: Bookmarks/annotations, session comparison, live streaming mode
- **CLI launcher**: `npx agentviz session.jsonl`

Please open an issue to discuss larger changes before submitting a PR.

## Roadmap

- [x] Token count tracking and cost estimation per turn
- [x] Tool execution waterfall / flame chart view
- [x] Inline diff viewer for file-editing tool calls
- [ ] Conversation flow graph (directed graph of turns and decisions)
- [ ] Bookmarks and annotations (persisted to localStorage)
- [ ] Multi-agent hierarchy (parent/child agents, nested tracks)
- [ ] Live streaming mode (tail a session file in real time)
- [ ] CLI launcher: `npx agentviz session.jsonl`
- [ ] Shareable session URLs
- [ ] Vim-style keyboard navigation

## License

MIT
