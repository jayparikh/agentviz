export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export type SessionFormat = "claude-code" | "copilot-cli";

export interface ParseIssues {
  malformedLines: number;
  invalidEvents: number;
}

export interface NormalizedEvent {
  t: number;
  agent: string;
  track: string;
  text: string;
  duration: number;
  intensity: number;
  toolName?: string;
  toolInput?: unknown;
  raw?: unknown;
  turnIndex?: number;
  isError: boolean;
  model?: string | null;
  tokenUsage?: TokenUsage | null;
  parentToolCallId?: string | null;
  [key: string]: unknown;
}

export interface EventEntry {
  index: number;
  event: NormalizedEvent;
}

export interface SessionTurn {
  index: number;
  startTime: number;
  endTime: number;
  eventIndices: number[];
  userMessage?: string;
  toolCount?: number;
  hasError?: boolean;
  [key: string]: unknown;
}

export interface SessionMetadata {
  totalEvents: number;
  totalTurns: number;
  totalToolCalls: number;
  errorCount: number;
  duration: number;
  models: Record<string, number>;
  primaryModel: string | null;
  tokenUsage?: TokenUsage | null;
  warnings?: string[];
  parseIssues?: ParseIssues;
  format?: SessionFormat;
  [key: string]: unknown;
}

export interface ParsedSession {
  events: NormalizedEvent[];
  turns: SessionTurn[];
  metadata: SessionMetadata;
}

export interface TimeMap {
  toPosition: (time: number) => number;
  toTime: (position: number) => number;
  displayTotal: number;
  hasCompression: boolean;
}

export interface WaterfallItem {
  event: NormalizedEvent;
  originalIndex: number;
  depth: number;
  parentToolCallId: string | null;
}

export interface WaterfallStats {
  totalCalls: number;
  maxConcurrency: number;
  maxDepth: number;
  longestTool: string | null;
  toolFrequency: Record<string, number>;
}

export interface WaterfallLayoutItem {
  item: WaterfallItem;
  top: number;
  height: number;
}
