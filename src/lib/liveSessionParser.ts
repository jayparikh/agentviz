import { detectFormat, parseSession } from "./parseSession";
import { detectCodexRecords } from "./codexParser";
import { LiveClaudeNormalizer } from "./liveClaudeNormalizer";
import { LiveCopilotNormalizer } from "./liveCopilotNormalizer";
import { LiveCodexNormalizer } from "./liveCodexNormalizer";
import { LiveVSCodeNormalizer } from "./liveVSCodeNormalizer";
import type { LiveNormalizer, NormalizationWork } from "./liveNormalization";
import type { ParsedSession, SessionFormat } from "./sessionTypes";

type RawRecord = Record<string, any>;

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
  normalizer: LiveNormalizer | null;
  normalizationWork: NormalizationWork;
  snapshot: boolean;
  initialFullParseCount: number;
  fallbackFullParseCount: number;
}

export interface LiveSessionParserUpdate {
  state: LiveSessionParserState;
  result: ParsedSession | null;
}

function createEmptyState(snapshot = true): LiveSessionParserState {
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
    normalizer: null,
    normalizationWork: { records: 0, events: 0, turns: 0 },
    snapshot,
    initialFullParseCount: 0,
    fallbackFullParseCount: 0,
  };
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

function createNormalizer(format: SessionFormat | null): LiveNormalizer | null {
  if (format === "codex") return new LiveCodexNormalizer();
  if (format === "copilot-cli") return new LiveCopilotNormalizer();
  if (format === "vscode-chat") return new LiveVSCodeNormalizer();
  if (format === "claude-code") return new LiveClaudeNormalizer();
  return null;
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
  snapshot = true,
): LiveSessionParserState {
  const split = splitCompleteLines(rawText);
  const parsed = parseLines(split.lines);
  const plain = detectPlainVSCodeJson(rawText);
  if (plain) parsed.records = [JSON.parse(rawText)];
  const format = plain ? "vscode-chat" : detectFormatFromRecords(parsed.records.slice(0, 8)) || (rawText.trim() ? detectFormat(rawText) : null);
  const normalizer = createNormalizer(format);
  const result = normalizer?.append(parsed.records, parsed.malformedLines) || (rawText.trim() ? parseSession(rawText) : null);

  return {
    rawText,
    pendingText: split.pendingText,
    completeLineCount: split.lines.length,
    parsedRecordCount: parsed.records.length,
    malformedLineCount: parsed.malformedLines,
    lastAppendParsedLineCount: 0,
    format,
    result: snapshot && result ? structuredClone(result) : result,
    records: parsed.records,
    normalizer,
    normalizationWork: normalizer?.work || { records: 0, events: 0, turns: 0 },
    snapshot,
    initialFullParseCount,
    fallbackFullParseCount,
  };
}

export function createLiveSessionParser(initialText: string, options: { snapshot?: boolean } = {}): LiveSessionParserState {
  if (!initialText.trim()) return createEmptyState(options.snapshot);

  const state = rebuildStateFromRawText(initialText, detectPlainVSCodeJson(initialText) ? 1 : 0, 0, options.snapshot);
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
  const prefixFormat = detectFormatFromRecords(previous.records.slice(0, 8).concat(parsed.records.slice(0, Math.max(0, 8 - previous.records.length))));

  if (previous.format && ((incomingFormat && incomingFormat !== previous.format) || (prefixFormat && prefixFormat !== previous.format))) {
    const fallbackState = rebuildStateFromRawText(
      rawText,
      previous.initialFullParseCount,
      previous.fallbackFullParseCount + 1,
      previous.snapshot,
    );
    return { state: fallbackState, result: fallbackState.result };
  }

  const format = previous.format || prefixFormat || incomingFormat || detectFormatFromRecords(parsed.records);
  const records = previous.records;
  for (const record of parsed.records) records.push(record);
  const malformedLineCount = previous.malformedLineCount + parsed.malformedLines;
  const normalizer = previous.normalizer || createNormalizer(format);
  const normalized = normalizer?.append(parsed.records, malformedLineCount) || null;
  // Normalization retains mutable state. Publication is a separate O(history)
  // snapshot cost; workers omit this copy because postMessage already clones.
  const result = previous.snapshot && normalized ? structuredClone(normalized) : normalized;

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
    normalizer,
    normalizationWork: normalizer?.work || { records: 0, events: 0, turns: 0 },
    snapshot: previous.snapshot,
    initialFullParseCount: previous.initialFullParseCount,
    fallbackFullParseCount: previous.fallbackFullParseCount,
  };

  return { state, result };
}
