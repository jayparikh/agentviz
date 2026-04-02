# Steering Insights — Hypotheses & Research

The Steering view captures human prompts that redirect AI agents. These patterns contain signal about taste, quality standards, and gaps in agent capability. This doc captures hypotheses for extracting actionable insights from steering data.

## Hypotheses

### H1: Steering Density Predicts Agent-Taste Alignment

- **Hypothesis:** High steering density (commands per hour) indicates the agent isn't matching the user's taste. Low or decreasing density indicates the agent is learning or already aligned.
- **Signal:** steering count / session duration
- **Expected outcome:** Density score per session that correlates with user satisfaction
- **Validate:** Compare density across sessions with and without skills enabled
- **Priority:** P0
- **Grade:** C — not yet validated

### H2: Repeated Corrections → Skill Candidates

- **Hypothesis:** If the same type of correction (tone, quality, naming, architecture) appears 3+ times, it should become a skill or agent instruction.
- **Signal:** Cluster steering commands by correction type, count frequency
- **Expected outcome:** Automatic identification of recurring patterns that warrant codification as skills
- **Validate:** Create the skill from the pattern, measure if steering density drops in subsequent sessions
- **Priority:** P0
- **Grade:** C — not yet validated

### H3: Token Cost per Steering Measures ROI of Skills

- **Hypothesis:** Each steering command burns tokens (the turns between steerings are wasted work). High token cost combined with a repeated pattern means a skill would save tokens.
- **Signal:** Token usage between consecutive steering commands
- **Expected outcome:** Cost-per-steering metric that quantifies the value of converting a pattern into a skill
- **Validate:** Compare token usage before and after skill creation for the same correction type
- **Priority:** P1
- **Grade:** C — not yet validated

### H4: Session Insights Summary Drives Learning

- **Hypothesis:** Generating top-3 actionable insights from steering patterns answers the question: "What would make this faster next time?"
- **Signal:** Steering patterns, correction types, token costs aggregated per session
- **Expected outcome:** End-of-session summary that identifies concrete improvements
- **Validate:** User reports faster subsequent sessions after applying suggested changes
- **Priority:** P0
- **Grade:** C — not yet validated

### H5: Operational Principles Extraction

- **Hypothesis:** Reusable rules the user enforced through steering can be extracted automatically. These become candidate agent instructions or skill definitions.
- **Signal:** Imperative statements in steering commands (e.g., "always use…", "never do…", "prefer…")
- **Expected outcome:** A list of extracted principles per session, ranked by enforcement frequency
- **Validate:** Extracted principles match the user's stated preferences when reviewed
- **Priority:** P1
- **Grade:** C — not yet validated

### H6: Steering Predicts Quality Gates

- **Hypothesis:** Steering that leads to test creation or eval improvement indicates a quality standard the agent missed initially.
- **Signal:** Steering commands followed by test or eval commits within the same session
- **Expected outcome:** Correlation between steering types and downstream quality artifacts
- **Validate:** Correlate steering type with subsequent test additions in commit history
- **Priority:** P2
- **Grade:** C — not yet validated

### H7: Sub-Agent Dispatch Patterns

- **Hypothesis:** Analyzing which squad members get dispatched most frequently after steering reveals which capabilities are most often misaligned.
- **Signal:** `tool_call` events following steering commands, grouped by agent type
- **Expected outcome:** Dispatch frequency heatmap showing which roles compensate for steering gaps
- **Validate:** Compare dispatch patterns across sessions with different steering profiles
- **Priority:** P2
- **Grade:** C — not yet validated

### H8: Diminishing Returns Detection

- **Hypothesis:** Multiple steerings on the same topic with no improvement suggests the agent or model can't handle the task — the user should switch approach or escalate.
- **Signal:** Repeated steering on the same topic with no quality improvement in subsequent output
- **Expected outcome:** Detection of plateaus where further steering is unproductive
- **Validate:** Detect plateaus in steering effectiveness by measuring output quality delta per steering
- **Priority:** P2
- **Grade:** C — not yet validated

## Grading Scale

| Grade | Meaning |
|-------|---------|
| A | Validated with data, actionable |
| B | Partially validated, promising signal |
| C | Hypothesis only, not yet tested |
| D | Tested, inconclusive |
| F | Tested, disproven |

## Next Steps

- Implement H1 (density score) and H4 (insights summary) in the Steering view
- Collect data across multiple sessions to validate H2 and H3
- Design skill creation workflow based on H2 findings
