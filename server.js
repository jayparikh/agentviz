/**
 * AgentViz local server.
 * Serves dist/ as a static SPA and provides:
 *   GET /api/file   -- returns the watched session file as text
 *   GET /api/meta   -- returns { filename } JSON
 *   GET /api/stream -- SSE endpoint, pushes new JSONL lines as the file grows
 */

import http from "http";
import fs from "fs";
import path from "path";
import url from "url";
import { execFile, execFileSync } from "child_process";

// ─────────────────────────────────────────────────────────────────────────────
// AI coach: detect available CLI and run analysis via claude -p or gh copilot
// ─────────────────────────────────────────────────────────────────────────────

function detectCli() {
  var candidates = [
    { name: "claude", test: ["--version"], format: "claude" },
    { name: "gh", test: ["copilot", "--version"], format: "gh-copilot" },
  ];
  for (var i = 0; i < candidates.length; i++) {
    try {
      execFileSync(candidates[i].name, candidates[i].test, { timeout: 3000, stdio: "pipe" });
      return candidates[i];
    } catch (e) { /* not available */ }
  }
  return null;
}

function buildCoachPrompt(payload) {
  var { format, primaryModel, totalEvents, totalTurns, errorCount, totalToolCalls,
    productiveRuntime, humanResponseTime, idleTime, interventions, autonomyEfficiency,
    topTools, errorSamples, userFollowUps, configSummary } = payload;

  var toolList = (topTools || []).slice(0, 8).map(function (t) { return t.name + " x" + t.count; }).join(", ");
  var errors = (errorSamples || []).slice(0, 5).map(function (e, i) { return (i + 1) + ". " + e; }).join("\n");
  var followUps = (userFollowUps || []).slice(0, 4).map(function (m) { return "- " + m; }).join("\n");

  return [
    "You are an AI agent workflow coach. Analyze this " + (format === "copilot-cli" ? "GitHub Copilot CLI" : "Claude Code") + " session and give 2-4 specific, actionable recommendations to improve autonomy and reduce human interventions.",
    "",
    "## Session stats",
    "- Model: " + (primaryModel || "unknown"),
    "- Events: " + (totalEvents || 0) + ", Turns: " + (totalTurns || 0) + ", Tool calls: " + (totalToolCalls || 0),
    "- Errors: " + (errorCount || 0),
    "- Productive runtime: " + (productiveRuntime || "0s"),
    "- Human response time: " + (humanResponseTime || "0s") + " (time agent waited for human input)",
    "- Idle time: " + (idleTime || "0s"),
    "- Interventions: " + (interventions || 0),
    "- Autonomy efficiency: " + (autonomyEfficiency || "0%"),
    "- Top tools: " + (toolList || "none"),
    "",
    errors ? "## Tool errors seen\n" + errors : "",
    followUps ? "## Human follow-up messages (shows where agent got stuck)\n" + followUps : "",
    configSummary ? "## Current config\n" + configSummary : "",
    "",
    "## Your response format",
    "Return a JSON array of recommendations. Each item:",
    '{ "title": "short title", "priority": "high|medium", "summary": "1-2 sentence problem description", "fix": "specific actionable fix", "draft": "exact text/config to copy-paste" }',
    "",
    "Be specific to what you see in the stats. If web fetches are failing, say exactly what to add. If there are bash errors, say what command failed and why. Do not give generic advice.",
    "Return ONLY the JSON array, no prose.",
  ].filter(Boolean).join("\n");
}

function runCliAnalysis(cli, prompt) {
  return new Promise(function (resolve, reject) {
    var args, env = Object.assign({}, process.env);
    if (cli.format === "claude") {
      args = ["-p", prompt, "--output-format", "text"];
    } else {
      // gh copilot explain takes a shell command -- use suggest instead for freeform
      args = ["copilot", "suggest", "-t", "generic", prompt];
    }
    execFile(cli.name, args, { timeout: 60000, maxBuffer: 512 * 1024, env: env }, function (err, stdout, stderr) {
      if (err) { reject(new Error(stderr || err.message)); return; }
      resolve(stdout.trim());
    });
  });
}

function parseCliOutput(raw) {
  // Extract JSON array from output -- claude may include prose around it
  var match = raw.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch (e) { return null; }
}

async function runAiCoachAnalysis(payload) {
  var cli = detectCli();
  if (!cli) throw new Error("No AI CLI found. Install claude or gh CLI.");
  var prompt = buildCoachPrompt(payload);
  var raw = await runCliAnalysis(cli, prompt);
  var recs = parseCliOutput(raw);
  if (!recs) throw new Error("Could not parse AI response: " + raw.substring(0, 200));
  return { recommendations: recs, cli: cli.name, raw: raw };
}


