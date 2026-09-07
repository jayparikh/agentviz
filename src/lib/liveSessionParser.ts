import { detectFormat, parseSession, pairToolCallsWithResults } from "./parseSession";
import { parseCopilotCliRecords } from "./copilotCliParser";
import { parseClaudeCodeRecords } from "./parser";
import { detectCodexRecords, parseCodexRecords } from "./codexParser";
import {
  applyVSCodeJsonlPatch,
  parseVSCodeChatSession,
  type VSCodeSession,
} from "./vscodeSessionParser";
import type { ParsedSession, SessionFormat } from "./sessionTypes";

type RawRecord = Record<string, any>;

interface ParseIssues {
  malformedLines: number;
  invalidEvents: number;
}

export interface LiveSessionParserState {
  rawText: string;
  pendingText: string;
  completeLineCount: number;
  parsedRecordCount: number;
  malformedLineCount: number;
  lastAppendParsedLineCount: number;
  format: SessionFormat | null;
  result: ParsedSession | null;
  records: RawRecord[];
  vscodeSession: VSCodeSession | null;
  initialFullParseCount: number;
  fallbackFullParseCount: number;
}

export interface LiveSessionParserUpdate {
  state: LiveSessionParserState;
  result: ParsedSession | null;
}

function createEmptyState(): LiveSessionParserState {
  return {
    rawText: "",
    pendingText: "",
    completeLineCount: 0,
    parsedRecordCount: 0,
    malformedLineCount: 0,
    lastAppendParsedLineCount: 0,
    format: null,
    result: null,
    records: [],
    vscodeSession: null,
    initialFullParseCount: 0,
    fallbackFullParseCount: 0,
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function appendRawText(previous: string, next: string): string {
  if (!previous) return next;
  if (!next) return previous;
  if (previous.endsWith("\n") || next.startsWith("\n")) return previous + next;
  return previous + "\n" + next;
}

function splitCompleteLines(text: string): { lines: string[]; pendingText: string } {
  if (!text) return { lines: [], pendingText: "" };

  const rawLines = text.split("\n");
  const endsWithNewline = text.endsWith("\n") || text.endsWith("\r");
  const lines: string[] = [];
  let pendingText = "";

  for (let index = 0; index < rawLines.length; index += 1) {
    const rawLine = rawLines[index];
    const trimmed = rawLine.trim();
    const isLast = index === rawLines.length - 1;
    if (!trimmed) continue;

    if (isLast && !endsWithNewline) {
      try {
        JSON.parse(trimmed);
        lines.push(trimmed);
      } catch {
        pendingText = rawLine;
      }
    } else {
      lines.push(trimmed);
    }
  }

  return { lines, pendingText };
}

function parseLines(lines: string[]): { records: RawRecord[]; malformedLines: number } {
  const records: RawRecord[] = [];
  let malformedLines = 0;

  for (let index = 0; index < lines.length; index += 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && typeof parsed === "object") {
        records.push(parsed);
      } else {
        malformedLines += 1;
      }
    } catch {
      malformedLines += 1;
    }
  }

  return { records, malformedLines };
}

function isCopilotStart(record: RawRecord): boolean {
  return (
    (record.type === "session.start" || record.type === "session.resume") &&
    record.data &&
    (record.data.producer === "copilot-agent" || record.data.copilotVersion)
  );
}

function isVSCodeBase(record: RawRecord): boolean {
  const value = record.v;
  return Boolean(
    record.kind === 0 &&
    value &&
    typeof value.version === "number" &&
    typeof value.sessionId === "string" &&
    Array.isArray(value.requests)
  );
}

function detectExplicitFormatFromRecords(records: RawRecord[]): SessionFormat | null {
  if (records.length === 0) return null;
  if (isCopilotStart(records[0])) return "copilot-cli";
  if (isVSCodeBase(records[0])) return "vscode-chat";
  if (detectCodexRecords(records)) return "codex";
  return null;
}

function detectFormatFromRecords(records: RawRecord[]): SessionFormat | null {
  return detectExplicitFormatFromRecords(records) || (records.length > 0 ? "claude-code" : null);
}

function createIssues(malformedLineCount: number): ParseIssues {
  return { malformedLines: malformedLineCount, invalidEvents: 0 };
}

function buildVSCodeSession(records: RawRecord[], existingSession: VSCodeSession | null): VSCodeSession | null {
  let session = existingSession;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (isVSCodeBase(record)) {
      session = cloneJson(record.v);
    } else if (session) {
      applyVSCodeJsonlPatch(session, record);
    }
  }

  return session;
}

