/**
 * Shared session discovery -- finds Copilot CLI sessions exported via
 * /share file (local markdown) and /share gist (GitHub gists).
 */

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

/**
 * Discover copilot-session-*.md files in a directory.
 */
export function findSharedSessionFiles(searchDir) {
  var results = [];
  if (!searchDir) return results;

  try {
    var files = fs.readdirSync(searchDir);
    for (var i = 0; i < files.length; i++) {
      var fname = files[i];
      if (!fname.startsWith("copilot-session-") || !fname.endsWith(".md")) continue;
      var filePath = path.join(searchDir, fname);
      try {
        var stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size < 50) continue;

        var sessionId = fname.replace("copilot-session-", "").replace(".md", "");
        var preview = readSharedSessionPreview(filePath);

        results.push({
          id: "shared-file:" + fname,
          path: filePath,
          filename: fname,
          file: preview.title || fname,
          project: preview.title || "Shared session",
          sessionId: sessionId,
          summary: preview.title || null,
          format: "shared-md",
          source: "shared-file",
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          duration: preview.duration || null,
          startedAt: preview.startedAt || null,
        });
      } catch (e) {}
    }
  } catch (e) {}

  return results;
}

/**
 * Read the header of a shared session markdown file to extract metadata.
 *
 * Format:
 *   # Copilot CLI Session
 *   > **Session ID:** `<uuid>`
 *   > **Started:** <date>
 *   > **Duration:** <time>
 *   > **Exported:** <date>
 */
export function readSharedSessionPreview(filePath) {
  try {
    var fd = fs.openSync(filePath, "r");
    var buf = Buffer.alloc(2048);
    fs.readSync(fd, buf, 0, 2048, 0);
    fs.closeSync(fd);
    var text = buf.toString("utf8");

    var durationMatch = text.match(/\*\*Duration:\*\*\s*(.+)/);
    var startedMatch = text.match(/\*\*Started:\*\*\s*(.+)/);

    // Extract the first user message as the title
    var userMatch = text.match(/###\s+\u{1F464}\s+User\s*\n+([\s\S]*?)(?:\n---|\n###)/u);
    var title = null;
    if (userMatch) {
      title = userMatch[1].trim().substring(0, 120);
      if (title.length === 120) title += "...";
    }

    return {
      duration: durationMatch ? durationMatch[1].trim() : null,
      startedAt: startedMatch ? startedMatch[1].trim() : null,
      title: title,
    };
  } catch (e) {
    return { duration: null, startedAt: null, title: null };
  }
}

/**
 * Discover shared session gists via gh CLI.
 * Returns session entries for gists matching copilot-session-*.
 */
export function findSharedSessionGists() {
  var results = [];

  try {
    var output = execFileSync("gh", [
      "gist", "list", "--limit", "30",
      "--json", "id,description,files,createdAt,updatedAt",
    ], { timeout: 10000, encoding: "utf8" });

    var gists = JSON.parse(output);
    for (var i = 0; i < gists.length; i++) {
      var gist = gists[i];
      if (!gist.files || gist.files.length === 0) continue;

      var sessionFile = null;
      for (var j = 0; j < gist.files.length; j++) {
        var fname = gist.files[j].filename || gist.files[j];
        if (typeof fname === "string" && fname.startsWith("copilot-session-") && fname.endsWith(".md")) {
          sessionFile = fname;
          break;
        }
      }
      if (!sessionFile) continue;

      var sessionId = sessionFile.replace("copilot-session-", "").replace(".md", "");

      results.push({
        id: "shared-gist:" + gist.id,
        gistId: gist.id,
        filename: sessionFile,
        file: gist.description || sessionFile,
        project: gist.description || "Shared gist",
        sessionId: sessionId,
        summary: gist.description || null,
        format: "shared-md",
        source: "shared-gist",
        size: 0,
        mtime: gist.updatedAt || gist.createdAt || new Date().toISOString(),
      });
    }
  } catch (e) {
    // gh CLI not available or failed
  }

  return results;
}

/**
 * Parse a shared session markdown file into conversation turns.
 * Returns { turns: [...], metadata: {...} } for the transcript viewer.
 */
export function parseSharedSessionMarkdown(text) {
  var lines = text.split("\n");
  var turns = [];
  var currentTurn = null;
  var metadata = { sessionId: null, startedAt: null, duration: null, exportedAt: null };

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // Parse header metadata
    var sessionIdMatch = line.match(/\*\*Session ID:\*\*\s*`(.+)`/);
    if (sessionIdMatch) { metadata.sessionId = sessionIdMatch[1]; continue; }

    var startedMatch = line.match(/\*\*Started:\*\*\s*(.+)/);
    if (startedMatch) { metadata.startedAt = startedMatch[1].trim(); continue; }

    var durationMatch = line.match(/\*\*Duration:\*\*\s*(.+)/);
    if (durationMatch) { metadata.duration = durationMatch[1].trim(); continue; }

    var exportedMatch = line.match(/\*\*Exported:\*\*\s*(.+)/);
    if (exportedMatch) { metadata.exportedAt = exportedMatch[1].trim(); continue; }

    // Parse turn headers: ### <emoji> <type>
    var turnMatch = line.match(/^###\s+(.+?)\s+(User|Reasoning|Info|`(.+)`)$/);
    if (turnMatch) {
      if (currentTurn) turns.push(currentTurn);
      var icon = turnMatch[1];
      var typeLabel = turnMatch[2];
      var toolName = turnMatch[3] || null;

      var agent = "system";
      var track = "output";
      if (typeLabel === "User") { agent = "user"; track = "context"; }
      else if (typeLabel === "Reasoning") { agent = "assistant"; track = "reasoning"; }
      else if (toolName) { agent = "assistant"; track = "tool_call"; }
      else if (icon.includes("\u2139")) { agent = "system"; track = "output"; }

      currentTurn = { agent: agent, track: track, toolName: toolName, text: "", timestamp: null };

      // Look for timestamp in previous line
      if (i > 0) {
        var tsMatch = lines[i - 2] ? lines[i - 2].match(/\u23F1\uFE0F?\s*(.+)</) : null;
        if (tsMatch) currentTurn.timestamp = tsMatch[1].trim();
      }

      continue;
    }

    // Separator
    if (line.trim() === "---") {
      if (currentTurn) { turns.push(currentTurn); currentTurn = null; }
      continue;
    }

    // Content accumulation
    if (currentTurn) {
      currentTurn.text += (currentTurn.text ? "\n" : "") + line;
    }
  }

  if (currentTurn) turns.push(currentTurn);

  // Clean up turn text
  for (var j = 0; j < turns.length; j++) {
    turns[j].text = turns[j].text.trim();
  }

  return { turns: turns, metadata: metadata };
}
