# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] — feature/inbox-coach-autodiscovery

### Features

- **Inbox auto-discovery**: Sessions are automatically discovered from the Copilot CLI session store without manual file upload. Supports fallback to disk fetch when localStorage is evicted.
- **AI Coach agent**: Fully agentic coach powered by `@github/copilot-sdk` (gpt-4o). Runs automatically on session open, caches recommendations to localStorage, and includes a Redo button.
  - Grounds recommendations in official Copilot CLI best practices (prompts, skills, MCP, global instructions).
  - Tool-calling loop with Apply button to write config changes directly.
  - Preview/revert for AI-generated recommendations.
  - Displays existing skills and MCP servers in the config panel.
  - Coaches on prompts and skills creation as first-class recommendations.
- **Session routing**: Clicking an inbox session navigates directly into the visualizer.
- **Crash hardening**: Error boundaries and resilient session loading.

### Bug Fixes

- **ShortcutsModal crash: `Cannot read properties of undefined (reading 'startsWith')`** — All theme references in `ShortcutsModal.jsx` used the old flat token schema (`theme.bg`, `theme.border`, `theme.text`, `theme.textMuted`, `theme.surface`), which are now nested objects. Calling `alpha()` on an object caused the crash. Updated to current token paths (`theme.bg.base`, `theme.border.default`, `theme.text.primary`, etc.)
- **Interventions counted incorrectly** — Copilot CLI sessions spawn `"(continuation)"` turns when there is no real user message; these were being counted as interventions. Fix mirrors the `isContinuationMessage` guard already used by `userFollowUps`, counting only turns with a real user message.
- **Inbox: YAML block-scalar summaries not parsed** — `workspace.yaml` files using the `summary: |-` block scalar form were silently dropped, leaving sessions unlabeled. Regex now handles both inline and block scalar forms.
- **Inbox: AI coach subprocess sessions polluting inbox** — Child CLI sessions spawned by the coach agent (summaries starting with "Analyze this" or containing "Session stats"+"read\_config") are now filtered out of the inbox listing.
- **Config panel: default open + skill paths applicable** — Config panel now opens by default; skill path suggestions correctly reflect discovered paths.
- **Coach: auto-retry on CLI timeout** — Coach agent retries automatically when the CLI session times out, instead of silently failing.
- **Coach: rebalanced toward prompts/skills** — Reduced over-weighting of global instructions in coach output; prompts and skills recommendations now surface more reliably.
- **Coach: force skills for domain knowledge** — Skills are now always recommended when the session shows repeated domain-context tool calls.
- **Coach: remove 90s timeout** — Replaced `sendAndWait` (90s hard timeout) with `send` + `session.idle` listener, eliminating spurious timeout failures on slow machines.
- **Coach: format-aware agent prompts + valid .mcp.json schema** — Agent-generated prompts are now format-checked; emitted `.mcp.json` blobs conform to the schema.
- **Graph view: cap at 80 turns** — Sessions with 80+ turns no longer hang the browser waiting for ELK layout.
- **AppHeader: prevent horizontal overflow** — Compacted header layout stops overflowing on typical screen widths.
- **Library: discoveredPath enriched at merge time** — Library entries now carry the correct `discoveredPath` when merged from disk discovery.
- **Theme: undefined token** — `theme.accent.secondary` (undefined) replaced with `theme.semantic.success`.
- **JSX: IIFE and hook ordering** — Moved `liveRecs`/`progressStep` declarations before `return`; removed illegal IIFE in JSX. All 323 tests pass.
- **Tooling-upgrade recommendation: Apply button** — Previously missing Apply button restored to the tooling-upgrade card.
- **UI label: "Copilot SDK"** — Corrected label from "GitHub Models (gpt-4o-mini)" to "Copilot SDK".

### UX Improvements

- Metric card tooltips replaced with styled hover popups (was `title` attribute).
- "Babysitting time" metric renamed to "Human response time" with descriptive tooltip.
