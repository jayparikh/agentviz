export const FONT = "'JetBrains Mono', monospace";

export const AGENT_COLORS = {
  user: "#60a5fa",
  assistant: "#a78bfa",
  system: "#6b7280",
};

export const TRACK_TYPES = {
  reasoning: { label: "Reasoning", color: "#22d3ee", icon: "\u25C6" },
  tool_call: { label: "Tool Calls", color: "#f59e0b", icon: "\u25B6" },
  context: { label: "Context", color: "#a78bfa", icon: "\u25CE" },
  output: { label: "Output", color: "#34d399", icon: "\u25CF" },
};

export const ERROR_COLOR = "#ef4444";

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
  { t: 19, agent: "assistant", track: "context", text: "Result: 2 type errors in auth.ts - JWT_SECRET assertion needed, missing return type", duration: 1, intensity: 0.8, isError: true, turnIndex: 0 },
  { t: 20, agent: "assistant", track: "tool_call", text: "edit_file(path: src/routes/auth.ts) - Fixing type errors", toolName: "edit_file", duration: 2, intensity: 0.9, isError: false, turnIndex: 0 },
  { t: 22, agent: "assistant", track: "output", text: "REST API with JWT auth is ready. 5 files, 380 lines of TypeScript. Run npm run dev to start.", duration: 2, intensity: 0.8, isError: false, turnIndex: 0 },
];

export const SAMPLE_TOTAL = 25;

export const SAMPLE_TURNS = [
  { index: 0, startTime: 0, endTime: 24, eventIndices: [0,1,2,3,4,5,6,7,8,9,10,11,12], userMessage: "Build a REST API with JWT authentication in Express.js and TypeScript", toolCount: 7, hasError: true },
];

export const SAMPLE_METADATA = {
  totalEvents: 13,
  totalTurns: 1,
  totalToolCalls: 7,
  errorCount: 1,
  duration: 25,
  models: { "claude-sonnet-4-20250514": 2 },
  primaryModel: "claude-sonnet-4-20250514",
  tokenUsage: null,
};
