export const SAMPLE_EVENTS = [
  { t: 0, agent: "user", track: "output", text: "Build a REST API with JWT authentication in Express.js and TypeScript", duration: 1, intensity: 0.6, isError: false, turnIndex: 0 },
  { t: 1, agent: "assistant", track: "reasoning", text: "Planning directory layout: routes/, middleware/, models/, utils/. Will use JWT for auth with refresh tokens.", duration: 2, intensity: 0.8, isError: false, model: "claude-sonnet-4-20250514", turnIndex: 0 },
  { t: 3, agent: "assistant", track: "tool_call", text: "bash(command: mkdir -p src/{routes,middleware,models,utils} && npm init -y)", toolName: "bash", duration: 2, intensity: 0.9, isError: false, turnIndex: 0 },
  { t: 5, agent: "assistant", track: "context", text: "Result: Project initialized. package.json created. Directory structure ready.", duration: 1, intensity: 0.5, isError: false, turnIndex: 0 },
  { t: 6, agent: "assistant", track: "tool_call", text: "write_file(path: src/routes/auth.ts) - JWT authentication routes", toolName: "write_file", duration: 3, intensity: 1.0, isError: false, turnIndex: 0 },
  { t: 9, agent: "assistant", track: "tool_call", text: "write_file(path: src/middleware/auth.ts) - JWT verification middleware", toolName: "write_file", duration: 2, intensity: 0.9, isError: false, turnIndex: 0 },
  { t: 11, agent: "assistant", track: "tool_call", text: "write_file(path: src/routes/users.ts) - CRUD endpoints for users", toolName: "write_file", duration: 2, intensity: 0.9, isError: false, turnIndex: 0 },
  { t: 13, agent: "assistant", track: "reasoning", text: "Now adding error handling middleware and wiring up the main app entry point. Should also add rate limiting on auth routes.", duration: 2, intensity: 0.7, isError: false, turnIndex: 0 },
  { t: 15, agent: "assistant", track: "tool_call", text: "write_file(path: src/index.ts) - Main Express app with middleware chain", toolName: "write_file", duration: 2, intensity: 0.9, isError: false, turnIndex: 0 },
  { t: 17, agent: "assistant", track: "tool_call", text: "bash(command: npx tsc --noEmit) - Type checking", toolName: "bash", duration: 2, intensity: 0.8, isError: false, turnIndex: 0 },
  { t: 19, agent: "assistant", track: "context", text: "Result: Type check passed. No errors.", duration: 1, intensity: 0.5, isError: false, turnIndex: 0 },
  { t: 20, agent: "assistant", track: "tool_call", text: "bash(command: npm test) - Running test suite", toolName: "bash", duration: 2, intensity: 0.9, isError: false, turnIndex: 0 },
  { t: 22, agent: "assistant", track: "output", text: "REST API with JWT auth is ready. 5 files, 380 lines of TypeScript. Run npm run dev to start.", duration: 2, intensity: 0.8, isError: false, turnIndex: 0 },
];

export const SAMPLE_TOTAL = 25;

export const SAMPLE_TURNS = [
  { index: 0, startTime: 0, endTime: 24, eventIndices: [0,1,2,3,4,5,6,7,8,9,10,11,12], userMessage: "Build a REST API with JWT authentication in Express.js and TypeScript", toolCount: 7, hasError: false },
];

export const SAMPLE_METADATA = {
  totalEvents: 13,
  totalTurns: 1,
  totalToolCalls: 7,
  errorCount: 0,
  duration: 25,
  models: { "claude-sonnet-4-20250514": 2 },
  primaryModel: "claude-sonnet-4-20250514",
  tokenUsage: null,
  format: "claude-code",
};

