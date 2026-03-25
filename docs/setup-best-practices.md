# Claude Code & Copilot CLI Setup -- Best Practices

> Opinionated, copy-paste-ready guide to making both tools actually useful from session one.

---

## TL;DR -- One-Page Cheatsheet

| File | Tool | Purpose | Must-Have Content |
|------|------|---------|-------------------|
| `CLAUDE.md` | Claude Code | Project memory, read first on every session | Role, stack, commands, rules, autonomy contract |
| `.claude/commands/*.md` | Claude Code | Slash commands (`/review`, `/qa`, `/ship`) | Step-by-step workflow instructions |
| `.claude/agents/*.md` | Claude Code | Subagents with YAML frontmatter | Scout, Builder, Verifier roles |
| `.claude/rules/*.md` | Claude Code | Always-on constraints, never truncated | Security rules, off-limits paths, style invariants |
| `.mcp.json` | Both | MCP server connections (shared!) | memory, filesystem, git, github, search |
| `.claude/settings.json` | Claude Code | Permissions: allow/deny bash ops | Allow builds, deny force-push and `rm -rf` |
| `.github/copilot-instructions.md` | Copilot | Project memory equivalent | Same as CLAUDE.md minus the commands block |
| `.github/prompts/*.prompt.md` | Copilot | Reusable prompts + agent workflows | mode frontmatter, sprint-phase prompts |
| `.github/extensions/*.yml` | Copilot | Copilot CLI skill definitions | Compound workflows, retros, audits |

**Session zero checklist (under 30 minutes):**
1. Create `CLAUDE.md` with role + commands + autonomy contract
2. Add `.claude/rules/safety.md` and `.claude/rules/style.md`
3. Create `.mcp.json` with memory + filesystem + git
4. Add `/review` and `/qa` slash commands
5. Create scout + builder + verifier agents
6. Mirror everything in `.github/copilot-instructions.md`

---

## Why Setup Matters

Without setup, every session starts cold. Claude has no idea what stack you're on, how to build or test your project, which paths are off-limits, or whether it should stop to ask you before running destructive commands. You end up re-explaining context, fixing wrong assumptions, and babysitting every step.

With proper setup, Claude walks in already briefed. It knows the stack, can run tests without asking how, respects your conventions, self-directs through multi-step tasks, and persists discoveries so it never re-asks the same question. The difference is not marginal -- it is the difference between a junior dev who needs hand-holding and a senior engineer who can own a task end-to-end.

The same logic applies to Copilot. Without `copilot-instructions.md`, every chat starts from scratch. With it, Copilot knows your role, your project's tech choices, and your preferred patterns before you type a single character.

---

## Part 1: Claude Code

### 1.1 The Memory Layer -- CLAUDE.md

`CLAUDE.md` is the first thing Claude reads before any prompt. It is your project's standing brief. Put it in the repo root.

**Required sections (in this order):**

1. **Role & project** -- Who you are, what the project is, the tech stack, the repo path
2. **Commands** -- The single most important section; Claude will run these verbatim
3. **Project structure** -- A brief map of key dirs, enough to navigate without reading every file
4. **Rules** -- Behavioral constraints that apply to every task
5. **Autonomy contract** -- When to keep going, when to pause, when to stop (see 1.5)
6. **MCP servers** -- What's connected and what each one is for
7. **Skills & agents** -- Available slash commands and subagents, one line each

**Full annotated example for a TypeScript/Node.js + React app (like this project):**

```markdown
# AGENTVIZ

Session replay visualizer for Claude Code and Copilot CLI JSONL logs.

## Role & Project
You are a senior TypeScript/React engineer working on `agentviz`.
- Stack: React 18, Vite 6, Node.js, Vitest, plain inline styles (no CSS framework)
- Repo: ~/workspace/viveks-scratch/agentviz
- Font: JetBrains Mono. Theme: "Midnight Circuit" (tokens in src/lib/theme.js)
- No global state management -- components receive data as props only

## Commands
```bash
npm run dev          # Dev server on port 3000
npm run build        # Production build to dist/
npm test             # Run full test suite (Vitest)
npm run test:watch   # Watch mode
npm run typecheck    # tsc --noEmit
```

## Project Structure
```
src/
  App.jsx            # Main orchestrator: file loading, playback, view routing
  hooks/             # usePlayback, useSearch, useSessionLoader, useLiveStream
  lib/               # Pure helpers: parser, theme, waterfall, graphLayout, pricing
  components/        # React components: ReplayView, TracksView, WaterfallView, GraphView