function deriveResult(
  format: SessionFormat | null,
  records: RawRecord[],
  malformedLineCount: number,
  vscodeSession: VSCodeSession | null,
  appendedRecords?: RawRecord[],
): { result: ParsedSession | null; vscodeSession: VSCodeSession | null } {
  if (!format) return { result: null, vscodeSession };
  if (format === "codex") {
    return { result: parseCodexRecords(records, malformedLineCount), vscodeSession };
  }
  if (format === "copilot-cli") {
    return { result: parseCopilotCliRecords(records, malformedLineCount), vscodeSession };
  }
  if (format === "vscode-chat") {
    const session = buildVSCodeSession(appendedRecords || records, appendedRecords && vscodeSession ? cloneJson(vscodeSession) : null);
    return { result: session ? parseVSCodeChatSession(session) : null, vscodeSession: session };
  }
  return {
    result: parseClaudeCodeRecords(records, createIssues(malformedLineCount)),
    vscodeSession,
  };
}

function detectPlainVSCodeJson(text: string): boolean {
  try {
    const parsed = JSON.parse(text.trim());
    return Boolean(
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.version === "number" &&
      typeof parsed.sessionId === "string" &&
      Array.isArray(parsed.requests)
    );
  } catch {
    return false;
  }
}

function rebuildStateFromRawText(
  rawText: string,
  initialFullParseCount: number,
  fallbackFullParseCount: number,
): LiveSessionParserState {
  const split = splitCompleteLines(rawText);
  const parsed = parseLines(split.lines);
  const format = detectFormatFromRecords(parsed.records) || (rawText.trim() ? detectFormat(rawText) : null);
  const derived = deriveResult(format, parsed.records, parsed.malformedLines, null);
  const result = derived.result || (rawText.trim() ? parseSession(rawText) : null);
  if (result) pairToolCallsWithResults(result);

  return {
    rawText,
    pendingText: split.pendingText,
    completeLineCount: split.lines.length,
    parsedRecordCount: parsed.records.length,
    malformedLineCount: parsed.malformedLines,
    lastAppendParsedLineCount: 0,
    format,
    result,
    records: parsed.records,
    vscodeSession: derived.vscodeSession,
    initialFullParseCount,
    fallbackFullParseCount,
  };
}

export function createLiveSessionParser(initialText: string): LiveSessionParserState {
  if (!initialText.trim()) return createEmptyState();

  const state = rebuildStateFromRawText(initialText, detectPlainVSCodeJson(initialText) ? 1 : 0, 0);
  if (!state.result && detectPlainVSCodeJson(initialText)) {
    return { ...state, result: parseSession(initialText), format: "vscode-chat" };
  }
  return state;
}

export function appendLiveSessionText(
  previous: LiveSessionParserState,
  newText: string,
): LiveSessionParserUpdate {
  const rawText = previous.pendingText
    ? previous.rawText + newText
    : appendRawText(previous.rawText, newText);
  const split = splitCompleteLines(previous.pendingText + newText);
  const parsed = parseLines(split.lines);
  const incomingFormat = detectExplicitFormatFromRecords(parsed.records);

  if (previous.format && incomingFormat && incomingFormat !== previous.format) {
    const fallbackState = rebuildStateFromRawText(
      rawText,
      previous.initialFullParseCount,
      previous.fallbackFullParseCount + 1,
    );
    return { state: fallbackState, result: fallbackState.result };
  }

  const format = previous.format || incomingFormat || detectFormatFromRecords(parsed.records);
  const records = previous.records.concat(parsed.records);
  const malformedLineCount = previous.malformedLineCount + parsed.malformedLines;
  const derived = deriveResult(format, records, malformedLineCount, previous.vscodeSession, parsed.records);
  const result = derived.result || previous.result;
  if (result) pairToolCallsWithResults(result);

  const state: LiveSessionParserState = {
    rawText,
    pendingText: split.pendingText,
    completeLineCount: previous.completeLineCount + split.lines.length,
    parsedRecordCount: records.length,
    malformedLineCount,
    lastAppendParsedLineCount: split.lines.length,
    format,
    result,
    records,
    vscodeSession: derived.vscodeSession,
    initialFullParseCount: previous.initialFullParseCount,
    fallbackFullParseCount: previous.fallbackFullParseCount,
  };

  return { state, result };
}
