# AGENTVIZ

Session replay visualizer for AI agent workflows (Claude Code, VS Code Copilot Chat, Copilot CLI).

## Stack
- React 18 + Vite 6, inline styles only, JetBrains Mono font
- Mixed JS/TS: components and hooks are plain JSX, parsers and data libs are TypeScript
- Design tokens in `src/lib/theme.js`

## Commands
```bash
npm run dev          # Dev server
npm run build        # Production build to dist/
npm test             # Run tests via Vitest
npm run test:watch   # Watch mode
npm run typecheck    # tsc --noEmit
```

## Rules
- Search existing code before writing new abstractions.
- Run tests after every non-trivial change.
- Prefer editing existing files over creating new ones.
- Never silently apply config changes — surface drafts first.
- Product name is always AGENTVIZ (all caps, no spaces). Never "AgentViz" or "Agentviz".
- All UI changes must conform to `docs/ui-ux-style-guide.md`. Review the checklist at the bottom of that file before approving any PR that touches components, styles, or visual behavior.

## Four-Artifact Sync Rule
Every UI change must update ALL FOUR of these before committing. Never let them drift:
1. `README.md` — feature descriptions, architecture section, file tree
2. `docs/ui-ux-style-guide.md` — token values, patterns, rules
3. `docs/screenshots/` — all 8 screenshots (see Screenshots section below)
4. Repo memory — store any new conventions with `store_memory`

## Screenshots
The README references 8 screenshot files in `docs/screenshots/`. All must be kept in sync.

**Files:** `landing.png`, `session-hero.png`, `replay-view.png`, `tracks-view.png`, `waterfall-view.png`, `graph-view.png`, `stats-view.png`, `coach-view.png`

**Workflow (using Playwright MCP tools):**
1. Start dev server: `npm run dev`
2. Navigate to `http://127.0.0.1:3000`, resize to **1400x860**
3. Capture `landing.png` from the landing page (before loading a session)
4. Click **"load a demo session"**, then click each tab and capture: replay, tracks, waterfall, graph, stats
5. For **Coach**: click the tab, hide the error banner with JS before capturing:
   ```js
   document.querySelectorAll('*').forEach(el => {
     if (el.children.length === 0 && el.textContent.trim().startsWith('AI analysis failed')) {
       let n = el;
       for (let i = 0; i < 6; i++) {
         if (n.parentElement?.textContent.trim().startsWith('AI analysis failed')) n = n.parentElement;
         else break;
       }
       n.style.display = 'none';
     }
   });
   ```
6. Copy `replay-view.png` to `session-hero.png` (hero reuses replay image)

**Note:** `session-hero.png` is the hero image at the top of the README. It must always be regenerated alongside `replay-view.png` -- they use the same source image.

## MCP vs Dev Server
The MCP `launch_agentviz` tool serves the **production build** from `dist/` — NOT the dev server. Changes to source code are not reflected in MCP until `npm run build` is run. Always run `npm run build` before testing via MCP, and after any code change that the user will view via `open agentviz`.

## Document Authoring Autonomy

When working on long-form documents (markdown specs, design docs, research reports), you are authorized to make the following decisions WITHOUT asking for confirmation:

- **Move or re-order sections**: If a section logically belongs in an appendix, a different chapter, or a new file, move it and note the change in your summary.
- **Add external references**: When a claim references a known URL (GitHub pages, docs, marketplace), fetch the URL with `web_search` or `web_fetch`, extract the relevant fact, and inline the citation. Do not pause to ask "should I add a reference here?"
- **Propose then immediately draft**: When the human says "propose if X is a requirement" or "what do you think about Y?", write your recommendation AND a complete draft of the resulting section in the same turn. Do not stop at the proposal.
- **Create parallel sections**: If the human asks to "create a similar stream for X" (e.g. MCP server deploy stream), write the full new section modeled on the existing one without asking for a template or outline first.
- **Explore and summarize URLs proactively**: When the human provides URLs to investigate (e.g. `github.com/mcp`, `github.com/marketplace?category=ai-assisted`, `github.com/copilot/agents`), fetch and summarize ALL provided URLs in a single turn before writing any document section. Do not stop after the first URL.