bin/agentviz.js      # CLI entry: finds free port, starts server, opens browser
mcp/server.js        # MCP server: launch_agentviz / close_agentviz tools
server.js            # HTTP server: serves dist/ SPA + SSE /api/stream
```

## Rules
- No em dashes anywhere (use -- or commas)
- All styles are inline; all colors reference theme.js tokens, never hardcoded hex
- Search the codebase before building anything new -- check for existing utilities
- Run `npm test` after every non-trivial change; never commit with failing tests
- Never silently apply config changes; always surface them for review
- If you discover how the project is configured (framework, test runner, etc.),
  write it back to CLAUDE.md under the relevant section immediately

## Autonomy Contract
See section below.

## MCP Servers
- memory: Persistent context across sessions (project state, recent decisions)
- filesystem: Safe file ops restricted to repo root
- git: Blame, log, diff without shelling out
- github: Issue/PR access for context on in-flight work

## Skills & Agents
Slash commands: /review (PR review), /qa (test run + coverage), /ship (pre-merge checklist)
Agents: scout (research), builder (implementation), verifier (test + lint + validate)
```

**Minimal CLAUDE.md (under 10 minutes, still 10x better than nothing):**

```markdown
# PROJECT_NAME

## Role & Project
You are a [role] working on [project]. Stack: [list]. Repo: [path].

## Commands
```bash
[how to run dev server]
[how to run tests]
[how to build]
```

## Rules
- Search before building. Run tests after changes. Never silently apply config.

## Autonomy Contract
Keep working on routine tasks. Pause before destructive ops (rm, DROP TABLE, force-push).
Stop and surface if you hit a blocker you cannot resolve from the codebase.
```

---

### 1.2 The Extensions Hub -- .claude/

The `.claude/` directory is where all customization lives. Here is the full structure and what goes where:

```
.claude/
  commands/      # Slash commands: each .md file = /filename command
  agents/        # Subagents with YAML frontmatter
  rules/         # Always-on constraints, loaded every session
  settings.json  # Permissions: allow/deny
.mcp.json        # MCP server connections (in repo root, not .claude/)
```

#### .claude/commands/*.md -- Slash Commands

Each `.md` file in `.claude/commands/` becomes a `/filename` command. Commands are sprint-phase instructions -- they tell Claude exactly what to do and in what order for a repeating workflow.

**Best practice: one command per sprint phase.**

```
.claude/commands/
  investigate.md  # /investigate -- research a problem space
  plan.md         # /plan -- break work into tasks with estimates
  review.md       # /review -- pre-commit code review
  qa.md           # /qa -- run tests, check coverage, lint
  ship.md         # /ship -- pre-merge checklist
  retro.md        # /retro -- summarize session decisions for CLAUDE.md
```

**Full example: `.claude/commands/review.md`**

```markdown
# /review -- Pre-Commit Code Review

You are reviewing staged changes before they are committed. Do the following in order:

1. Run `git diff --staged` to see what changed.
2. For each modified file:
   - Check that all colors reference theme.js tokens (no hardcoded hex).
   - Verify no em dashes were introduced.
   - Confirm inline styles only (no new CSS classes or files).
   - Check that any new components receive data as props, not global state.
3. Run `npm test`. If any tests fail, stop and report which ones and why.
4. Check for missing test coverage on new logic in `src/lib/`.
5. Summarize findings as: PASS / PASS WITH NOTES / FAIL, with a short list of issues.

Do not auto-fix. Report only. Let me decide what to address.
```

**Full example: `.claude/commands/qa.md`**

