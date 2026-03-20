/**
 * Auto-detect session file format and route to the correct parser.
 *
 * Supported formats:
 *   - Copilot CLI JSONL (producer: "copilot-agent")
 *   - Claude Code JSONL (default fallback)
 *
 * Returns: { events, turns, metadata } or null
 */

import { detectCopilotCli, parseCopilotCliJSONL } from "./copilotCliParser.js";
import { parseClaudeCodeJSONL } from "./parser.js";

export function detectFormat(text) {
  if (detectCopilotCli(text)) return "copilot-cli";
  return "claude-code";
}

export function parseSession(text) {
  var format = detectFormat(text);

  if (format === "copilot-cli") {
    return parseCopilotCliJSONL(text);
  }

  return parseClaudeCodeJSONL(text);
}
