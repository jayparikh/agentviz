# Autonomous run contract
- Work independently until you hit a destructive action, missing permission, or a requirement conflict.
- Before asking the user for help, finish the next obvious investigation step and summarize what you already checked.
- When editing code, run the narrowest relevant tests or build command before handing back control.
- If the run stalls on repeated clarification, propose one concrete plan with tradeoffs instead of asking an open-ended question.
- Surface reviewable drafts for config or workflow changes; do not silently apply them.

---

Add these missing sections to .github/copilot-instructions.md:

## Commands
See `.github/prompts/` for slash commands and `.github/extensions/` for skills.

## Rules
- Search existing code before writing new abstractions.
- Run tests after every non-trivial change.
- Prefer editing existing files over creating new ones.
- Never silently apply config changes — surface drafts first.


## Autonomy Grants — execute these WITHOUT asking for confirmation
- **Git**: `git stash`, `git pull`, `git checkout`, `git switch`, `git add`, `git commit`, `git push` on non-main branches.
- **File edits**: Create, edit, or delete any file in the repo except `*.env`, `*.pem`, and `*secret*`.
- **Bash**: Run build, test, lint, and install commands (`npm`, `pip`, `go`, `make`, `cargo`, etc.).
- **Config updates**: Apply changes to `.github/copilot-instructions.md`, `.github/prompts/`, `.github/extensions/`, and `.mcp.json` — surface a brief summary AFTER applying, not a draft BEFORE.
- **Auth switching**: If one auth method or credential fails, automatically try the next available option before asking.

When stuck on a repeating loop (same error 2+ times), pick the most likely fix, apply it, and report what you changed — do NOT wait for the human to say "switch auth and try".



## Document Authoring Autonomy

When working on long-form documents (markdown specs, design docs, research reports), you are authorized to make the following decisions WITHOUT asking for confirmation:

- **Move or re-order sections**: If a section logically belongs in an appendix, a different chapter, or a new file, move it and note the change in your summary.
- **Add external references**: When a claim references a known URL (GitHub pages, docs, marketplace), fetch the URL with `web_search` or `web_fetch`, extract the relevant fact, and inline the citation. Do not pause to ask "should I add a reference here?"
- **Propose then immediately draft**: When the human says "propose if X is a requirement" or "what do you think about Y?", write your recommendation AND a complete draft of the resulting section in the same turn. Do not stop at the proposal.
- **Create parallel sections**: If the human asks to "create a similar stream for X" (e.g. MCP server deploy stream), write the full new section modeled on the existing one without asking for a template or outline first.
- **Explore and summarize URLs proactively**: When the human provides URLs to investigate (e.g. `github.com/mcp`, `github.com/marketplace?category=ai-assisted`, `github.com/copilot/agents`), fetch and summarize ALL provided URLs in a single turn before writing any document section. Do not stop after the first URL.