```markdown
# /qa -- Quality Assurance

1. Run `npm test` and capture the full output.
2. Run `npm run typecheck` and capture errors.
3. Check for any `console.error` or `console.warn` in src/ (excluding tests).
4. Report: test count, pass/fail counts, typecheck errors, and any console noise.
5. If all pass, say "QA CLEAN". If anything fails, list items with file:line references.
```

#### .claude/agents/*.md -- Subagents

Agents are invoked for multi-step, role-specific work. They have YAML frontmatter that tells Claude when to use them. Use the Scout, Builder, Verifier pattern -- it prevents you from babysitting multi-step tasks.

**How the pattern works:**
- **Scout** researches before building: reads existing code, finds related utilities, surfaces assumptions
- **Builder** implements with full context from Scout's findings
- **Verifier** tests, lints, validates -- never the same agent that built

**Full example: `.claude/agents/scout.md`**

```markdown
---
name: scout
description: Use when asked to research a problem, understand existing code, or map out a task before building. Always invoke scout before builder on non-trivial changes.
---

You are the Scout agent. Your job is to understand, not to build.

When invoked:
1. Read the relevant files in `src/` to understand the existing implementation.
2. Search for related utilities, types, and patterns that already exist.
3. Check `src/lib/` for reusable helpers before recommending new ones.
4. Identify: what already exists, what needs to be added, what might break.
5. Write a short brief (5-10 bullets) summarizing your findings.
6. Pass the brief to the Builder agent. Do NOT start implementing.

Never write code. Never modify files. Research and report only.
```

**Full example: `.claude/agents/builder.md`**

```markdown
---
name: builder
description: Use to implement a task after scout has produced a brief. Requires scout output as input context.
---

You are the Builder agent. You implement, guided by Scout's brief.

When invoked:
1. Read Scout's brief carefully. Do not re-research what Scout already found.
2. Implement the change in the narrowest scope possible -- touch only what needs changing.
3. Follow all rules in CLAUDE.md (no em dashes, inline styles only, theme tokens, etc.).
4. After each file change, check that `npm test` still passes.
5. When done, write a short summary of what you changed and why.
6. Do NOT commit. Do NOT push. Hand off to Verifier.
```

**Full example: `.claude/agents/verifier.md`**

```markdown
---
name: verifier
description: Use after builder completes to validate correctness. Runs tests, checks conventions, reports issues.
---

You are the Verifier agent. You validate what Builder produced.

When invoked:
1. Run `npm test` and capture the full output.
2. Run `npm run typecheck`.
3. Check that all changed files follow conventions from CLAUDE.md.
4. Check that no new hardcoded colors, em dashes, or CSS files were introduced.
5. If everything passes: report "VERIFIED CLEAN" with a summary.
6. If anything fails: report each failure with file:line, and what needs to be fixed.

Do NOT fix failures yourself. Report only. Let Builder re-engage if needed.
```

#### .claude/rules/*.md -- Always-On Rules

Rules are loaded every session and are never truncated, unlike `CLAUDE.md` which can be cut off in long contexts. Use rules for constraints that must always apply.

**Split rules by concern:**

```
.claude/rules/
  safety.md     # Destructive op warnings, off-limits paths
  style.md      # Code style invariants
  git.md        # Commit and branch rules
```

**Full example: `.claude/rules/safety.md`**

```markdown
# Safety Rules (always active)

- WARN before any `rm -rf` command. Show what will be deleted. Wait for confirmation.
- WARN before any SQL DROP or TRUNCATE. Show the query. Wait for confirmation.
- Never run `git push --force` without explicit instruction.
- Never modify files outside the repo root: ~/workspace/viveks-scratch/agentviz
- Never edit `.env` or any file containing credentials without explicit instruction.
- If a task requires a destructive operation, pause and surface it. Do not proceed autonomously.
```

**Full example: `.claude/rules/style.md`**

```markdown
# Style Rules (always active)

- No em dashes anywhere. Use -- or commas instead.
- All styles are inline. No CSS files. No Tailwind. No CSS modules.
- All colors must reference tokens from src/lib/theme.js. No hardcoded hex values.
- No global state. Components receive data as props only.
- JetBrains Mono is the only font. Do not introduce other typefaces.
```

