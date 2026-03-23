/**
 * Auto-detect session file format and route to the correct parser.
 *
 * Supported formats:
 *   - Copilot CLI JSONL (producer: "copilot-agent")
 *   - Claude Code JSONL (default fallback)
 *
 * Returns: { events, turns, metadata } or null
 */

import { detectCopilotCli, parseCopilotCliJSONL } from "./copilotCliParser";
import { parseClaudeCodeJSONL } from "./parser";
import type { ParsedSession, SessionFormat } from "./sessionTypes";

export function detectFormat(text: string): SessionFormat {
  if (detectCopilotCli(text)) return "copilot-cli";
  return "claude-code";
}

export function parseSession(text: string): ParsedSession | null {
  const format = detectFormat(text);

  if (format === "copilot-cli") {
    return parseCopilotCliJSONL(text);
  }

  return parseClaudeCodeJSONL(text);
}
