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