#### .claude/settings.json -- Permissions

```json
{
  "permissions": {
    "allow": [
      "bash(npm run *)",
      "bash(git diff *)",
      "bash(git log *)",
      "bash(git status)",
      "bash(find * -name *)",
      "bash(grep -r * src/)"
    ],
    "deny": [
      "bash(rm -rf *)",
      "bash(git push --force*)",
      "bash(git push -f*)",
      "bash(DROP TABLE*)",
      "bash(TRUNCATE*)"
    ]
  }
}
```

#### .mcp.json -- MCP Server Connections

Place this in the repo root (not inside `.claude/`). It is shared by both Claude Code and Copilot.

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-memory"],
      "description": "Persistent key-value memory across sessions"
    },
    "filesystem": {
      "command": "npx",
      "args": [
        "-y", "@modelcontextprotocol/server-filesystem",
        "/home/vibhadauria/workspace/viveks-scratch/agentviz"
      ],
      "description": "Safe file ops restricted to repo root"
    },
    "git": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-git",
        "--repository", "/home/vibhadauria/workspace/viveks-scratch/agentviz"
      ],
      "description": "Git history, blame, diff without raw bash"
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" },
      "description": "Issue and PR context for in-flight work"
    }
  }
}
```

---

### 1.3 Recommended MCP Servers -- Opinionated Starter Set

| Server | Install | What It Gives You | Add It When |
|--------|---------|-------------------|-------------|
| `@anthropic/mcp-server-memory` | `npx -y @anthropic/mcp-server-memory` | Persistent K/V store across sessions | Day one -- prevents Claude re-asking config questions |
| `@modelcontextprotocol/server-filesystem` | `npx -y @modelcontextprotocol/server-filesystem <path>` | Path-restricted file reads/writes | Day one -- safer than raw bash for file ops |
| `@modelcontextprotocol/server-git` | `npx -y @modelcontextprotocol/server-git` | Blame, log, diff, commit history | Any project with > 1 contributor |
| `@modelcontextprotocol/server-github` | `npx -y @modelcontextprotocol/server-github` | Issues, PRs, code search | When Claude needs PR context to do code review |
| `brave-search` or `tavily-mcp` | `npx -y @modelcontextprotocol/server-brave-search` | Web search during research tasks | When Claude needs to look up docs, RFCs, packages |
| `@modelcontextprotocol/server-postgres` | `npx -y @modelcontextprotocol/server-postgres <conn>` | Query the DB without raw SQL in bash | When Claude needs schema context or data queries |

**Security note:** Use per-project `.mcp.json` at the repo root, not a global `~/.mcp.json`. This scopes permissions to the project and makes the config reviewable in version control. Never put credentials directly in `.mcp.json` -- use environment variable interpolation (`"${ENV_VAR}"`) or a secrets manager.

---

### 1.4 The Sprint Workflow

Map each sprint phase to a slash command. Run them in order for any non-trivial task.

```
/investigate  →  /plan  →  [build]  →  /review  →  /qa  →  /ship  →  /retro
```

**Example session transcript:**

```
You: /investigate Add support for LangSmith trace format in the parser

Claude (scout): Reading src/lib/parser.ts, copilotCliParser.ts, parseSession.ts...
  Findings:
  - parseSession.ts uses detectFormat() to route to format-specific parsers
  - Both existing parsers export the same shape: { events, turns, metadata }
  - detectFormat() checks the first JSONL line for format fingerprints
  - LangSmith trace schema: { run_id, name, inputs, outputs, events[] }
  - Recommended: add parseLangSmithJSONL() in src/lib/langsmithParser.ts,
    register in detectFormat(), no other files need changing.

You: /plan

Claude: Task breakdown:
  1. Create src/lib/langsmithParser.ts (new file, ~150 lines)
  2. Update detectFormat() in parseSession.ts (add LangSmith fingerprint check)
  3. Add test file src/__tests__/langsmithParser.test.js
  Estimate: ~2 hours. No existing files at risk of regression beyond parseSession.ts.

