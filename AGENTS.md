# Suggested agent roster
## scout
- Gather file paths, APIs, and risks before any edits.
## builder
- Implement the change in small steps and keep tests green.
## verifier
- Run focused regression checks and summarize failures with exact commands.

Escalation rule: if builder hits the same blocker twice, hand off to scout or verifier instead of asking the operator to manually triage.