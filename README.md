<div align="center">

# ◇ AGENTVIZ

**See what your AI agents actually do.**

Drop a Claude Code, Codex, VS Code Copilot Chat, Copilot CLI, Copilot prompt export, or ATIF / Harbor session file and review the run as a workflow: find the session, triage health, investigate evidence, analyze behavior, compare approaches, and improve the next prompt or configuration. Or run it from the CLI for a live view that updates as your session unfolds.

[![CI](https://github.com/jayparikh/agentviz/actions/workflows/ci.yml/badge.svg)](https://github.com/jayparikh/agentviz/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/agentviz?color=blue&logo=npm)](https://www.npmjs.com/package/agentviz)
![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

<br />

<img src="docs/screenshots/session-hero.png" alt="AGENTVIZ workflow review" width="800" />

*Start in Review, then move through Investigate, Analyze, Compare, and Improve to inspect the same session from every angle.*

</div>

---

## Why AGENTVIZ?

AI coding agents (Claude Code, Codex, VS Code Copilot Chat, Copilot CLI, ATIF / Harbor, etc.) generate dense session logs, but reading raw JSONL is painful. AGENTVIZ turns those logs into something you can actually explore. Copilot CLI replays also surface the effective reasoning effort and any mid-session changes:

- **Replay** sessions like a video, stepping through each tool call and reasoning step
- **Trace** decision flow in a graph view with expandable turn and tool-call structure
- **Visualize** timing and concurrency in tracks and waterfall timelines
- **Analyze** tool usage patterns, error rates, and model behavior at a glance
- **Inspect cost** with per-call token spend, cache reads/writes, context composition, and cache-miss warnings
- **Debug** failures by jumping directly between errors with one keystroke
- **Stream live** as a session unfolds -- the view updates in real time
- **Discover sessions** automatically from Claude Code, Codex, Copilot CLI, and VS Code Copilot Chat stores
- **Get AI coaching** on prompt engineering, skills, and MCP setup grounded in best practices
- **Switch themes** between dark, light, and system-matched modes with one click
- **Use one workflow**: Find, Review, Investigate, Analyze, Compare, Improve
- **Follow exact evidence** from command-palette events/turns and Review insights into Investigate or Waterfall, including equal-time events and offscreen rows. Playback and search survive workflow switches.
- **Keep findings** with event bookmarks and plain-text notes in Investigate, exact-event navigation, local persistence, and portable HTML/JSON backups.
- **Recover failed imports** with visible loading, read/parse errors, retry, and reimport actions. Find opens Review only after parsing succeeds; failed or superseded loads do not replace the last successful session.

## Quick Start

```bash
npx agentviz
```

Opens AGENTVIZ in your browser. The default workflow UI starts in **Find**, where you can drop a `.jsonl` or `.json` session file or click **Load a demo session** to try it instantly. Claude Code, Codex, Copilot CLI, and VS Code Copilot Chat sessions are auto-discovered.

### CLI (live streaming)

```bash
npx agentviz ~/.claude/projects/my-project/session.jsonl

# Or pass a directory -- opens the most recently modified .jsonl inside it
npx agentviz ~/.claude/projects/my-project/
```

The browser opens with a pulsing **LIVE** badge. As Claude Code writes new events to the session file, they stream into the view in real time via SSE, including records that are written incrementally before the trailing newline lands.

Live JSONL snapshots use `/api/file?live=1`, which returns only newline-complete records and a byte-boundary cursor. `/api/stream?cursor=...` catches up from that boundary, including appends before subscription; SSE event IDs resume reconnects and reset messages replace truncated content. Plain `/api/file` still returns the full file. Codex appends use the same record parser and tool-result pairing as full imports.

### CLI (self-contained manifest export)

Generate a single HTML file from a static manifest and its local session files:

```bash
npx agentviz export --manifest ./data/manifest.json --out ./agentviz-report.html
```

The output embeds the AGENTVIZ app, the manifest, and all referenced JSONL sessions. It can be opened directly from disk without running a local web server. Manifest session URLs must be local paths relative to the manifest file; remote URLs are rejected because they cannot be embedded.

### Finding your session files

```bash
# Claude Code sessions
ls ~/.claude/projects/

# Copilot CLI sessions
ls ~/.copilot/session-state/
# Each subdirectory is a session UUID containing an events.jsonl file

# Codex sessions
ls ~/.codex/sessions/
# Rollout logs live under YYYY/MM/DD/rollout-*.jsonl
```

VS Code Copilot Chat sessions live under your VS Code `workspaceStorage/*/chatSessions/` directories. The exact parent path depends on your OS and whether you use the stable or Insiders build.

## MCP Integration

AGENTVIZ ships as an MCP server so you can open it directly from Claude Code or GitHub Copilot in VS Code without leaving your workflow. Both agents use the same `launch_agentviz` and `close_agentviz` tools.

### Claude Code

**Setup (one time):**

```bash
claude mcp add --scope user agentviz node /path/to/agentviz/mcp/server.js
```

This registers the server globally across all projects. Restart Claude Code to pick it up.

**Usage:** In any session, just ask:

> "Open agentviz" or "Show me the live view"

### GitHub Copilot in VS Code

**Setup:** Add the server to your VS Code user settings (`settings.json`) for global access across all projects:

```json
{
  "mcp": {
    "servers": {
      "agentviz": {
        "type": "stdio",
        "command": "node",
        "args": ["/path/to/agentviz/mcp/server.js"]
      }
    }
  }
}
```

Or scope it to a single project by creating `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "agentviz": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/agentviz/mcp/server.js"]
    }
  }
}
```

Reload VS Code after adding the config. In Copilot Chat, use **Agent mode** and ask:

> "Open agentviz" or "Launch the live view"

### What happens when you invoke it

`launch_agentviz` will:

1. Auto-detect the most recently active session file from Claude Code, Codex, Copilot CLI, or VS Code Copilot Chat storage
2. Start a local HTTP server on a free port
3. Open the browser with live streaming enabled

To stop it, ask: "Close agentviz"

### Available MCP tools

| Tool | Description |
|------|-------------|
| `launch_agentviz` | Start the server and open the browser. Accepts an optional `session_file` path. |
| `close_agentviz` | Stop a running server. Accepts an optional `port`; omit to stop all. |

## Find and AI Coach

When running via the CLI, AGENTVIZ automatically discovers recent Claude Code, Codex, Copilot CLI, and VS Code Copilot Chat sessions in Find. Switch between list and grid, sort by recency, review priority, cost, or activity, filter by client or tags, and open a run.

Each loaded session can get an AI Coach analysis powered by the `@github/copilot-sdk` (gpt-4o). The coach reads your actual project config (`.github/copilot-instructions.md`, skills, MCP servers) and produces actionable recommendations for prompts, skills, and tooling setup. Recommendations can be applied directly with one click.

## Workflow UI

AGENTVIZ has one task-oriented workflow shell, backed by shared parsers and session state:

| Zone | Purpose |
|------|---------|
| Find | Unified session portfolio with search, filters, layout toggle, tags, import, demo, refresh, and multi-select compare |
| Review | Health score, summary cards, top tools, and evidence-linked insights |
| Investigate | Replay evidence stream with bookmarks, event notes, and contextual Analyze, Compare, Ask, and Coach actions |
| Analyze | Existing Stats, Tracks, Waterfall, Graph, and Cost views as sub-panels |
| Compare | Inline comparison using the existing scorecard and tools chart |
| Improve | Coach recommendations, next-run checklist, and Session Q&A |

The redesign changes the top-level model from visualization tabs to user jobs. Instead of choosing between Replay, Tracks, Waterfall, Graph, Stats, Cost, and Coach up front, you start with a health-oriented Review, follow evidence in Investigate, open deeper Analyze panels only when needed, and turn the run into next-run improvements from Improve.

The visualizations remain available in these workflow homes:

| Visualization | Workflow home |
|--------------------|-----------------------|
| Replay | Investigate |
| Tracks | Analyze -> Tracks |
| Waterfall | Analyze -> Waterfall |
| Graph | Analyze -> Graph |
| Stats | Analyze -> Stats |
| Cost | Analyze -> Cost |
| Coach | Improve |
| Compare | Compare, or Find multi-select |

Classic UI and its toggle, recent-session dropdown, direct A/B upload screen, and human/idle sort modes have been retired. Import files in Find and select two runs to compare. Existing `#/v2/...` links, workflow preferences, and the `agentviz:session-library:v1` / `agentviz:session-content:v1:*` storage schemas are unchanged. Obsolete shell preferences are ignored; old `#/` and `#/session` links fall back to Find.

**Close session** clears the active session, comparison, playback, and Q&A, stops viewer-side live updates, and returns to Find. It does not delete saved runs or preferences, or stop the agent/server. Navigating to Find without closing retains the active session.
Close also works before a live stream produces its first event. The bottom transport's speed menu opens upward so every speed remains reachable on desktop and compact screens.

**Local save status** is separate from loading a session. Each active A/B transcript shows whether its latest snapshot is saved locally. Storage access, quota, and session-index failures do not prevent replay or comparison: use **Retry saving** or **Download transcript** to recover the active raw file before closing. A failed live content write keeps any earlier cached snapshot and its metadata, but does not label the latest events as saved. Index-write failures attempt to restore the earlier content and report restoration failures too. When quota eviction removes older cached transcripts, a notice identifies the number removed; reopen discovered sources or reimport those files. Refresh rechecks cached availability. A damaged index is reported, never silently replaced.

### Bookmarks and event notes

In **Investigate**, select an event and choose **Bookmark event** or **Add note**.
Each event has one bookmark with an optional plain-text note (up to 20,000 characters).
Use **Save note** to persist, or **Cancel note** to discard the draft. **Remove bookmark
and note** deletes both; saving an empty note keeps the bookmark.

The **Bookmarks** toggle opens a compact list. Jump targets use original event indices,
including index zero and events with identical timestamps. Saved findings survive Close,
browser reload, and reopening the same session. Drafts survive zone changes and failed
loads, but are not automatically saved: save or download them before replacement, Close,
or reload. Findings are separate from the raw transcript and cannot prevent transcript saving.

Live appends preserve matching anchors. Truncated, reordered, or changed evidence is
retained in the list as **Unavailable in this snapshot**, never reassigned by timestamp.
Sessions with explicit IDs share findings across snapshots; renamed imports and foreign
discovery paths do not change that identity. Without an explicit ID, JSONL identity uses
its first complete source record; standalone JSON documents use their content. Identical
copied source identities cannot be distinguished, and changed inferred identities may
require the original snapshot to recover findings.

Storage failures keep edits in memory and show recovery controls above the workspace.
**Retry findings save** retries without touching the transcript. **Download findings**
backs up bookmarks, unavailable findings, and note drafts as JSON without needing the
production bundle or working storage. **Restore findings** validates the session and exact
transcript snapshot, then asks before replacing its findings. Corrupt stores are never
silently overwritten. Conflicting edits to the same finding require downloading edits and
explicitly reloading the saved copy; independent findings from A/B views can merge.

## Session Comparison

Load two agent traces side by side to compare them head to head. Great for benchmarking Claude Code vs Copilot CLI on the same task, or comparing two different prompting strategies.

### Entry points

- **Find zone** -- select two sessions and click **Compare selected**
- **Compare zone** -- choose a saved candidate to compare with the current imported run

### Scorecard tab

Side-by-side metrics with delta badges:

| Metric | Delta color |
|--------|-------------|
| Duration | Green = A faster |
| Cost / Credits | Green = A cheaper when units match (delta suppressed for cross-agent comparisons since units differ) |
| Input / Output tokens | Neutral |
| Cache reads / writes | Neutral (shown only when cache data present) |
| Cache hit rate | Neutral (shown only when cache data present) |
| Tool calls | Neutral |
| Errors | Green = A has fewer |
| Turns | Neutral |
| Files touched | Neutral |

### Tools tab

Horizontal bar chart showing tool call counts for both sessions on the same axis. Blue bars = Session A, purple bars = Session B.

### Export

Click **Export** in the workflow header or comparison header to download a single self-contained `.html` file. Share it with anyone, no server required. Opening it restores the session or comparison for offline investigation.

Exports include the active session's bookmarks, notes, and unsaved note drafts, separately
for A and B. Review notes before sharing. Embedded findings take precedence over unrelated
local notes; edits to that exact export use an isolated local namespace, including saved
deletions. Legacy exports without findings still open. Invalid or foreign findings are
reported without replacing transcript data. In offline viewers, use **Download findings**
to back up new edits; generating another HTML export requires the production server.

Export is available in two places:

- **Single session header** -- exports the current session
- **Comparison header** -- exports both sessions and the full comparison view

> Export requires the production build (`npm run build`). It is not available in the Vite dev server.

The exported file is fully portable: every chunk is embedded as source and instantiated from `blob:` URLs at boot, so nothing is fetched from the machine that produced it. The payload is gzip-compressed, fonts fall back to the local monospace stack, and all `/api/*` calls are answered inside the file (backend-only features such as Coach analysis return an explicit "Not available in exported view" response). If a browser cannot start the viewer, the file renders a readable failure message with compatibility hints instead of a blank page.

Recipients need Chrome 80+, Edge 80+, Firefox 113+, or Safari 16.4+. Portability is enforced by `tests/e2e/export-portability.spec.js`, which opens a generated export from `file://` with all network access blocked (`npm run test:e2e:export`).

---

## Features

### Find and Review

The default entry point is a session portfolio for import, demo loading, auto-discovered sessions, filters, tags, and multi-select compare. Opening a session lands in Review with health scoring, evidence-linked insights, top tools, and data-readiness checks.

<div align="center">
<img src="docs/screenshots/landing.png" alt="Landing View" width="800" />
</div>

### Investigate

Investigate wraps the chronological replay stream with search, next/previous match navigation, user-only and error-only modes, track filters, contextual Analyze/Compare/Improve actions, and a resizable inspector sidebar. The user-only filter works across every supported trace format through the normalized `user` agent. Press Enter or Shift+Enter in evidence search, or use the adjacent arrow controls, to move between matches. Click any event to see full details plus a payload inspector with readable JSON or text, top-level keys, line and character counts, copy support, and expand or collapse controls. Codex Session Info identifies user threads and named subagent traces.

<div align="center">
<img src="docs/screenshots/replay-view.png" alt="Replay View" width="800" />
</div>

### Analyze: Tracks

Tracks memoizes static geometry and groups dense overviews into at most 200 marks per lane. Select a group to inspect every original event in pages of 50; error groups remain marked and the playhead updates independently.

Evidence controls support keyboard and touch: Tracks uses one tab stop per lane with arrow-key browsing; Graph uses one keyboard entry with Up/Down to browse and Right/Left to expand/collapse. Replay stacks the inspector below the stream on compact screens. Its separator supports pointer dragging, arrow keys, Home and End, and remeasures wrapping rows on pane resize.

The header's explicit **Reading density** preference switches between normal and comfortable evidence text and spacing without enlarging all dashboard surfaces. Both themes now use readable small-text tokens (at least 4.5:1 on neutral surfaces). Empty Find prioritizes importing a real JSON/JSONL session; demos remain secondary.

Live streams normalize incrementally in a dedicated worker with one in-flight batch and coalesced appends. Claude Code, Copilot CLI, Codex, and VS Code JSONL retain normalization state and update new or affected records, including earlier tool results, cumulative usage, and lifecycle metadata. Ordinary appends do not traverse historical records or rebuild historical turns. Timestamp rebases and structural edits update the affected timeline; snapshot copying, worker transfer, and rendering still scale with session size. See [live normalization contracts and measurements](docs/live-normalization.md). Discovery uses asynchronous, eight-operation traversal, newest-first enrichment, and a bounded path/mtime/size preview cache, including companion metadata invalidation.

Discovery preview reads are asynchronous and capped at 128 KiB (Codex), 64 KiB (CLI), or 2 KiB head plus tail (VS Code). Deep evidence jumps keep the selected row in view while measured heights settle, then yield to manual scrolling.

DAW-style multi-track lanes for Reasoning, Tool calls, Context, and Output. **Solo** isolates one track. **Mute** hides it. See at a glance how your agent's time was spent.

<div align="center">
<img src="docs/screenshots/tracks-view.png" alt="Tracks View" width="800" />
</div>

### Analyze: Waterfall

Gantt-style timeline of every tool call, sorted by start time with nesting for overlapping calls. Hover any bar to see duration and timing. Click to open the full inspector, including inline diffs for file edits and readable input or result payload previews.

<div align="center">
<img src="docs/screenshots/waterfall-view.png" alt="Waterfall View" width="800" />
</div>

### Analyze: Graph

Interactive directed graph of session turns with expandable tool-call structure. When a turn spawns parallel subagents, the graph automatically forks into side-by-side agent branches and rejoins at a diamond join node, visualizing concurrency without any interaction. Double-click any turn to open its internal tool flow, pan and zoom around the graph, and follow playback as active nodes light up and future nodes fade back.

<div align="center">
<img src="docs/screenshots/graph-view.png" alt="Graph View" width="800" />
</div>

### Analyze: Stats

Aggregate metrics, event distribution bars, tools used ranking, and a per-turn summary. Includes token counts, estimated USD cost per turn using each request's model and context tier, and per-turn cache hit rate summaries when prompt caching data is available. The cache write segment is omitted when it is zero.

A **Tools &amp; Skills** panel surfaces every skill, instruction file, custom agent, MCP server, built-in tool, and prompt that appeared in the session. Each entry shows its lifecycle stage (Discovered &rarr; Loaded &rarr; Invoked &rarr; Resources &rarr; Completed or Errored) as a mini progress bar, its invocation count, and its source (project / personal / extension / built-in / MCP). Click any row to expand its full event timeline. Filter by category (Skills, Instructions, Agents, Tools, MCP, Prompts) or click a source chip to isolate entries from that origin.

<div align="center">
<img src="docs/screenshots/stats-view.png" alt="Stats View" width="800" />
</div>

### Analyze: Cost

Per-call token spend, cache read/write usage, context composition, and cumulative cost for sessions with token usage. Copilot CLI sessions report usage-based AI Credits, shown with the USD equivalent (1 credit = $0.01); token-based USD estimates are used as a fallback for older logs when pricing is recognized. Copilot prompt exports include prompt context breakdowns so the view can highlight fresh input spikes, cache misses, tool schema growth, and which parts of the prompt are filling the context window.

**Pricing evidence:** Reported USD and AI Credits remain authoritative and separate from token estimates. Per-model reported credits are never redistributed according to estimated prices. Unknown models, ambiguous context tiers, and aggregate-only totals that could span multiple pricing tiers display `--`, not a zero-dollar bill. Aggregate input is not a request length or a peak context window. Stats, Review, Compare, Replay, Q&A, and saved-session summaries share this request-aware accounting.

GPT-5.6 and GPT-6 rates were verified on **2026-09-09** against [OpenAI pricing](https://developers.openai.com/api/docs/pricing) and [GitHub Copilot pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing). Standard USD per million tokens:

| Model | Fresh input | Cache read | Cache write | Output |
| --- | ---: | ---: | ---: | ---: |
| GPT-5.6 Sol | $4 | $0.40 | $5 | $20 |
| GPT-5.6 Terra | $2 | $0.20 | $2.50 | $12 |
| GPT-5.6 Luna | $0.20 | $0.02 | $0.25 | $1.20 |
| GPT-6 Astra | $10 | $1 | $12.50 | $50 |

- Long context doubles all input buckets and multiplies output by 1.5 above 272,000 request input tokens for Sol, Terra, and Astra. The official Luna thresholds differ: Copilot uses **>200,000**, while the [OpenAI Luna model page](https://developers.openai.com/api/docs/models/gpt-5.6-luna) uses **>272,000**. Unknown billing providers leave the disputed interval unpriced.
- Explicit Fast / `priority` pricing is 2x Standard; Batch and Flex are 0.5x for these four models. A response's actual `service_tier` takes precedence; reasoning effort never selects a price tier. Without tier evidence, the UI discloses the Standard assumption. Sol's published promotional rates apply at least through **November 21, 2026**; this is a dated reference table, not historical invoice reconstruction.
- Normalized input includes fresh, cached, and written tokens. A [cache write costs 1.25x input in total](https://developers.openai.com/api/docs/guides/prompt-caching), not an additional 1.25x surcharge. Reasoning tokens are already included in output.
- Codex reads [`cache_write_input_tokens`](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs) and uses `last_token_usage` only when it matches the cumulative checkpoint delta, deduplicating unchanged checkpoints in both batch and live parsing. Codex's `model_provider` is not proof of API billing versus a subscription, and its rollout turn context does not expose an actual response service tier.
- Prompt exports read official Responses `input_tokens_details.cache_write_tokens` and Chat Completions `prompt_tokens_details.cache_write_tokens`; Copilot CLI reads `usage.cacheWriteTokens` or `tokenDetails.cache_write.tokenCount`. Missing write counters are disclosed rather than inferred from fresh input. Estimates exclude unreported write premiums, regional uplifts, negotiated discounts, and non-token charges; consult reported billing for actual spend.

<div align="center">
<img src="docs/screenshots/cost-view.png" alt="Cost View" width="800" />
</div>

### Improve

AI-powered session coaching available directly from any session. Improve combines Coach recommendations, a copyable next-run prompt, prompt/skill/MCP-tool/config checklist items, and Session Q&A. The coach reads your autonomy metrics, project config (`.github/copilot-instructions.md`, MCP servers, skills), and session patterns to produce evidence-backed recommendations for prompts, tooling, and workflow. Click **Analyze** to run, then accept or ignore each draft recommendation. Requires the CLI server -- run via `npx agentviz`, `npm start`, or the MCP tool.

<div align="center">
<img src="docs/screenshots/coach-view.png" alt="Coach View" width="800" />
</div>

### More Features

| Feature | Description |
|---------|-------------|
| **Live Streaming** | CLI mode tails a session file via SSE. View updates in real time as events arrive, including newline-delayed JSONL writes from Claude Code. |
| **Payload Inspector** | Replay and waterfall inspectors show readable JSON or text previews with key summaries, counts, copy, and expand controls. |
| **Graph View** | Directed turn-flow graph with fork/join DAG for parallel subagents, expandable tool-call nodes, pan/zoom, and playback-aware highlighting. |
| **Token and Cost Tracking** | Per-turn and per-call token usage with estimated USD cost for Claude and OpenAI/Copilot models, plus reported AI Credits (with USD equivalent) for Copilot CLI logs. |
| **Search** | Full-text search across events, tools, and agents. Matches highlighted in real time. |
| **Command Palette** | `Cmd+K` / `Ctrl+K` searches events, turns, workflow zones, Analyze panels, failed tool calls, comparison, and Q&A. |
| **Error Navigation** | Auto-detects errors from flags and text patterns. Jump with `E` / `Shift+E`. |
| **Track Filters** | Toggle visibility per track type with filter chips in the header. |
| **Playback Control** | Investigate and Analyze share play/pause, speed (0.5x, 1x, 2x, 4x, 8x), and a keyboard-operable Timeline with turn, event, and search markers. Time and speed survive zone switches. Live streams omit play/speed controls. |
| **Diff Viewer** | Inline unified diff with dual-gutter line numbers for file-editing tool calls. |
| **Auto-detect Format** | Supports Claude Code JSONL, Codex rollout JSONL, Copilot CLI JSONL, VS Code Copilot Chat JSON or JSONL, Copilot prompt export JSON, and ATIF / Harbor trajectory JSON. Auto-detected. |
| **Session Comparison** | Load two traces side by side. Scorecard and tool-usage chart with delta badges. |
| **HTML Export** | One-click export of any session or comparison to a self-contained shareable `.html` file. |
| **Find Auto-discovery** | Automatically finds recent Claude Code, Codex, Copilot CLI, and VS Code Copilot Chat sessions; choose review priority or recency sorting. |
| **Find Refresh** | Rescan session directories with a one-click refresh button. Reconciles evicted content and prunes dead entries. |
| **File Path Tooltips** | Hover over Find session rows to see the full file path or reconstructed session location. Opened sessions loaded from discovery or CLI expose a header path control for copying the source path. |
| **Static Manifest Mode** | Deploy as a pure static site with `?manifest=URL` pointing to a JSON manifest of sessions. Tag-based filtering, no backend required. |
| **AI Coach** | Agentic analysis powered by Copilot SDK. Recommends prompts, skills, and MCP config with one-click apply. |
| **Session Q&A** | Slide-over drawer (`Cmd/Ctrl+Shift+K` or Improve) with instant answers and Copilot SDK fallback. Messages and drafts survive zone changes and close/reopen. |
| **Skills and Capability Tracking** | Stats View surfaces every skill, instruction, agent, MCP server, tool, and prompt from the session with lifecycle stage bars, invocation counts, source chips, and expandable event timelines. Filter by category or source. |
| **Autonomy Metrics** | Measures human response time, idle gaps, and intervention frequency per session. |
| **Dark / Light / System Theme** | Full dark and light palettes with a one-click switcher in the header. System mode auto-follows OS preference. Preference is persisted across sessions. |

### Session Q&A

Open the drawer with `Cmd+Shift+K` (or via the command palette). Questions are routed through a two-tier system:

1. **Instant answers** -- a local classifier matches 9 common patterns and responds immediately from session data, with no API call:

   | Pattern | Example question |
   |---------|-----------------|
   | Tool count | "how many tool calls?" |
   | Errors | "were there any errors?" |
   | Duration | "how long did this take?" |
   | Models | "what model was used?" |
   | Turns | "how many turns?" |
   | Longest tool | "which tool took the longest?" |
   | Cost | "how much did this cost?" |
   | File edits | "what files were edited?" |
   | Summary | "summarize this session" |

2. **Model fallback** -- anything the classifier can't match is sent to the Copilot SDK (configurable model, see [Configuration](#configuration)) with full session context for an AI-generated answer.

Q&A is available for completed sessions without a feature flag. Conversation and input drafts reset only on successful session replacement or Close session, not on failed loads or live appends. Closing the drawer retains the draft; session disposal aborts streaming answers.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause in Investigate or Analyze |
| `Left` / `Right` | Seek 2 seconds in Investigate or Analyze |
| `1` / `2` / `3` / `4` / `5` / `6` | Find / Review / Investigate / Analyze / Compare / Improve |
| `7` | Improve (compatibility alias) |
| `/` | Focus Find or Investigate search |
| `E` / `Shift+E` | Next / Previous error |
| `Cmd+K` / `Ctrl+K` | Command palette |
| `Cmd+Shift+K` / `Ctrl+Shift+K` | Open Session Q&A |
| `Enter` / `Shift+Enter` | Next / Previous search match |
| `?` | Open keyboard shortcuts dialog |
| Timeline arrows / `Home` / `End` | Seek through mapped timeline / start / end |

Shortcuts preserve browser modifiers, editable inputs, native button activation, Graph/Tracks navigation, separators, and modal controls. Pressing the old Coach shortcut `7` opens Improve and shows a migration notice. Help, palette, and Q&A trap focus and close with Escape.

Modals, drawers, and overlay panels render keyboard hints with a shared `<kbd>` badge treatment so close, navigate, and select affordances read consistently across AGENTVIZ.

## Supported Formats

| Format | File type | Auto-detected by |
|--------|-----------|-----------------|
| Claude Code | `.jsonl` from `~/.claude/projects/` | Default fallback |
| Codex | `.jsonl` rollout logs from `~/.codex/sessions/YYYY/MM/DD/` | `session_meta` with Codex origin metadata |
| VS Code Copilot Chat | `.json` or `.jsonl` from VS Code `workspaceStorage/*/chatSessions/` | `version` + `requests` + `sessionId` fields |
| Copilot CLI | `.jsonl` event traces | `session.start` with `producer: "copilot-agent"` |
| Copilot prompt export | `.json` prompt export arrays or wrappers | Prompt calls with `request.messages` and `response.usage` |
| ATIF / Harbor | `.json` trajectory from the Harbor framework | Top-level `schema_version: "ATIF-v1.6"` with `agent` and `steps` |

Codex sessions are discovered from rollout logs only. AGENTVIZ intentionally ignores `~/.codex/history.jsonl`, sqlite logs, auth/config files, caches, shell snapshots, and plugin temp data.

ATIF (Agent Trajectory Interchange Format) sessions are loaded via drag-and-drop, a positional CLI path, or `?manifest=` URLs. Auto-discovery is not wired up because Harbor has no canonical output directory.

More formats planned -- see [Roadmap](#roadmap).

## Static Manifest Mode

Deploy AGENTVIZ as a pure static site with pre-populated sessions -- no backend required. Pass a `?manifest=` query parameter pointing to a JSON manifest:

```
https://example.com/replay/?manifest=sessions/manifest.json
https://example.com/replay/?manifest=https://cdn.example.com/data/manifest.json
https://example.com/replay/?manifest=sessions/manifest.json&tag=nightly&tag=dotnet
```

The manifest lists sessions with display names, relative URLs, and freeform tags:

```json
{
  "generated": "2026-03-31T00:00:00Z",
  "sessions": [
    {
      "id": "build-analysis-1",
      "name": "MSBuild: Build + binlog (skilled)",
      "url": "skilled-build.jsonl",
      "tags": ["dotnet-msbuild", "build-failure-analysis", "skilled"],
      "mtime": 1743400000000
    }
  ]
}
```

Session URLs are resolved relative to the manifest location. Tags appear as filter chips in the inbox (AND logic). Pre-apply filters with `&tag=X` query params.

To package a static manifest deployment as one shareable file instead of hosting the manifest and JSONL files, run:

```bash
npx agentviz export --manifest ./data/manifest.json --out ./agentviz-report.html
```

## Architecture

```
src/
  App.jsx                # Workflow-only mount, theme/density wiring and chunk recovery
  AppV2.jsx              # Default workflow shell: Find, Review, Investigate, Analyze, Compare, Improve
  main.jsx               # React entry point
  contexts/
    SessionProvider.jsx  # Shared session loading, discovery, compare, live, export, and derived state
    PlaybackContext.jsx  # Session-scoped playback/search/filter provider shared across v2 zones
  hooks/
    usePlayback.js       # Play/pause, speed, seek state machine
    useSearch.js         # Debounced full-text search with match highlighting
    useKeyboardShortcuts.js  # Centralized keyboard handler
    useSessionLoader.js  # Transactional parsing, completion signaling, live snapshot bootstrap, session reset
    useFindings.js       # Session findings and drafts, persistence, conflict recovery and export payloads
    useQA.js             # Session Q&A state: messages, classifier, SSE streaming, abort
    useLiveStream.js     # Cursor-resumable SSE hook with 500ms debounce and reset handling
    usePersistentState.js    # localStorage-backed useState with debounced writes
    useDiscoveredSessions.js # Auto-discovery via /api/sessions or ?manifest= URL
    useAsyncStatus.js    # Async operation state machine (idle/loading/success/error)
    useBreakpoint.js     # Shared compact/narrow/wide responsive breakpoint hook
    useFocusTrap.js      # Modal focus trap with Escape close and focus restoration
    useReducedMotion.js  # Shared prefers-reduced-motion hook for inline/SVG animation guards
  lib/
    parseSession.ts      # Auto-detect format router
    parser.ts            # Claude Code JSONL parser
    codexParser.ts       # Codex rollout JSONL parser
    copilotCliParser.ts  # Copilot CLI JSONL parser
    copilotCostParser.ts # Copilot prompt export JSON parser for token/cost analysis
    vscodeSessionParser.ts # VS Code Copilot Chat JSON parser
    atifParser.ts        # ATIF / Harbor trajectory JSON parser
    liveSessionParser.ts # Incremental records, retained normalizers, immutable publication
    liveNormalization.ts # Indexed aggregates, tool pairing, and affected-turn helpers
    liveClaudeNormalizer.ts # Timestamp, cumulative usage, and boundary-duration state
    liveCopilotNormalizer.ts # Indexed tool/lifecycle dependencies and turn aggregates
    liveCodexNormalizer.ts # Stateful emission, cumulative usage, and indexed turns
    liveVSCodeNormalizer.ts # Owned patch tree, request caches, and local part updates
    liveSessionWorker.ts # Off-main-thread live normalization
    liveParserClient.js  # Single-flight worker, coalescing, resets and disposal
    tracksLayout.js      # Bounded overview geometry retaining original evidence
    dataInspector.js     # Payload summary and preview helpers for inspector panels
    session.ts           # Pure helpers: getSessionTotal, buildFilteredEventEntries
    sessionLibrary.js    # localStorage snapshots, save failures and quota eviction reporting
    findings.ts          # Session identities, guarded event anchors, validation and independent storage
    downloadText.ts      # Shared raw transcript and HTML download primitive
    sessionParsing.ts    # Session parsing utilities and types
    sessionTypes.ts      # TypeScript type definitions for session data
    cacheMetrics.ts      # Shared cache hit rate helpers
    skillExtractor.ts    # Skill/capability lifecycle extractor: skills, instructions, agents, MCP servers, tools, prompts
    autonomyMetrics.js   # Human response time, idle gaps, intervention scoring
    projectConfig.js     # Project config surface detection (CLAUDE.md, .github/, etc.)
    aiCoachAgent.js      # AI Coach powered by @github/copilot-sdk (gpt-4o)
    qaClassifier.js      # Session Q&A instant answer classifier + model context
    qaAgent.js           # Q&A agent powered by @github/copilot-sdk for model fallback
    theme.js             # Design tokens (dark/light/system mode-aware palette)
    theme.d.ts           # TypeScript declarations for theme.js
    constants.js         # Sample events for demo mode
    replayLayout.js      # Virtualized windowing for large sessions
    commandPalette.js    # Indexed event/turn search and workflow zone/panel commands
    searchIndex.js       # Precomputed lowercase search cache for event filtering
    diffUtils.js         # Diff detection and Myers line diff algorithm
    waterfall.ts         # Waterfall view helpers: item building, stats, layout
    graphLayout.js       # ELKjs graph builder, fork/join DAG for parallel agents, layout merger
    costAnalysis.js      # Shared request-aware estimates, reported charges, and evidence limitations
    pricing.js           # Model/tier/cache rates and nullable cost estimation
    pricing.d.ts         # TypeScript declarations for pricing.js
    exportHtml.js        # Self-contained HTML export for single sessions and comparisons
    headlessExport.js    # CLI/headless self-contained HTML export for static manifests
    formatTime.d.ts      # TypeScript declarations for formatTime.js
    formatTime.js        # Duration and date formatting utilities
    landingSessions.js   # Shared landing browser labels, filters, and format options
    lazyImport.js        # Dynamic import wrapper with stale-chunk reload recovery
    playbackUtils.js     # Playback state helpers
  components/
    DebriefView.jsx      # AI Coach panel with cached analysis (lazy-loaded)
    ReplayView.jsx       # Windowed event stream + inspector sidebar
    TracksView.jsx       # DAW-style multi-track timeline
    WaterfallView.jsx    # Tool execution waterfall with nesting and inspector
    GraphView.jsx        # Interactive turn graph with expandable tool-call nodes (lazy-loaded)
    StatsView.jsx        # Aggregate metrics, tool ranking, turn summary
    CostView.jsx         # Token spend, cache, and context-composition analysis
    CompareView.jsx      # Side-by-side session comparison (Scorecard + Tools tabs)
    CommandPalette.jsx   # Cmd+K fuzzy search overlay
    Timeline.jsx         # Scrubable playback bar with event markers
    DiffViewer.jsx       # Inline unified diff for file-editing tool calls
    DataInspector.jsx    # Readable payload inspector with summaries and copy support
    ShortcutsModal.jsx   # Keyboard shortcuts overlay
    QADrawer.jsx         # Session Q&A slide-over drawer with instant answers
    SyntaxHighlight.jsx  # Lightweight code syntax coloring for payload previews
    ResizablePanel.jsx   # Drag-to-resize split panel utility
    ErrorBoundary.jsx    # React error boundary with resetKey for recovery
    Icon.jsx             # Lucide icon wrapper; all icons must be imported AND added to ICON_MAP
    ui/                  # Shared primitives: BrandWordmark, ToolbarButton, ToolbarSelect, ExportStatusButton, KeyboardHint
    v2/                  # Default workflow UI: FlowRail, V2Header, FindPortfolio, ReviewHub, InvestigateView, FindingsPanel, AnalyzeShell, InlineCompare, ImproveView, LiveSessionBanner, SessionStorageNotice
    waterfall/           # Waterfall sub-components: WaterfallChart, WaterfallRow, WaterfallInspector, TimeAxis
routes/
  discovery.js         # Async traversal and bounded cached preview enrichment
  sessions.js            # Session discovery, file serving, SSE streaming
  ai.js                  # Coach analysis, Q&A, model info (SSE streaming)
  config.js              # Project config surface detection, file preview, apply
bin/
  agentviz.js            # CLI entry point: finds free port, starts server, opens browser
mcp/
  server.js              # MCP server: launch_agentviz and close_agentviz tools
server.js                # HTTP server shell: static serving, file watcher, route dispatch
```

### Parser API

`parseSession(text)` auto-detects the format and returns a normalized structure:

```js
// Every event has the same shape regardless of source format
{ t, agent, track, text, duration, intensity, toolName?, toolInput?, toolOutput?, toolCallId?, parentToolCallId?, agentName?, agentDisplayName?, raw, turnIndex, isError, model?, tokenUsage? }

// Turns group events by conversation round
{ index, startTime, endTime, eventIndices, userMessage, toolCount, hasError }

// Session-level stats
{ totalEvents, totalTurns, totalToolCalls, errorCount, duration, models, primaryModel, tokenUsage, totalCost? }
```

## Usage

```bash
npx agentviz                         # Run without installing
npx agentviz session.jsonl           # Open a specific session file
npm start                            # Build and launch (from cloned repo)
```

AGENTVIZ can also be launched from Claude Code, VS Code, or Copilot CLI via the MCP `launch_agentviz` tool.

## Development

Agent instructions are maintained in [AGENTS.md](AGENTS.md), with short entry
points in `CLAUDE.md` and `.github/copilot-instructions.md`. See
[docs/architecture.md](docs/architecture.md) for the detailed implementation map.

```bash
npm run dev             # Vite dev server + API backend (auto-started)
npm run build           # Production build to dist/
npm test                # Run all tests via Vitest with stable worker cap
npm run test:v2         # Run workflow golden data, UI, and app regression coverage
npm run test:e2e:v2     # Run the Playwright v2 browser smoke test
npm run test:e2e:export # Build, then verify a shared export boots from file://
npm run test:watch      # Watch mode
npm run typecheck       # Type-check with tsc --noEmit
```

> `npm run dev` starts both the Vite frontend (port 3000) and the API backend (port 4242) automatically. Vite proxies `/api/*` to the backend.
> `npm run test:e2e:v2` uses a hermetic Vite test server on port 3100. Run `npx playwright install chromium` once before the first browser test run.
> `npm run test:e2e:export` serves `dist/` on an ephemeral port, downloads a real export, and reopens it from `file://` with the network blocked. Run `npx playwright install --with-deps webkit` to also run the `webkit-export` project, which guards against WebKit's refusal to evaluate module scripts from `data:` URLs.

### Releasing to npm

Releases use `.github/workflows/publish.yml`, which builds the tagged source and
publishes with provenance through the `npm-publish` environment. The workflow
currently permits only the `jayparikh` actor.

1. Create a release branch. Update the version in `package.json` and both root
   version entries in `package-lock.json`, and promote the relevant
   `CHANGELOG.md` entries into a dated release section.
2. Run `npm test`, `npm run typecheck`, `npm run build`, and
   `npm pack --dry-run --ignore-scripts`. Review the package contents, then open
   and merge the release PR after CI passes.
3. Create the version tag and GitHub release at the merged release commit.
   Confirm that the tag's package version matches the intended npm version.
4. Check the automatically triggered **Publish npm** run before starting another
   run. If it succeeds, do not publish the same version again. If it fails before
   any steps run with a tag/environment restriction, use the manual path below.

**Working manual publishing path** (used for v1.0.4 and v1.1.0):

1. Open [Actions > Publish npm](https://github.com/jayparikh/agentviz/actions/workflows/publish.yml).
2. Click **Run workflow**, not **Re-run jobs** on the failed release run.
3. Leave **Use workflow from** set to **main**.
4. Enter the existing release tag, for example `v1.1.0`, in **Git tag to publish**,
   then click **Run workflow**.

The manual run uses `main` as its workflow ref but checks out the supplied tag
for the build and publication. The release-triggered run instead uses the tag
as its workflow ref, which the environment can reject. Re-running that failed
run retains the same ref and does not resolve the restriction. Do not weaken
environment protections; honor any required approvals on the manual run.

Wait for the publish job to finish and confirm that its log reports the intended
`agentviz` version published to `https://registry.npmjs.org/` with the `latest` tag.
Confirm registry visibility with `npm view agentviz@1.1.0 version --registry=https://registry.npmjs.org`
and `npm view agentviz dist-tags --registry=https://registry.npmjs.org`, replacing
the example version as appropriate. A GitHub release alone does not confirm npm
publication. If a run fails after publishing may have started, check the registry
before retrying: npm versions cannot be overwritten.

### Design System

AGENTVIZ ships with full dark and light themes plus a **System** mode that follows your OS preference. The theme switcher is in the top bar (sun/moon/monitor icons). Your choice persists in localStorage across sessions.

- **Dark mode** (default): True black base (`#0f0f16`) with blue, purple, and green accents
- **Light mode**: Clean white base (`#f8f9fc`) with deeper, higher-contrast accent colors
- **System mode**: Automatically matches `prefers-color-scheme` and updates live if you change your OS setting

All colors are defined as design tokens in `src/lib/theme.js` with dynamic getters that resolve to the active palette at render time. A visual reference of every token in both modes is available in `docs/color-palette.html`. JetBrains Mono throughout. No CSS framework; all styles are inline.

### Configuration

**AI Model** -- The Coach and Session Q&A features use the Copilot SDK. You can override the model:

| Method | Example |
|--------|---------|
| Environment variable | `AGENTVIZ_MODEL=gpt-4o node bin/agentviz.js` |
| Config file | `~/.agentviz/config.json` with `{ "model": "gpt-4o" }` |
| Custom config path | `AGENTVIZ_CONFIG=/path/to/config.json` |

The current model can be queried via `GET /api/models`.

**Feature Flags** -- Experimental features are gated behind localStorage flags:

| Flag | Default | Description |
|------|---------|-------------|
| `qa` | `false` | Session Q&A slide-over drawer |

Enable a flag in the browser console:

```js
localStorage.setItem('agentviz:flag:qa', 'true')
```

## Contributing

Contributions are welcome! Here are some areas where help is appreciated:

- **New parsers**: LangSmith, OpenTelemetry, custom agent frameworks
- **Visualizations**: Graph minimap, large-session clustering
- **Features**: Bookmarks/annotations, shareable URLs

Please open an issue to discuss larger changes before submitting a PR.

## Roadmap

- [ ] Bookmarks and annotations (persisted to localStorage)
- [ ] Graph minimap and large-session clustering
- [ ] Shareable session URLs
- [ ] Vim-style keyboard navigation
- [ ] Parsers for LangSmith traces and OpenTelemetry spans

## License

MIT