You: Go ahead and build it.

Claude (builder): Implementing... [runs npm test after each file]

You: /qa

Claude (verifier): npm test: 187 pass, 0 fail. typecheck: clean. QA CLEAN.

You: /ship

Claude: Pre-merge checklist:
  [x] Tests pass
  [x] No hardcoded colors or em dashes
  [x] detectFormat() covered by existing parseSession tests
  [x] New parser has its own test file
  Ready to commit.
```

---

### 1.5 The Autonomy Contract -- The Most Impactful Section

This is the single highest-ROI addition to your `CLAUDE.md`. Without it, Claude stops to ask permission on routine steps. With it, Claude self-directs through entire tasks and only surfaces when it genuinely needs you.

**Copy this block into every CLAUDE.md, customized to your project:**

```markdown
## Autonomy Contract

### Keep working without asking (no permission needed):
- Reading any file in the repo
- Running npm run dev, npm test, npm run build, npm run typecheck
- Running git diff, git log, git status, git blame
- Creating new files in src/ or test files in src/__tests__/
- Making non-destructive edits to existing source files
- Installing packages with npm install (non-destructive only)
- Searching the codebase with grep, find, or the filesystem MCP

### Verify before acting (pause, show the command, wait for go/no-go):
- Any `rm`, `rmdir`, or file deletion
- Any git operation that rewrites history (rebase, reset --hard, push --force)
- Any change to package.json scripts, tsconfig.json, or vite.config.js
- Any change to .mcp.json or .claude/settings.json
- Modifying files outside the repo root

### Stop and surface to operator (do not attempt, explain the blocker):
- You cannot determine the correct behavior from the codebase alone
- The task requires access to a service or credential you do not have
- You have attempted a fix 3 times and are still failing tests
- The task scope has expanded significantly beyond the original request

### Always-on rules:
- Search before building: check src/lib/ for existing utilities before writing new ones
- Run tests after every non-trivial change
- If you discover new config (new test command, new env var, framework detail):
  write it back to CLAUDE.md under the relevant section immediately
- Never ask the same question twice: store answers in the memory MCP
```

---

### 1.6 Getting Started in 6 Steps (Claude Code)

**Time: under 30 minutes from zero**

**Step 1 -- Create CLAUDE.md (10 min)**
Start with the minimal template from 1.1. Fill in your role, stack, actual commands, and paste the autonomy contract. Commit it.

**Step 2 -- Add .claude/rules/ (5 min)**
Create `safety.md` and `style.md` from the examples in 1.2. These are the two rules that prevent the most common painful mistakes.

**Step 3 -- Create .mcp.json (5 min)**
Add memory, filesystem, and git servers. Run `claude mcp list` to confirm they connect. Memory is the highest-priority one -- add it first.

**Step 4 -- Add /review and /qa commands (5 min)**
Create `.claude/commands/review.md` and `.claude/commands/qa.md` from the examples above. These two commands cover 80% of your daily workflow.

**Step 5 -- Create scout, builder, verifier agents (3 min)**
Copy the three agent examples from 1.2 into `.claude/agents/`. You will use this pattern more than any other.

**Step 6 -- Run a test session**
Open Claude Code, type `/review` on a recent change. Watch it follow the command. If it deviates, tighten the command language. Adjust your autonomy contract based on what it asks vs. what you want it to decide alone.

---

## Part 2: GitHub Copilot CLI

### 2.1 The Memory Layer -- .github/copilot-instructions.md

Same concept as `CLAUDE.md` but for Copilot. Every Copilot chat session reads this file before processing your prompt.

**Key differences from CLAUDE.md:**
- No `## Commands` block needed -- Copilot does not run commands autonomously
- Use `##` headers consistently -- Copilot parses them as section boundaries
- Rules syntax uses plain bullets, not a formal contract structure
- No `## Skills & Agents` section -- handled by `.github/prompts/` instead

**Full annotated example:**

