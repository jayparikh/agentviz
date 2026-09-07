/**
 * Session discovery, file serving, and SSE streaming routes.
 *
 * Handles:
 *   GET /api/sessions -- discover Claude Code, Codex, VS Code, & Copilot CLI sessions
 *   GET /api/session  -- serve a single session file from HOME
 *   GET /api/file     -- serve the active watched session file
 *   GET /api/meta     -- return filename & live status
 *   GET /api/stream   -- SSE endpoint for live session updates
 */

import fs from "fs";
import path from "path";
import { createHash } from "node:crypto";
import { discoverSessions } from "./discovery.js";

export function liveBoundaryHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 24);
}

export function getVSCodeStorageRoots(homeDir) {
  var roots = [];
  var variants = ["Code", "Code - Insiders"];

  if (process.platform === "win32") {
    var appData = process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
    variants.forEach(function (variant) {
      roots.push(path.join(appData, variant, "User", "workspaceStorage"));
    });
  } else if (process.platform === "darwin") {
    variants.forEach(function (variant) {
      roots.push(path.join(homeDir, "Library", "Application Support", variant, "User", "workspaceStorage"));
    });
  } else {
    var configDir = process.env.XDG_CONFIG_HOME || path.join(homeDir, ".config");
    variants.forEach(function (variant) {
      roots.push(path.join(configDir, variant, "User", "workspaceStorage"));
    });
  }
  return roots;
}

/**
 * Given a list of filenames, return only those that are .json or .jsonl,
 * preferring .json when both exist for the same basename.
 */
export function filterSessionFiles(filenames) {
  var jsonBaseNames = {};
  for (var i = 0; i < filenames.length; i++) {
    if (filenames[i].endsWith(".json")) jsonBaseNames[filenames[i].replace(/\.json$/, "")] = true;
  }
  var result = [];
  for (var j = 0; j < filenames.length; j++) {
    var f = filenames[j];
    if (!f.endsWith(".json") && !f.endsWith(".jsonl")) continue;
    if (f.endsWith(".jsonl") && jsonBaseNames[f.replace(/\.jsonl$/, "")]) continue;
    result.push(f);
  }
  return result;
}

/**
 * List VS Code Copilot Chat session files under a workspaceStorage root.
 */
export function findVSCodeSessionFiles(root) {
  var results = [];
  try {
    var workspaceIds = fs.readdirSync(root);
    for (var i = 0; i < workspaceIds.length; i++) {
      var chatDir = path.join(root, workspaceIds[i], "chatSessions");
      try {
        if (!fs.statSync(chatDir).isDirectory()) continue;
      } catch (e) {
        continue;
      }
      var files = filterSessionFiles(fs.readdirSync(chatDir));
      for (var j = 0; j < files.length; j++) {
        results.push(path.join(chatDir, files[j]));
      }
    }
  } catch (e) {}
  return results;
}

function extractJSONFieldValue(snippet, fieldName, maxLength) {
  if (!snippet) return null;
  var fieldPattern = new RegExp('"' + fieldName + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.){1,' + maxLength + '})"');
  var match = snippet.match(fieldPattern);
  if (!match) return null;
  try {
    return JSON.parse('"' + match[1] + '"');
  } catch (e) {
    return null;
  }
}

export function extractVSCodeCustomTitle(snippet) {
  return extractJSONFieldValue(snippet, "customTitle", 120);
}

export function extractVSCodeSessionId(snippet) {
  return extractJSONFieldValue(snippet, "sessionId", 200);
}

export function readVSCodeSessionPreview(filePath, fileSize) {
  var fd = null;
  try {
    fd = fs.openSync(filePath, "r");
    var headSize = Math.min(fileSize, 2048);
    var tailSize = Math.min(fileSize, 2048);
    var headBuf = Buffer.alloc(headSize);
    var tailBuf = Buffer.alloc(tailSize);
    fs.readSync(fd, headBuf, 0, headSize, 0);
    fs.readSync(fd, tailBuf, 0, tailSize, Math.max(0, fileSize - tailSize));

    var headSnippet = headBuf.toString("utf8");
    var tailSnippet = tailBuf.toString("utf8");
    var combinedSnippet = fileSize <= headSize ? headSnippet : headSnippet + "\n" + tailSnippet;

    // sessionId is a top-level field before "requests". Truncate at the
    // "requests" key boundary to avoid matching nested sessionId values.
    var requestsIdx = headSnippet.indexOf('"requests"');
    var sessionIdSnippet = requestsIdx > 0 ? headSnippet.slice(0, requestsIdx) : headSnippet.slice(0, 512);

    return {
      sessionId: extractVSCodeSessionId(sessionIdSnippet),
      title: extractVSCodeCustomTitle(combinedSnippet),
    };
  } catch (e) {
    return { sessionId: null, title: null };
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (closeError) {}
    }
  }
}

export function readVSCodeCustomTitle(filePath, fileSize) {
  return readVSCodeSessionPreview(filePath, fileSize).title;
}

