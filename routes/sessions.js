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

function getVSCodeStorageRoots(homeDir) {
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
          results.push({ id: "copilot-cli:" + sessionDirName + ":events.jsonl", path: eventsFile, filename: "events.jsonl", project: label, projectDir: sessionDirName, sessionId: sessionDirName, repository: repo, branch: branch, summary: summary, format: "copilot-cli", size: stat.size, mtime: stat.mtime.toISOString() });
        } catch (e) {}
      });
    } catch (e) {}

    // VS Code Chat: {vscodeUserData}/workspaceStorage/*/chatSessions/*.json
    var vscodeRoots = getVSCodeStorageRoots(homeDir);
    vscodeRoots.forEach(function (vscodeRoot) {
      try {
        fs.readdirSync(vscodeRoot).forEach(function (wsId) {
          var chatDir = path.join(vscodeRoot, wsId, "chatSessions");
          try {
            if (!fs.statSync(chatDir).isDirectory()) return;
            fs.readdirSync(chatDir).forEach(function (fname) {
              if (!fname.endsWith(".json")) return;
              var filePath = path.join(chatDir, fname);
              try {
                var stat = fs.statSync(filePath);
                if (stat.size < 200) return;
                // Quick-parse for customTitle (appears near end of file)
                var title = null;
                try {
                  var fd = fs.openSync(filePath, "r");
                  var tailSize = Math.min(stat.size, 1024);
                  var buf = Buffer.alloc(tailSize);
                  fs.readSync(fd, buf, 0, tailSize, Math.max(0, stat.size - tailSize));
                  fs.closeSync(fd);
                  var snippet = buf.toString("utf8");
                  var titleMatch = snippet.match(/"customTitle"\s*:\s*"([^"]{1,120})"/);
                  if (titleMatch) title = titleMatch[1];
                } catch (e) {}
                results.push({
                  id: "vscode-chat:" + wsId + ":" + fname,
                  path: filePath,
                  filename: fname,
                  file: title || fname,
                  summary: title || null,
                  project: wsId.substring(0, 8),
                  format: "vscode-chat",
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
    var allowedRoots = [
      path.join(home, ".claude", "projects"),
      path.join(home, ".copilot", "session-state"),
    ].concat(getVSCodeStorageRoots(home));
    var isAllowed = allowedRoots.some(function (root) {
      return resolvedSessionPath.startsWith(root + path.sep);
    });
    if (!home || !isAllowed) {
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