```markdown
# AGENTVIZ -- Copilot Context

## Role & Project
I am a TypeScript/React engineer working on agentviz, a session replay visualizer
for Claude Code and Copilot CLI JSONL logs. Stack: React 18, Vite 6, Node.js, Vitest.

## Tech Choices
- All styles are inline (no CSS framework, no Tailwind, no CSS modules)
- All colors reference tokens from src/lib/theme.js (never hardcoded hex)
- No global state management -- components receive data as props only
- Font: JetBrains Mono only
- Test runner: Vitest (not Jest -- syntax is the same but import paths differ)

## Project Structure
- src/lib/: Pure helpers and utilities (parser, theme, waterfall, graphLayout)
- src/components/: React components, all receive data via props
- src/hooks/: Custom hooks (usePlayback, useSearch, useSessionLoader)
- mcp/server.js: MCP server with launch_agentviz and close_agentviz tools
- server.js: HTTP server serving dist/ SPA with SSE /api/stream endpoint

## Code Rules
- No em dashes. Use -- or commas instead.
- Search src/lib/ for existing utilities before suggesting new ones.
- All new components must receive data as props, not from global state.
- New color values must come from src/lib/theme.js tokens.
- When suggesting tests, use Vitest syntax (describe/it/expect -- same as Jest).

## What I Am Working On
[Update this section at the start of each session, e.g.:]
Currently adding LangSmith trace parser support. New parser goes in src/lib/,
detectFormat() in parseSession.ts needs updating to route LangSmith JSONL.
```

---

### 2.2 Prompt Templates -- .github/prompts/

Each `.prompt.md` file in `.github/prompts/` becomes a reusable prompt, accessible via the Copilot chat `@` or slash interface.

**Frontmatter fields:**

```yaml
---
mode: ask | edit | agent   # ask = Q&A, edit = code changes, agent = autonomous workflow
description: When and why to use this prompt
tools:                     # MCP tools and built-ins this prompt may use
  - codebase
  - terminal
  - mcp_memory
---
```

**Mode types:**
- `ask` -- read-only Q&A; Copilot explains, analyzes, or researches
- `edit` -- Copilot makes targeted code changes in one or more files
- `agent` -- Copilot plans and executes a multi-step workflow autonomously

**Sprint commands as prompt files:**

```
.github/prompts/
  review.prompt.md     # Pre-commit review (mode: ask)
  qa.prompt.md         # Test run + lint check (mode: agent)
  ship.prompt.md       # Pre-merge checklist (mode: ask)
  investigate.prompt.md # Research + map task (mode: ask)
  scout.prompt.md      # Scout subagent (mode: agent)
  builder.prompt.md    # Builder subagent (mode: edit)
```

**Full example: `.github/prompts/review.prompt.md`**

```markdown
---
mode: ask
description: Pre-commit code review. Run this before committing any change.
tools:
  - codebase
  - changes
---

Review the staged changes for this project. Check:

1. No hardcoded hex colors -- all colors must reference tokens in src/lib/theme.js.
2. No em dashes in comments, strings, or JSX text. Use -- or commas.
3. All styles are inline. No CSS files, no Tailwind classes, no CSS modules.
4. New components receive data as props (no new global state or Context consumers).
5. New logic in src/lib/ has a corresponding test in src/__tests__/.

Report as: PASS / PASS WITH NOTES / FAIL, with a bullet list of issues found.
Do not auto-fix. Report only.
```

**Full example: `.github/prompts/scout.prompt.md`**

```markdown
---
mode: agent
description: Research agent. Invoke before building anything non-trivial. Maps existing code, finds reusable utilities, identifies what needs to change.
tools:
  - codebase
  - mcp_memory
---

You are the Scout agent. Your job is to understand, not to build.

Given a task description:
1. Read the relevant files in src/ to understand the existing implementation.
2. Search src/lib/ for utilities that might already solve part of the problem.
3. Identify what already exists, what needs to be added, what might break.
4. Write a short brief (5-10 bullets) for the Builder to consume.
5. Store the brief in memory using mcp_memory so Builder can retrieve it.

Do NOT write or modify any code. Research and report only.
```

---

### 2.3 Extensions -- .github/extensions/

