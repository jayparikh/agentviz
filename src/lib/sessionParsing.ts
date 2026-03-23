import { parseSession } from "./parseSession";
import { getSessionTotal } from "./session";
import type { ParsedSession } from "./sessionTypes";

export const SUPPORTED_FORMATS_ERROR = "Could not parse any events. Supported formats: Claude Code JSONL, Copilot CLI JSONL.";

export interface ParsedSessionTextResult {
  result: ParsedSession | null;
  error: string | null;
}

export interface AppliedSession {
  events: ParsedSession["events"];
  turns: ParsedSession["turns"];
  metadata: ParsedSession["metadata"];
  total: number;
  file: string;
  error: null;
  showHero: true;
}

type SessionParser = (text: string) => ParsedSession | null;

export function parseSessionText(text: string, parser?: SessionParser): ParsedSessionTextResult {
  const parse = parser || parseSession;

  try {
    const result = parse(text);
    if (!result || !result.events || result.events.length === 0) {
      return { result: null, error: SUPPORTED_FORMATS_ERROR };
    }

    return { result, error: null };
  } catch (error) {
    return {
      result: null,
      error: "Failed to parse file: " + (error instanceof Error ? error.message : "unknown error"),
    };
  }
}

export function buildAppliedSession(result: ParsedSession, name: string): AppliedSession {
  return {
    events: result.events,
    turns: result.turns,
    metadata: result.metadata,
    total: getSessionTotal(result.events),
    file: name,
    error: null,
    showHero: true,
  };
}