// Multi-agent demo: two parallel agents (explore + code-review) then a failing general-purpose agent
export const MULTIAGENT_SAMPLE_EVENTS = [
  { t: 0, agent: "user", track: "output", text: "Review this code and fix the bugs", duration: 0.5, intensity: 0.9, isError: false, turnIndex: 0 },
  { t: 1, agent: "assistant", track: "reasoning", text: "I will launch parallel agents to review and fix the code.", duration: 0.5, intensity: 0.7, isError: false, turnIndex: 0 },
  { t: 2, agent: "assistant", track: "tool_call", text: "task: Explore codebase structure", toolName: "task", toolCallId: "tc-explore-1", duration: 8.5, intensity: 0.6, isError: false, turnIndex: 0, agentName: "explore", agentDisplayName: "Explore Agent" },
  { t: 2.5, agent: "assistant", track: "tool_call", text: "task: Review code quality", toolName: "task", toolCallId: "tc-review-1", duration: 10, intensity: 0.6, isError: false, turnIndex: 0, agentName: "code-review", agentDisplayName: "Code Review Agent" },
  { t: 3, agent: "system", track: "agent", text: "Explore Agent started", duration: 0.3, intensity: 0.5, isError: false, turnIndex: 0, toolCallId: "tc-explore-1", agentName: "explore", agentDisplayName: "Explore Agent" },
  { t: 3.5, agent: "system", track: "agent", text: "Code Review Agent started", duration: 0.3, intensity: 0.5, isError: false, turnIndex: 0, toolCallId: "tc-review-1", agentName: "code-review", agentDisplayName: "Code Review Agent" },
  { t: 4, agent: "assistant", track: "tool_call", text: "view: src/index.ts", toolName: "view", toolCallId: "tc-sub-view-1", parentToolCallId: "tc-explore-1", duration: 1, intensity: 0.6, isError: false, turnIndex: 0, agentName: "explore", agentDisplayName: "Explore Agent" },
  { t: 5, agent: "assistant", track: "tool_call", text: "grep: TODO|FIXME in src/", toolName: "grep", toolCallId: "tc-sub-grep-1", parentToolCallId: "tc-review-1", duration: 1.5, intensity: 0.6, isError: false, turnIndex: 0, agentName: "code-review", agentDisplayName: "Code Review Agent" },
  { t: 6, agent: "assistant", track: "tool_call", text: "view: src/utils.ts", toolName: "view", toolCallId: "tc-sub-view-2", parentToolCallId: "tc-explore-1", duration: 1, intensity: 0.6, isError: false, turnIndex: 0, agentName: "explore", agentDisplayName: "Explore Agent" },
  { t: 7, agent: "assistant", track: "tool_call", text: "grep: catch\\b in src/", toolName: "grep", toolCallId: "tc-sub-grep-2", parentToolCallId: "tc-review-1", duration: 1.5, intensity: 0.6, isError: false, turnIndex: 0, agentName: "code-review", agentDisplayName: "Code Review Agent" },
  { t: 10, agent: "system", track: "agent", text: "Explore Agent completed", duration: 7, intensity: 0.4, isError: false, turnIndex: 0, toolCallId: "tc-explore-1", agentName: "explore", agentDisplayName: "Explore Agent" },
  { t: 12, agent: "system", track: "agent", text: "Code Review Agent completed", duration: 8.5, intensity: 0.4, isError: false, turnIndex: 0, toolCallId: "tc-review-1", agentName: "code-review", agentDisplayName: "Code Review Agent" },
  { t: 13, agent: "assistant", track: "output", text: "Both agents have finished. The explore agent mapped the architecture and the review agent found 3 issues.", duration: 1, intensity: 0.7, isError: false, turnIndex: 0 },
  { t: 18, agent: "user", track: "output", text: "Now launch a general purpose agent to fix those", duration: 0.5, intensity: 0.9, isError: false, turnIndex: 1 },
  { t: 19, agent: "assistant", track: "reasoning", text: "Launching a general purpose agent to fix the issues.", duration: 0.5, intensity: 0.7, isError: false, turnIndex: 1 },
  { t: 20, agent: "assistant", track: "tool_call", text: "task: Fix code bugs", toolName: "task", toolCallId: "tc-gp-1", duration: 7.5, intensity: 0.6, isError: true, turnIndex: 1, agentName: "general-purpose", agentDisplayName: "General Purpose Agent" },
  { t: 21, agent: "system", track: "agent", text: "General Purpose Agent started", duration: 0.3, intensity: 0.5, isError: false, turnIndex: 1, toolCallId: "tc-gp-1", agentName: "general-purpose", agentDisplayName: "General Purpose Agent" },
  { t: 22, agent: "assistant", track: "tool_call", text: "edit: src/index.ts", toolName: "edit", toolCallId: "tc-sub-edit-1", parentToolCallId: "tc-gp-1", duration: 1, intensity: 0.6, isError: false, turnIndex: 1, agentName: "general-purpose", agentDisplayName: "General Purpose Agent" },
  { t: 24, agent: "assistant", track: "tool_call", text: "edit: src/utils.ts", toolName: "edit", toolCallId: "tc-sub-edit-2", parentToolCallId: "tc-gp-1", duration: 1.5, intensity: 0.6, isError: false, turnIndex: 1, agentName: "general-purpose", agentDisplayName: "General Purpose Agent" },
  { t: 27, agent: "system", track: "agent", text: "General Purpose Agent failed: Context window exceeded", duration: 6, intensity: 0.8, isError: true, turnIndex: 1, toolCallId: "tc-gp-1", agentName: "general-purpose", agentDisplayName: "General Purpose Agent" },
  { t: 28, agent: "assistant", track: "output", text: "The general purpose agent failed due to context limits. I will handle the remaining fixes directly.", duration: 1, intensity: 0.7, isError: false, turnIndex: 1 },
];

export const MULTIAGENT_SAMPLE_TOTAL = 30;

export const MULTIAGENT_SAMPLE_TURNS = [
  { index: 0, startTime: 0, endTime: 14, eventIndices: [0,1,2,3,4,5,6,7,8,9,10,11,12], userMessage: "Review this code and fix the bugs", toolCount: 6, hasError: false },
  { index: 1, startTime: 18, endTime: 29, eventIndices: [13,14,15,16,17,18,19,20], userMessage: "Now launch a general purpose agent to fix those", toolCount: 3, hasError: true },
];

export const MULTIAGENT_SAMPLE_METADATA = {
  totalEvents: 21,
  totalTurns: 2,
  totalToolCalls: 9,
  errorCount: 2,
  duration: 30,
  models: { "claude-opus-4.6": 4 },
  primaryModel: "claude-opus-4.6",
  tokenUsage: { inputTokens: 50000, outputTokens: 8000, cacheRead: 10000, cacheWrite: 2000 },
  format: "copilot-cli",
};