var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

export function getCompleteJsonlLines(content) {
  if (!content) return [];
  var normalized = content.replace(/\r\n/g, "\n");
  var hasTrailingNewline = normalized.endsWith("\n");
  var lines = normalized.split("\n");

  if (!hasTrailingNewline) {
    lines.pop();
  }

  return lines.filter(function (line) { return line.trim(); });
}

export function getJsonlStreamChunk(content, lastLineIdx) {
  var completeLines = getCompleteJsonlLines(content);

  if (completeLines.length <= lastLineIdx) {
    return { lines: [], nextLineIdx: lastLineIdx };
  }

  return {
    lines: completeLines.slice(lastLineIdx),
    nextLineIdx: completeLines.length,
  };
}

function serveStatic(res, filePath) {
  try {
    var data = fs.readFileSync(filePath);
    var ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  } catch (e) {
    res.writeHead(404);
    res.end("Not found");
  }
}

export function createServer({ sessionFile, distDir }) {
  var clients = new Set();
  var lastLineIdx = 0;
  var watcher = null;
  var watcherClosed = false;
  var pollInterval = null;

  function broadcastNewLines() {
    if (!sessionFile || clients.size === 0) return;
    try {
      var content = fs.readFileSync(sessionFile, "utf8");
      var update = getJsonlStreamChunk(content, lastLineIdx);
      var newLines = update.lines;
      lastLineIdx = update.nextLineIdx;
      if (newLines.length === 0) return;
      var payload = "data: " + JSON.stringify({ lines: newLines.join("\n") }) + "\n\n";
      for (var client of clients) {
        try { client.write(payload); } catch (e) { clients.delete(client); }
      }
    } catch (e) {}
  }

  if (sessionFile) {
    // Initialize from complete newline-terminated records only so a trailing
    // in-progress JSONL record can still be streamed once it is finished.
    try {
      var initContent = fs.readFileSync(sessionFile, "utf8");
      lastLineIdx = getCompleteJsonlLines(initContent).length;
    } catch (e) {}

    function attachWatcher() {
      try {
        watcher = fs.watch(sessionFile, function (eventType) {
          // macOS fs.watch fires "rename" for appends on some file systems / write patterns
          // (e.g. atomic write-then-rename). Accept both event types.
          if (eventType === "change" || eventType === "rename") {
            broadcastNewLines();
            // After a rename the inode may have changed, so the current watcher
            // may stop receiving events. Re-attach on the next tick so we keep
            // following the path rather than the old inode.
            if (eventType === "rename") {
              try { watcher.close(); } catch (e) {}
              setTimeout(function () {
                if (watcherClosed) return;
                // Only re-attach if the file still exists at the same path.
                try { fs.accessSync(sessionFile); } catch (e) { return; }
                attachWatcher();
              }, 50);
            }
          }
        });
        watcher.on("error", function (err) {
          process.stderr.write("AGENTVIZ: file watcher error: " + (err && err.message || err) + "\n");
          // Notify connected SSE clients so the UI can show the stream as disconnected
          var errPayload = "data: " + JSON.stringify({ error: "watcher_error" }) + "\n\n";
          for (var client of clients) {
            try { client.write(errPayload); } catch (e) { clients.delete(client); }
          }
        });
      } catch (e) {}
    }

    attachWatcher();

    // Polling fallback: macOS kqueue (used by fs.watch) coalesces or drops
    // events when a file is written to rapidly. Poll every 500ms so we never
    // miss new lines regardless of write pattern.
    pollInterval = setInterval(broadcastNewLines, 500);
  }

  var server = http.createServer(function (req, res) {
    try {
      handleRequest(req, res);
    } catch (err) {
      process.stderr.write("[agentviz] unhandled request error: " + req.url + "\n" + (err.stack || err.message) + "\n");
      try {
        if (!res.headersSent) { res.writeHead(500); res.end("Internal server error"); }
      } catch (e2) {}
    }
  });

  function handleRequest(req, res) {
    var parsed = url.parse(req.url, true);
    var pathname = parsed.pathname;

    res.setHeader("Access-Control-Allow-Origin", "*");

    if (pathname === "/api/config") {
      res.setHeader("Content-Type", "application/json");
      if (req.method !== "GET") {
        res.writeHead(405);
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      var CONFIG_SURFACES = [
        { id: "claude-md",            path: "CLAUDE.md",                       glob: null         },
        { id: "copilot-instructions", path: ".github/copilot-instructions.md", glob: null         },
        { id: "agents-md",            path: "AGENTS.md",                       glob: null         },
        { id: "claude-agents",        path: ".claude/agents",                  glob: ".md"        },
        { id: "claude-commands",      path: ".claude/commands",                glob: ".md"        },
        { id: "claude-rules",         path: ".claude/rules",                   glob: ".md"        },
        { id: "claude-skills",        path: ".claude/skills",                  glob: null         },
        { id: "mcp-json",             path: ".mcp.json",                       glob: null         },
        { id: "claude-settings",      path: ".claude/settings.json",           glob: null         },
        { id: "github-prompts",       path: ".github/prompts",                 glob: ".prompt.md" },
        { id: "github-extensions",    path: ".github/extensions",              glob: ".yml"       },
      ];

      var cwd = process.cwd();
      var configResults = CONFIG_SURFACES.map(function (surface) {
        var resolvedPath = path.resolve(cwd, surface.path);

        // Directory surface
        if (surface.glob !== null) {
          try {
            var entries = [];
            var dirEntries = fs.readdirSync(resolvedPath);
            var ext = surface.glob.replace(/^\*/, "");
            for (var di = 0; di < dirEntries.length; di++) {
              var entryName = dirEntries[di];
              if (!entryName.endsWith(ext)) continue;
              try {
                var entryPath = path.join(surface.path, entryName);
                var entryContent = fs.readFileSync(path.resolve(cwd, entryPath), "utf8");
                entries.push({ path: entryPath, content: entryContent });
              } catch (e2) {}
            }
            return { id: surface.id, path: surface.path, exists: true, entries: entries };
          } catch (e) {
            return { id: surface.id, path: surface.path, exists: false, entries: [] };
          }
        }

        // Single file surface
        try {
          var fileContent = fs.readFileSync(resolvedPath, "utf8");
          return { id: surface.id, path: surface.path, exists: true, content: fileContent };
        } catch (e) {
          return { id: surface.id, path: surface.path, exists: false, content: null };
        }
      });

      res.writeHead(200);
      res.end(JSON.stringify(configResults));
      return;
    }

    if (pathname === "/api/apply") {
      res.setHeader("Content-Type", "application/json");
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }
      var body = "";
      req.on("data", function (chunk) { body += chunk; });
      req.on("end", function () {
        try {
          var payload = JSON.parse(body);
          var relativePath = payload.relativePath;
          var content = payload.content;
          if (typeof relativePath !== "string" || !relativePath) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "relativePath is required" }));
            return;
          }
          if (typeof content !== "string") {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "content is required" }));
            return;
          }
          var cwd = process.cwd();
          var resolvedPath = path.resolve(cwd, relativePath);
          if (!resolvedPath.startsWith(cwd + path.sep) && resolvedPath !== cwd) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Path outside project directory" }));
            return;
          }
          var parentDir = path.dirname(resolvedPath);
          fs.mkdirSync(parentDir, { recursive: true });
          var fileExists = false;
          try { fs.accessSync(resolvedPath); fileExists = true; } catch (e) {}
          if (fileExists) {
            fs.appendFileSync(resolvedPath, "\n\n---\n\n" + content, "utf8");
          } else {
            fs.writeFileSync(resolvedPath, content, "utf8");
          }
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, path: resolvedPath }));
        } catch (e) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message || "Internal server error" }));
        }
      });
      return;
    }

    if (pathname === "/api/coach/analyze") {
      res.setHeader("Content-Type", "application/json");
      if (req.method !== "POST") { res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return; }
      var coachBody = "";
      req.on("data", function (chunk) { coachBody += chunk; });
      req.on("end", async function () {
        try {
          var payload = JSON.parse(coachBody);
          var result = await runAiCoachAnalysis(payload);
          res.writeHead(200);
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message || "AI analysis failed" }));
        }
      });
      return;
    }

    if (pathname === "/api/sessions") {
      res.setHeader("Content-Type", "application/json");
      if (req.method !== "GET") { res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return; }

      var homeDir = process.env.HOME || process.env.USERPROFILE || "";
      var results = [];

      // Claude Code: ~/.claude/projects/{project-dir}/{session-uuid}.jsonl
      var claudeRoot = path.join(homeDir, ".claude", "projects");
      function decodeProjectDir(dirName) {
        return (dirName || "").replace(/^-/, "").replace(/-/g, "/");
      }
      function projectLabel(dirName) {
        var parts = decodeProjectDir(dirName).split("/").filter(Boolean);
        return parts[parts.length - 1] || dirName;
      }
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

      // Copilot CLI: ~/.copilot/session-state/{uuid}/events.jsonl (flat -- one file per session dir)
      var copilotRoot = path.join(homeDir, ".copilot", "session-state");
      try {
        fs.readdirSync(copilotRoot).forEach(function (sessionDirName) {
          var sessionDir = path.join(copilotRoot, sessionDirName);
          var eventsFile = path.join(sessionDir, "events.jsonl");
          try {
            var stat = fs.statSync(eventsFile);
            // Read workspace.yaml for rich label (summary, repo, branch)
            var label = sessionDirName.substring(0, 8);
            var repo = null;
            var branch = null;
            var summary = null;
            try {
              var yamlText = fs.readFileSync(path.join(sessionDir, "workspace.yaml"), "utf8");
              var summaryMatch = yamlText.match(/^summary:\s*(.+)$/m);
              var repoMatch = yamlText.match(/^repository:\s*(.+)$/m);
              var branchMatch = yamlText.match(/^branch:\s*(.+)$/m);
              if (summaryMatch && summaryMatch[1].trim()) summary = summaryMatch[1].trim();
              if (repoMatch) repo = repoMatch[1].trim();
              if (branchMatch) branch = branchMatch[1].trim();
              if (summary) label = summary;
            } catch (e) {}
            results.push({ id: "copilot-cli:" + sessionDirName + ":events.jsonl", path: eventsFile, filename: "events.jsonl", project: label, projectDir: sessionDirName, sessionId: sessionDirName, repository: repo, branch: branch, summary: summary, format: "copilot-cli", size: stat.size, mtime: stat.mtime.toISOString() });
          } catch (e) {}
        });
      } catch (e) {}

      results.sort(function (a, b) { return new Date(b.mtime) - new Date(a.mtime); });
      res.writeHead(200);
      res.end(JSON.stringify(results));
      return;
    }

    if (pathname === "/api/session") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      if (req.method !== "GET") { res.writeHead(405); res.end("Method not allowed"); return; }
      var sessionPath = parsed.query.path;
      if (!sessionPath) { res.writeHead(400); res.end("Missing path"); return; }

      // Security: only serve files under HOME directory
      var homeDir2 = process.env.HOME || process.env.USERPROFILE || "";
      var resolvedSessionPath = path.resolve(sessionPath);
      if (!homeDir2 || !resolvedSessionPath.startsWith(homeDir2 + path.sep)) {
        res.writeHead(403); res.end("Forbidden"); return;
      }
      // Only serve .jsonl files
      if (!resolvedSessionPath.endsWith(".jsonl")) {
        res.writeHead(400); res.end("Only .jsonl files are served"); return;
      }
      try {
        var sessionText = fs.readFileSync(resolvedSessionPath, "utf8");
        res.writeHead(200);
        res.end(sessionText);
      } catch (e) {
        res.writeHead(404); res.end("Not found");
      }
      return;
    }

    if (pathname === "/api/file") {
      if (!sessionFile) { res.writeHead(404); res.end("No session file"); return; }
      try {
        var text = fs.readFileSync(sessionFile, "utf8");
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(text);
      } catch (e) {
        res.writeHead(500);
        res.end(e.message);
      }
      return;
    }

    if (pathname === "/api/meta") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        filename: sessionFile ? path.basename(sessionFile) : null,
        live: Boolean(sessionFile),
      }));
      return;
    }

    if (pathname === "/api/stream") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write("retry: 3000\n\n");
      clients.add(res);
      req.on("close", function () { clients.delete(res); });
      return;
    }

    // Static file serving
    var filePath = pathname === "/" || pathname === "/index.html"
      ? path.join(distDir, "index.html")
      : path.join(distDir, pathname);

    // Prevent directory traversal
    if (!filePath.startsWith(distDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    try {
      var stat = fs.statSync(filePath);
      if (stat.isFile()) {
        serveStatic(res, filePath);
      } else {
        serveStatic(res, path.join(distDir, "index.html"));
      }
    } catch (e) {
      // SPA fallback
      serveStatic(res, path.join(distDir, "index.html"));
    }
  } // end handleRequest

  server.on("close", function () {
    watcherClosed = true;
    if (watcher) watcher.close();
    if (pollInterval) clearInterval(pollInterval);
  });

  server.on("error", function (err) {
    process.stderr.write("[agentviz] server error: " + err.message + "\n" + (err.stack || "") + "\n");
  });

  return server;
}