Extensions are YAML skill definitions for the Copilot CLI tool (`gh copilot`). Use them for compound workflows that are too structured for a prompt file.

**When to use extensions vs prompts:**
- Use **prompts** for in-editor Copilot Chat workflows (review, QA, research)
- Use **extensions** for CLI-invoked tools that produce structured output (retros, audits, reports)

**Full example: `.github/extensions/retro.yml`**

```yaml
name: retro
description: Summarize a completed work session for CLAUDE.md and future context
version: "1.0"
parameters:
  - name: scope
    description: What was worked on (feature name or file paths)
    required: true
steps:
  - action: summarize_changes
    prompt: |
      Given the git log for the last 4 hours and scope "{{scope}}",
      produce a 5-bullet retro:
      1. What was built or changed
      2. Key decisions made and why
      3. Any new config discovered (test commands, env vars, framework quirks)
      4. What is still in progress
      5. What the next session should do first
      Format this as a CLAUDE.md-ready update block.
```

---

### 2.4 MCP Servers for Copilot

Copilot reads MCP servers from two places:

**Option A: VS Code settings.json (user or workspace level)**
```json
{
  "github.copilot.chat.mcp.servers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-memory"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}"]
    }
  }
}
```

**Option B: `.mcp.json` in the repo root (recommended)**
Use the same `.mcp.json` from the Claude Code section. Both tools read it. One file, both tools configured. This is the right default.

**Security note:** Never put the `github` MCP server config with a raw `GITHUB_TOKEN` value in a committed `.mcp.json`. Use `"${GITHUB_TOKEN}"` interpolation and set the env var in your shell profile or CI secrets.

---

### 2.5 Getting Started in 6 Steps (Copilot CLI)

**Step 1 -- Create .github/copilot-instructions.md (10 min)**
Start with the annotated example from 2.1. Fill in your role, stack, and current task. Update the "What I Am Working On" section at the start of each session.

**Step 2 -- Add .github/prompts/ for review and QA (5 min)**
Create `review.prompt.md` and `qa.prompt.md` from the examples above. These cover the most common workflows.

**Step 3 -- Add scout.prompt.md (3 min)**
Copy the scout agent example. This prevents Copilot from jumping to implementation before understanding the codebase.

**Step 4 -- Add .mcp.json to the repo root (5 min)**
If you already did this for Claude Code, you are done. Copilot reads the same file.

**Step 5 -- Update copilot-instructions.md every session (1 min)**
The "What I Am Working On" section is the most valuable update you can make. Copilot's quality jumps significantly when it knows what task you are in the middle of.

**Step 6 -- Test with a review prompt**
Make a small change, then type `/review` (or the Copilot prompt command equivalent) and verify it applies your project's specific rules, not generic best practices.

---

## Part 3: Side-by-Side Comparison

| Concept | Claude Code | Copilot CLI |
|---------|------------|-------------|
| Memory layer | `CLAUDE.md` (repo root) | `.github/copilot-instructions.md` |
| Slash commands | `.claude/commands/*.md` | `.github/prompts/*.prompt.md` (mode: ask/edit) |
| Subagents | `.claude/agents/*.md` | `.github/prompts/*.prompt.md` (mode: agent) |
| Always-on rules | `.claude/rules/*.md` | Included in copilot-instructions.md |
| MCP servers | `.mcp.json` (repo root) | `.mcp.json` (repo root, same file) |
| Permissions | `.claude/settings.json` | VS Code `github.copilot.chat` settings |
| CLI skills/workflows | `.claude/skills/` or agents | `.github/extensions/*.yml` |
| Agent roster | `AGENTS.md` | `AGENTS.md` |
| Autonomy contract | `CLAUDE.md ## Autonomy Contract` | Not applicable (Copilot is not autonomous) |
| Config persistence | Memory MCP + write back to CLAUDE.md | Update copilot-instructions.md manually |

---

## Part 4: Common Mistakes and How to Fix Them

**1. Generic CLAUDE.md**
Wrong: "You are a helpful assistant. Help me write good code."
Right: "You are a senior React engineer at [company] building [specific project]. Stack: [exact list]. Repo: [exact path]."