/**
 * Clips text to fit within maxLength (including "..." suffix).
 * Normalizes whitespace before truncating. Returns null for empty input.
 * Differs from formatTime.truncateText which keeps `max` chars then appends "...".
 */
export function clipToLength(text, maxLength) {
  if (!text) return null;
  var normalized = String(text).replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > maxLength ? normalized.substring(0, maxLength - 3) + "..." : normalized;
}

export function readCopilotCliSessionPreview(filePath, fileSize) {
  var fd = null;
  try {
    fd = fs.openSync(filePath, "r");
    var headSize = Math.min(fileSize, 65536);
    var headBuf = Buffer.alloc(headSize);
    fs.readSync(fd, headBuf, 0, headSize, 0);

    var snippet = headBuf.toString("utf8");
    var lines = snippet.split(/\r?\n/);

    for (var index = 0; index < lines.length; index += 1) {
      var line = lines[index].trim();
      if (!line) continue;
      try {
        var record = JSON.parse(line);
        if (record.type !== "user.message" || !record.data) continue;
        var content = clipToLength(record.data.content || record.data.transformedContent, 120);
        if (!content) return { title: null, isContinuationSummary: false };
        return {
          title: content,
          isContinuationSummary: content.startsWith("Summarize the following conversation for context continuity."),
        };
      } catch (e) {}
    }

    return { title: null, isContinuationSummary: false };
  } catch (e) {
    return { title: null, isContinuationSummary: false };
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (closeError) {}
    }
  }
}

export function findCodexSessionFiles(root) {
  var results = [];
  function listDir(dir) {
    try {
      return fs.readdirSync(dir);
    } catch (e) {
      return [];
    }
  }
  function isPlainDirectory(dir) {
    try {
      var stat = fs.lstatSync(dir);
      return stat.isDirectory() && !stat.isSymbolicLink();
    } catch (e) {
      return false;
    }
  }
  function isPlainFile(filePath) {
    try {
      var stat = fs.lstatSync(filePath);
      return stat.isFile() && !stat.isSymbolicLink();
    } catch (e) {
      return false;
    }
  }

  if (!isPlainDirectory(root)) return results;
  listDir(root).forEach(function (year) {
    if (!/^\d{4}$/.test(year)) return;
    var yearDir = path.join(root, year);
    if (!isPlainDirectory(yearDir)) return;
    listDir(yearDir).forEach(function (month) {
      if (!/^\d{2}$/.test(month)) return;
      var monthDir = path.join(yearDir, month);
      if (!isPlainDirectory(monthDir)) return;
      listDir(monthDir).forEach(function (day) {
        if (!/^\d{2}$/.test(day)) return;
        var dayDir = path.join(monthDir, day);
        if (!isPlainDirectory(dayDir)) return;
        listDir(dayDir).forEach(function (fname) {
          if (!/^rollout-.+\.jsonl$/.test(fname)) return;
          var filePath = path.join(dayDir, fname);
          if (isPlainFile(filePath)) results.push(filePath);
        });
      });
    });
  });
  return results;
}

function flattenCodexContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(function (part) {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    return typeof part.text === "string" ? part.text : "";
  }).filter(Boolean).join("\n");
}

export function readCodexSessionPreview(filePath, fileSize) {
  var fd = null;
  try {
    fd = fs.openSync(filePath, "r");
    var headSize = Math.min(fileSize, 128 * 1024);
    var headBuf = Buffer.alloc(headSize);
    fs.readSync(fd, headBuf, 0, headSize, 0);
    var lines = headBuf.toString("utf8").split(/\r?\n/);
    var meta = {};
    var summary = null;
    var firstUserMessage = null;
    var model = null;
    var cwd = null;

    for (var index = 0; index < lines.length; index += 1) {
      var line = lines[index].trim();
      if (!line) continue;
      var record;
      try {
        record = JSON.parse(line);
      } catch (e) {
        continue;
      }
      var payload = record && record.payload && typeof record.payload === "object" ? record.payload : {};
      if (record.type === "session_meta") {
        meta = payload;
        if (typeof payload.cwd === "string") cwd = payload.cwd;
      }
      if (record.type === "turn_context") {
        if (!summary && typeof payload.summary === "string") summary = clipToLength(payload.summary, 120);
        if (!model && typeof payload.model === "string") model = payload.model;
        if (!cwd && typeof payload.cwd === "string") cwd = payload.cwd;
      }
      if (!firstUserMessage && record.type === "response_item" && payload.type === "message" && payload.role === "user") {
        firstUserMessage = clipToLength(flattenCodexContent(payload.content), 120);
      }
      if (!firstUserMessage && record.type === "event_msg" && payload.type === "user_message") {
        firstUserMessage = clipToLength(payload.message || flattenCodexContent(payload.text_elements), 120);
      }
      if (meta.id && (firstUserMessage || summary) && model) break;
    }

    return {
      sessionId: typeof meta.id === "string" ? meta.id : null,
      title: firstUserMessage || summary || null,
      summary: summary,
      model: model,
      cwd: cwd,
      originator: typeof meta.originator === "string" ? meta.originator : null,
      cliVersion: typeof meta.cli_version === "string" ? meta.cli_version : null,
    };
  } catch (e) {
    return { sessionId: null, title: null, summary: null, model: null, cwd: null, originator: null, cliVersion: null };
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (closeError) {}
    }
  }
}

