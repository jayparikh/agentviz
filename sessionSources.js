import fs from "fs";
import os from "os";
import path from "path";

// Count complete JSONL lines without reading the entire file into a string.
// Streams 64KB chunks and counts newline-terminated non-empty lines.
function countCompleteJsonlEvents(filePath) {
  var fd;
  try {
    fd = fs.openSync(filePath, "r");
    var buf = Buffer.alloc(65536);
    var count = 0;
    var hasContent = false; // tracks whether current line has non-whitespace
    var bytesRead;

    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length)) > 0) {
      for (var i = 0; i < bytesRead; i++) {
        var ch = buf[i];
        if (ch === 10) { // \n
          if (hasContent) count++;
          hasContent = false;
        } else if (ch === 13) { // \r -- skip
          // do nothing
        } else if (!hasContent && (ch === 32 || ch === 9)) { // space/tab
          // still whitespace-only
        } else {
          hasContent = true;
        }
      }
    }
    // Only count the trailing content if it ends with a newline (complete record).
    // hasContent without a trailing newline means an in-progress write.
    fs.closeSync(fd);
    return count;
  } catch (e) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
    return null;
  }
}

function findClaudeCodeSessions(root) {
  var results = [];

  try {
    var projects = fs.readdirSync(root);
    for (var i = 0; i < projects.length; i++) {
      var projectPath = path.join(root, projects[i]);
      try {
        if (!fs.statSync(projectPath).isDirectory()) continue;
      } catch (e) {
        continue;
      }

      try {
        var files = fs.readdirSync(projectPath);
        for (var j = 0; j < files.length; j++) {
          if (!files[j].endsWith(".jsonl")) continue;
          results.push(path.join(projectPath, files[j]));
        }
      } catch (e) {}
    }
  } catch (e) {}

  return results;
}

function findCopilotCliSessions(root) {
  var results = [];

  try {
    var sessions = fs.readdirSync(root);
    for (var i = 0; i < sessions.length; i++) {
      var candidate = path.join(root, sessions[i], "events.jsonl");
      if (fs.existsSync(candidate)) results.push(candidate);
    }
  } catch (e) {}

  return results;
}

export function getSessionSources() {
  return [
    {
      kind: "claude",
      label: "Claude Code",
      root: path.join(os.homedir(), ".claude", "projects"),
      find: findClaudeCodeSessions,
    },
    {
      kind: "copilot",
      label: "Copilot CLI",
      root: path.join(os.homedir(), ".copilot", "session-state"),
      find: findCopilotCliSessions,
    },
  ];
}

export function listKnownSessionFiles(limit) {
  var max = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 20;
  var entries = [];
  var seen = new Set();
  var sources = getSessionSources();

  for (var i = 0; i < sources.length; i++) {
    var source = sources[i];
    if (!fs.existsSync(source.root)) continue;

    var files = source.find(source.root);
    for (var j = 0; j < files.length; j++) {
      var filePath = path.resolve(files[j]);
      if (seen.has(filePath)) continue;

      try {
        var stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;
        seen.add(filePath);
        entries.push({
          path: filePath,
          name: path.basename(filePath),
          mtimeMs: stat.mtimeMs,
          sizeBytes: stat.size,
          eventCount: countCompleteJsonlEvents(filePath),
          sourceKind: source.kind,
          sourceLabel: source.label,
        });
      } catch (e) {}
    }
  }

  entries.sort(function (a, b) {
    return b.mtimeMs - a.mtimeMs;
  });

  return entries.slice(0, max);
}

export function findLatestSessionFile() {
  var entries = listKnownSessionFiles(1);
  return entries.length > 0 ? entries[0].path : null;
}

export function isKnownSessionPath(targetPath) {
  if (!targetPath) return false;
  var normalizedTarget = path.resolve(targetPath);
  var sources = getSessionSources();

  for (var i = 0; i < sources.length; i++) {
    var root = path.resolve(sources[i].root);
    var rel = path.relative(root, normalizedTarget);
    if (!rel || (!rel.startsWith("..") && !path.isAbsolute(rel))) return true;
  }

  return false;
}