Why it matters: Claude's output quality is directly proportional to how specifically you define the context. Generic context = generic output.

**2. No commands section**
Without the `## Commands` block, Claude guesses how to build and test your project. It will often get the test runner wrong (running `jest` instead of `vitest run`), miss environment flags, or use the wrong build command. The commands block is the most important section in CLAUDE.md.

**3. No autonomy contract**
Without it, Claude asks for permission on every non-trivial step: "Should I run the tests now?" "Is it OK to create a new file?" "Do you want me to proceed?" The autonomy contract answers all of these preemptively. Add it once, stop babysitting.

**4. MCP as afterthought**
The memory MCP is the highest-leverage addition you can make. Add it on day one. Without it, every session re-discovers your project config. With it, Claude stores what it learns and never re-asks.

**5. Global vs project-level config**
Global `~/.claude/settings.json` or `~/.mcp.json` applies to all your projects. Per-project files scope permissions correctly, are reviewable in git history, and are safe to share with teammates. Use project-level config by default. Only move something global if it truly applies to every project you work on.

**6. Forgetting to update CLAUDE.md**
CLAUDE.md gets stale as projects evolve. Fix this by adding to your rules: "When you discover new project config (new test command, new env var, new framework version), write it back to CLAUDE.md immediately." Then add `/retro` to your end-of-session habit to capture decisions made during the session.

**7. One giant CLAUDE.md**
CLAUDE.md can be truncated in long contexts. Behavioral constraints that must never be missed belong in `.claude/rules/*.md` -- these are loaded separately and are not truncated. Keep CLAUDE.md to one-screen: role, commands, structure, pointers to rules and agents. Put the detail in rules and commands files.

---

## Part 5: Starter Templates

### Minimal CLAUDE.md (< 1 hour setup)

```markdown
# [PROJECT_NAME]

[One sentence: what this project is.]

## Role & Project
You are a [role] working on [project].
Stack: [framework], [language], [test runner].
Repo: [absolute path].

## Commands
```bash
[dev command]
[test command]
[build command]
```

## Project Structure
[3-5 lines mapping key dirs to purpose]

## Rules
- Search before building. Check for existing utilities first.
- Run tests after every non-trivial change.
- Never silently apply config changes -- surface them for review.
- No em dashes. [Add your top 2-3 style rules.]

## Autonomy Contract
Keep working on: reading files, running dev/test/build, creating new files in src/.
Pause before: rm, git push --force, changes to config files.
Stop and surface: blockers you cannot resolve from the codebase alone.
When you discover project config, write it back to this file immediately.
```

### Full CLAUDE.md (production team setup)

Use the full annotated example from section 1.1, then add:
- `## Team Conventions` -- PR size limits, branch naming, review process
- `## Known Issues` -- current broken things Claude should not try to fix autonomously
- `## In Progress` -- current sprint work so Claude has context on what is open

### Minimal copilot-instructions.md

```markdown
# [PROJECT_NAME]

## Role & Project
I am a [role] working on [project]. Stack: [list].

## Code Rules
- [Your top 3-5 non-negotiable style rules]
- Search for existing utilities before suggesting new ones.

## What I Am Working On
[Update at the start of each session]
```

### Full copilot-instructions.md

Use the annotated example from section 2.1, plus:
- `## Preferred Patterns` -- show one example of "do this, not that" for your codebase's most common pattern
- `## Off-Limits` -- files or patterns Copilot should never suggest

### .mcp.json Starter (3 Essential Servers)

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-memory"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "git": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-git", "--repository", "."]
    }
  }
}
```

### review.md Command

See the full example in section 1.2. Customize the checklist to match your project's actual conventions.

### scout.md Agent

See the full example in section 1.2. The key constraint is "do NOT write code" -- this prevents Scout from short-circuiting the three-agent pattern.

---

*Last updated: 2025. Based on gstack (Garry Tan / YC) and LinkedIn Claude Code guide (Juan Minoprio), extended with production patterns for agentviz.*
