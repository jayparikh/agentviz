/**
 * Session discovery, file serving, and SSE streaming routes.
 *
 * Handles:
 *   GET /api/sessions -- discover Claude Code, VS Code, & Copilot CLI sessions
 *   GET /api/session  -- serve a single session file from HOME
 *   GET /api/file     -- serve the active watched session file
 *   GET /api/meta     -- return filename & live status
 *   GET /api/stream   -- SSE endpoint for live session updates
 */

import fs from "fs";
import path from "path";

function decodeProjectDir(dirName) {
  return (dirName || "").replace(/^-/, "").replace(/-/g, "/");
}

function projectLabel(dirName) {
  var parts = decodeProjectDir(dirName).split("/").filter(Boolean);
  return parts[parts.length - 1] || dirName;
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

function truncatePreviewText(text, maxLength) {
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
        var content = truncatePreviewText(record.data.content || record.data.transformedContent, 120);
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

function isPathInsideRoot(root, targetPath) {
  var relative = path.relative(root, targetPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function isAllowedSessionPath(resolvedSessionPath, homeDir) {
  if (!homeDir) return false;

  if (isPathInsideRoot(path.join(homeDir, ".claude", "projects"), resolvedSessionPath)) return true;
  if (isPathInsideRoot(path.join(homeDir, ".copilot", "session-state"), resolvedSessionPath)) return true;

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
    var results = [];

    // Claude Code: ~/.claude/projects/{project-dir}/{session-uuid}.jsonl
    var claudeRoot = path.join(homeDir, ".claude", "projects");
    try {
      fs.readdirSync(claudeRoot).forEach(function (projectDirName) {
        var projectPath = path.join(claudeRoot, projectDirName);
        try {
          if (!fs.statSync(projectPath).isDirectory()) return;
          fs.readdirSync(projectPath).forEach(function (fname) {
            if (!fname.endsWith(".jsonl")) return;
            var filePath = path.join(projectPath, fname);
            try {
              var stat = fs.statSync(filePath);
              results.push({ id: "claude-code:" + projectDirName + ":" + fname, path: filePath, filename: fname, project: projectLabel(projectDirName), projectDir: projectDirName, format: "claude-code", size: stat.size, mtime: stat.mtime.toISOString() });
            } catch (e) {}
          });
        } catch (e) {}
      });
    } catch (e) {}

    // Copilot CLI: ~/.copilot/session-state/{uuid}/events.jsonl
    var copilotRoot = path.join(homeDir, ".copilot", "session-state");
    try {
      fs.readdirSync(copilotRoot).forEach(function (sessionDirName) {
        var sessionDir = path.join(copilotRoot, sessionDirName);
        var eventsFile = path.join(sessionDir, "events.jsonl");
        try {
          var stat = fs.statSync(eventsFile);
          var label = sessionDirName.substring(0, 8);
          var repo = null;
          var branch = null;
          var summary = null;
          var preview = { title: null, isContinuationSummary: false };
          try {
            var yamlText = fs.readFileSync(path.join(sessionDir, "workspace.yaml"), "utf8");
            var inlineMatch = yamlText.match(/^summary:\s+(?!\|-\s*$)(.+)$/m);
            var blockMatch = yamlText.match(/^summary:\s*\|-\s*\n([ \t]+)(.+)$/m);
            var repoMatch = yamlText.match(/^repository:\s*(.+)$/m);
            var branchMatch = yamlText.match(/^branch:\s*(.+)$/m);
            if (inlineMatch && inlineMatch[1].trim()) {
              summary = inlineMatch[1].trim();
            } else if (blockMatch && blockMatch[2].trim()) {
              summary = blockMatch[2].trim();
            }
            if (repoMatch) repo = repoMatch[1].trim();
            if (branchMatch) branch = branchMatch[1].trim();

            if (summary && (
              summary.startsWith("Analyze this") ||
              (summary.includes("Session stats") && summary.includes("read_config"))
            )) {
              return; // skip AI coach subprocess sessions
            }

            if (summary) label = summary;
          } catch (e) {}
          if (!summary) {
            preview = readCopilotCliSessionPreview(eventsFile, stat.size);
            if (preview.isContinuationSummary) return;
            if (preview.title) label = preview.title;
          }
          results.push({ id: "copilot-cli:" + sessionDirName + ":events.jsonl", path: eventsFile, filename: "events.jsonl", file: preview.title || "events.jsonl", project: label, projectDir: sessionDirName, sessionId: sessionDirName, repository: repo, branch: branch, summary: summary || preview.title, format: "copilot-cli", size: stat.size, mtime: stat.mtime.toISOString() });
        } catch (e) {}
      });
    } catch (e) {}

    // VS Code Chat: {vscodeUserData}/workspaceStorage/*/chatSessions/*.json|*.jsonl
    var vscodeRoots = getVSCodeStorageRoots(homeDir);
    vscodeRoots.forEach(function (vscodeRoot) {
      var isInsiders = vscodeRoot.includes("Code - Insiders");
      try {
        fs.readdirSync(vscodeRoot).forEach(function (wsId) {
          var wsDir = path.join(vscodeRoot, wsId);
          var chatDir = path.join(wsDir, "chatSessions");
          try {
            if (!fs.statSync(chatDir).isDirectory()) return;
            // Derive project name from workspace.json folder path (once per workspace)
            var wsProject = null;
            try {
              var wsJson = JSON.parse(fs.readFileSync(path.join(wsDir, "workspace.json"), "utf8"));
              if (wsJson.folder) {
                var decoded = decodeURIComponent(wsJson.folder.replace(/^file:\/\/\//, ""));
                var segments = decoded.replace(/\\/g, "/").split("/").filter(Boolean);
                wsProject = segments[segments.length - 1] || null;
              }
            } catch (e) {}
            var sessionFiles = filterSessionFiles(fs.readdirSync(chatDir));
            sessionFiles.forEach(function (fname) {
              var filePath = path.join(chatDir, fname);
              try {
                var stat = fs.statSync(filePath);
                if (stat.size < 200) return;
                // Quick-parse for customTitle (appears near end of file)
                var preview = readVSCodeSessionPreview(filePath, stat.size);
                results.push({
                  id: "vscode-chat:" + wsId + ":" + fname,
                  path: filePath,
                  filename: fname,
                  file: preview.title || fname,
                  summary: preview.title || null,
                  project: wsProject,
                  sessionId: preview.sessionId,
                  format: "vscode-chat",
                  isInsiders: isInsiders,
                  size: stat.size,
                  mtime: stat.mtime.toISOString(),
                });
              } catch (e) {}
            });
          } catch (e) {}
        });
      } catch (e) {}
    });

    results.sort(function (a, b) { return new Date(b.mtime) - new Date(a.mtime); });
    res.writeHead(200);
    res.end(JSON.stringify(results.slice(0, 200)));
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
      var text = fs.readFileSync(ctx.sessionFile, "utf8");
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(text);
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
    ctx.clients.add(res);
    req.on("close", function () { ctx.clients.delete(res); });
    return true;
  }

  return false;
}
