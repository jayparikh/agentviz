# AgentViz

Session replay visualizer for AI agent workflows. Drop in a Claude Code session file and scrub through the agent's reasoning, tool calls, and output in an interactive timeline.

## Quick Start

```bash
npm install
npm run dev
```

Opens at http://localhost:3000. Drop a `.jsonl` file or click "Load Demo Session."

## Finding Session Data

```bash
# List your Claude Code projects
ls ~/.claude/projects/

# Grab any .jsonl file from a project folder
# These are full session transcripts with tool calls, reasoning, and output
```

## Views

**Replay** - Chronological event stream. Click any event to inspect raw JSON. Shows tool usage counts and session stats in the sidebar.

**Tracks** - DAW-style lanes for Reasoning, Tool Calls, Context, and Output. Solo (S) isolates one track. Mute (M) hides it. Hover any block for detail.

**Stats** - Aggregate metrics: event count cards, track distribution bars, tool usage ranking.

## Keyboard Shortcuts

- `Space` - Play / Pause
- `Left/Right Arrow` - Seek 2s
- `1` / `2` / `3` - Switch view

## Adding Parsers

Edit `src/lib/parser.js`. Each parser converts raw input to normalized events:

```js
{ t, agent, track, text, duration, intensity, toolName?, toolInput?, raw }
```

Stub exports for Copilot and LangSmith parsers are noted in the file.