function isPathInsideRoot(root, targetPath) {
  var relative = path.relative(root, targetPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isCodexSessionPath(resolvedSessionPath, homeDir) {
  var root = path.join(homeDir, ".codex", "sessions");
  if (!isPathInsideRoot(root, resolvedSessionPath)) return false;
  var parts = path.relative(root, resolvedSessionPath).split(path.sep).filter(Boolean);
  return parts.length === 4
    && /^\d{4}$/.test(parts[0])
    && /^\d{2}$/.test(parts[1])
    && /^\d{2}$/.test(parts[2])
    && /^rollout-.+\.jsonl$/.test(parts[3]);
}

export function isAllowedSessionPath(resolvedSessionPath, homeDir) {
  if (!homeDir) return false;

  if (isPathInsideRoot(path.join(homeDir, ".claude", "projects"), resolvedSessionPath)) return true;
  if (isPathInsideRoot(path.join(homeDir, ".copilot", "session-state"), resolvedSessionPath)) return true;
  if (isCodexSessionPath(resolvedSessionPath, homeDir)) return true;

  return getVSCodeStorageRoots(homeDir).some(function (root) {
    if (!isPathInsideRoot(root, resolvedSessionPath)) return false;
    var parts = path.relative(root, resolvedSessionPath).split(path.sep).filter(Boolean);
    return parts.length >= 3 && parts[1] === "chatSessions";
  });
}

export function handle(pathname, req, res, ctx) {

  if (pathname === "/api/sessions") {
    res.setHeader("Content-Type", "application/json");
    if (req.method !== "GET") { res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return true; }

    var homeDir = process.env.HOME || process.env.USERPROFILE || "";
    discoverSessions(homeDir).then(function (results) {
      if (res.destroyed) return;
      res.writeHead(200);
      res.end(JSON.stringify(results));
    }).catch(function () {
      if (res.destroyed) return;
      res.writeHead(500);
      res.end(JSON.stringify({ error: "Unable to discover sessions" }));
    });
    return true;
  }

  if (pathname === "/api/session") {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    if (req.method !== "GET") { res.writeHead(405); res.end("Method not allowed"); return true; }
    var sessionPath = ctx.parsed.query.path;
    if (!sessionPath) { res.writeHead(400); res.end("Missing path"); return true; }

    var home = process.env.HOME || process.env.USERPROFILE || "";
    var resolvedSessionPath;
    try {
      resolvedSessionPath = fs.realpathSync(path.resolve(sessionPath));
    } catch (e) {
      res.writeHead(404); res.end("Not found"); return true;
    }

    // Restrict reads to known session directories
    if (!isAllowedSessionPath(resolvedSessionPath, home)) {
      res.writeHead(403); res.end("Forbidden"); return true;
    }
    if (!resolvedSessionPath.endsWith(".jsonl") && !resolvedSessionPath.endsWith(".json")) {
      res.writeHead(400); res.end("Only session files are served"); return true;
    }
    try {
      var sessionText = fs.readFileSync(resolvedSessionPath, "utf8");
      res.writeHead(200);
      res.end(sessionText);
    } catch (e) {
      res.writeHead(404); res.end("Not found");
    }
    return true;
  }

  if (pathname === "/api/file") {
    if (!ctx.sessionFile) { res.writeHead(404); res.end("No session file"); return true; }
    try {
      var bytes = fs.readFileSync(ctx.sessionFile);
      var headers = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };
      if (ctx.parsed.query.live === "1") {
        var offset = bytes.lastIndexOf(10) + 1;
        bytes = bytes.subarray(0, offset);
        headers["X-Agentviz-Offset"] = String(offset);
        headers["X-Agentviz-Cursor"] = offset + ":" + liveBoundaryHash(bytes.subarray(Math.max(0, offset - 64)));
      }
      res.writeHead(200, headers);
      res.end(bytes);
    } catch (e) {
      res.writeHead(500);
      res.end(e.message);
    }
    return true;
  }

  if (pathname === "/api/meta") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      filename: ctx.sessionFile ? path.basename(ctx.sessionFile) : null,
      path: ctx.sessionFile || null,
      live: Boolean(ctx.sessionFile),
    }));
    return true;
  }

  if (pathname === "/api/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    res.write("retry: 3000\n\n");
    if (ctx.subscribeLive && (ctx.parsed.query.offset != null || ctx.parsed.query.cursor != null || req.headers["last-event-id"])) {
      ctx.subscribeLive(req, res);
      return true;
    }
    ctx.clients.add(res);
    req.on("close", function () { ctx.clients.delete(res); });
    return true;
  }

  return false;
}
