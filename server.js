/**
 * AGENTVIZ local server.
 * Serves dist/ as a static SPA and provides:
 *   GET /api/file   -- returns the watched session file as text
 *   GET /api/meta   -- returns { filename } JSON
 *   GET /api/stream -- SSE endpoint, pushes new JSONL lines as the file grows
 */

import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import url from "url";
import { runCoachAgent } from "./src/lib/aiCoachAgent.js";
import { runQAQuery } from "./src/lib/qaAgent.js";

// ── Model configuration ──────────────────────────────────────────
function getConfigPath() {
  var envPath = process.env.AGENTVIZ_CONFIG;
  if (envPath) return envPath;
  return path.join(os.homedir(), ".agentviz", "config.json");
}

export function getConfiguredModel() {
  var envModel = process.env.AGENTVIZ_MODEL;
  if (envModel) return envModel;
  try {
    var raw = fs.readFileSync(getConfigPath(), "utf8");
    var cfg = JSON.parse(raw);
    return cfg.model || null;
  } catch (_) {
    return null;
  }
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

  // ── Session insights helpers ──────────────────────────────────────────────

  function analyzeSessionJSONL(filePath, format) {
    try {
      var content = fs.readFileSync(filePath, "utf8");
      var lines = content.split("\n").filter(function (l) { return l.trim(); }).slice(0, 200);
      var turns = 0, errors = 0;
      var toolCounts = {};
      lines.forEach(function (line) {
        try {
          var ev = JSON.parse(line);
          if (format === "claude-code") {
            if (ev.type === "user") turns++;
            if (ev.type === "result" && ev.is_error) errors++;
            if (ev.type === "assistant" && ev.message && Array.isArray(ev.message.content)) {
              ev.message.content.forEach(function (block) {
                if (block.type === "tool_use") toolCounts[block.name] = (toolCounts[block.name] || 0) + 1;
              });
            }
          } else {
            if (ev.agent === "user" && ev.track === "output") turns++;
            if (ev.isError) errors++;
            if (ev.toolName) toolCounts[ev.toolName] = (toolCounts[ev.toolName] || 0) + 1;
          }
        } catch (_) {}
      });
      return { turns, errors, toolCounts };
    } catch (_) { return null; }
  }

  function classifyInsights(sessions, homeDir) {
    var insights = [];
    var total = sessions.length;
    if (total === 0) return insights;
    var analyzed = sessions.filter(function (s) { return s.stats; });

    // 1. Missing global instructions
    var hasInstructions = [
      path.join(homeDir, ".github", "copilot-instructions.md"),
      path.join(homeDir, "CLAUDE.md"),
      path.join(homeDir, "AGENTS.md"),
    ].some(function (p) { try { return fs.existsSync(p); } catch (_) { return false; } });

    if (!hasInstructions && total >= 5) {
      insights.push({
        id: "no-global-instructions",
        severity: total > 20 ? "high" : "medium",
        title: "No global instructions file",
        description: total + " sessions ran without global instructions. The AI starts context from scratch every time.",
        why: "Without instructions, the agent re-discovers your style, tools, and project patterns on every session. This adds context-setting turns that could be eliminated.",
        fix: "Create ~/.github/copilot-instructions.md with your preferences, tools, and conventions. It injects automatically into every session.",
        targetPath: "~/.github/copilot-instructions.md",
        draftContent: "# Copilot Instructions\n\n## Code style\n- Write clean, well-commented code\n- Follow existing conventions in the project\n- Prefer small, focused changes\n\n## Testing\n- Write tests for new functionality\n- Run existing tests before finishing\n\n## General\n- Ask for clarification on ambiguous requirements\n- Prefer incremental changes over large rewrites\n",
        affectedCount: total,
      });
    }

    // 2. High turn count
    var highTurn = analyzed.filter(function (s) { return s.stats.turns > 15; });
    if (highTurn.length >= 3) {
      var avgTurns = Math.round(highTurn.reduce(function (a, s) { return a + s.stats.turns; }, 0) / highTurn.length);
      insights.push({
        id: "high-turn-count",
        severity: avgTurns > 30 ? "high" : "medium",
        title: "Sessions averaging " + avgTurns + " turns",
        description: highTurn.length + " sessions averaged " + avgTurns + " turns — high back-and-forth usually signals missing context or unclear task framing.",
        why: "Long sessions cost more and take longer. Task-specific skills encode your preferred approach so the agent starts right instead of discovering it through conversation.",
        fix: "Create a skill for your most common task types to pre-load context and cut turns.",
        targetPath: "~/.copilot/skills/general/SKILL.md",
        draftContent: "# General Development Skill\n\n## Use when\nGeneral coding and development tasks.\n\n## Approach\n1. Review existing code style and conventions\n2. Make targeted changes with clear intent\n3. Write or update tests alongside changes\n4. Verify changes work before finishing\n\n## Output format\nDescribe what was changed and why. Show file paths and key additions.\n",
        affectedCount: highTurn.length,
      });
    }

    // 3. High error rate
    var errorSessions = analyzed.filter(function (s) { return s.stats.errors > 0; });
    if (analyzed.length >= 5 && errorSessions.length / analyzed.length > 0.3) {
      var rate = Math.round(errorSessions.length / analyzed.length * 100);
      insights.push({
        id: "high-error-rate",
        severity: rate > 60 ? "high" : "medium",
        title: "Tool errors in " + rate + "% of sessions",
        description: errorSessions.length + " of " + analyzed.length + " sessions had tool errors. Repeated failures slow sessions and require human recovery.",
        why: "Most tool errors come from missing prerequisites, wrong paths, or ambiguous task scope. Explicit environment notes prevent the agent from trying approaches that fail.",
        fix: "Add environment setup and common failure modes to your instructions so the agent avoids known problems.",
        targetPath: "~/.github/copilot-instructions.md",
        draftContent: "## Environment\n- Verify required tools are installed before running commands\n- Always check if a command is safe before executing it\n\n## Error handling\n- If a command fails, diagnose before retrying\n- Prefer read-only checks before mutations\n",
        affectedCount: errorSessions.length,
      });
    }

    // 4. Repeating workflow patterns
    var summaries = sessions.filter(function (s) { return s.summary; }).map(function (s) { return s.summary.toLowerCase(); });
    var PATTERNS = [
      { keywords: ["test", "spec", "coverage", "unit test"], label: "testing", agentName: "test-runner" },
      { keywords: ["deploy", "release", "publish", "ship"], label: "deployment", agentName: "deploy" },
      { keywords: ["review", "pull request", " pr ", "code review"], label: "code review", agentName: "code-reviewer" },
      { keywords: ["doc", "readme", "documentation", "comment"], label: "documentation", agentName: "docs-writer" },
      { keywords: ["refactor", "cleanup", "clean up", "lint", "optimize"], label: "refactoring", agentName: "refactor" },
    ];
    PATTERNS.forEach(function (p) {
      var matched = summaries.filter(function (s) { return p.keywords.some(function (k) { return s.includes(k); }); });
      if (matched.length >= 4) {
        insights.push({
          id: "repeating-" + p.agentName,
          severity: matched.length > 10 ? "medium" : "low",
          title: matched.length + " repeating " + p.label + " sessions",
          description: "You've run " + matched.length + " " + p.label + " sessions. This pattern is consistent enough to encode in a dedicated agent.",
          why: "Repeated task types benefit from pre-encoded instructions. Agents run the task in one turn with no context-setting — faster, cheaper, and more consistent.",
          fix: "Create a " + p.label + " agent so you can run `@" + p.agentName + " <target>` instead of starting a full session.",
          targetPath: "~/.copilot/agents/" + p.agentName + "/.agent.md",
          draftContent: "---\ndescription: " + p.label.charAt(0).toUpperCase() + p.label.slice(1) + " automation agent\n---\n\n# " + p.label.charAt(0).toUpperCase() + p.label.slice(1) + " Agent\n\nPerform " + p.label + " tasks efficiently.\n\n## Instructions\n1. Understand the scope from the input\n2. Apply consistent standards\n3. Report what was done\n",
          affectedCount: matched.length,
        });
      }
    });

    var sOrder = { high: 0, medium: 1, low: 2 };
    insights.sort(function (a, b) {
      var d = (sOrder[a.severity] || 2) - (sOrder[b.severity] || 2);
      return d !== 0 ? d : (b.affectedCount || 0) - (a.affectedCount || 0);
    });
    return insights;
  }

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
        { id: "claude-md",            path: "CLAUDE.md",                       glob: null,         skillDirs: false },
        { id: "copilot-instructions", path: ".github/copilot-instructions.md", glob: null,         skillDirs: false },
        { id: "agents-md",            path: "AGENTS.md",                       glob: null,         skillDirs: false },
        { id: "claude-agents",        path: ".claude/agents",                  glob: ".md",        skillDirs: false },
        { id: "claude-commands",      path: ".claude/commands",                glob: ".md",        skillDirs: false },
        { id: "claude-rules",         path: ".claude/rules",                   glob: ".md",        skillDirs: false },
        { id: "claude-skills",        path: ".claude/skills",                  glob: null,         skillDirs: false },
        { id: "mcp-json",             path: ".mcp.json",                       glob: null,         skillDirs: false },
        { id: "claude-settings",      path: ".claude/settings.json",           glob: null,         skillDirs: false },
        { id: "github-prompts",       path: ".github/prompts",                 glob: ".prompt.md", skillDirs: false },
        { id: "github-skills",        path: ".github/skills",                  glob: null,         skillDirs: true  },
        { id: "github-extensions",    path: ".github/extensions",              glob: ".yml",       skillDirs: false },
      ];

      var cwd = process.cwd();
      var configResults = CONFIG_SURFACES.map(function (surface) {
        var resolvedPath = path.resolve(cwd, surface.path);

        // Skills directory: each skill is a subdirectory containing SKILL.md
        if (surface.skillDirs) {
          try {
            var skillEntries = [];
            var subdirs = fs.readdirSync(resolvedPath, { withFileTypes: true });
            for (var si = 0; si < subdirs.length; si++) {
              if (!subdirs[si].isDirectory()) continue;
              var skillFile = path.join(resolvedPath, subdirs[si].name, "SKILL.md");
              try {
                var skillContent = fs.readFileSync(skillFile, "utf8");
                skillEntries.push({ path: path.join(surface.path, subdirs[si].name, "SKILL.md"), content: skillContent });
              } catch (e2) {}
            }
            return { id: surface.id, path: surface.path, exists: true, entries: skillEntries };
          } catch (e) {
            return { id: surface.id, path: surface.path, exists: false, entries: [] };
          }
        }

        // Regular directory surface
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
          // For .mcp.json, also extract server names for convenience
          var extra = {};
          if (surface.id === "mcp-json") {
            try {
              var mcpParsed = JSON.parse(fileContent);
              extra.mcpServers = Object.keys(mcpParsed.mcpServers || mcpParsed.servers || {});
            } catch (pe) {}
          }
          return Object.assign({ id: surface.id, path: surface.path, exists: true, content: fileContent }, extra);
        } catch (e) {
          return { id: surface.id, path: surface.path, exists: false, content: null };
        }
      });

      res.writeHead(200);
      res.end(JSON.stringify(configResults));
      return;
    }

    // Read a single file for preview before applying
    if (pathname === "/api/read-file") {
      res.setHeader("Content-Type", "application/json");
      if (req.method !== "GET") { res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return; }
      var qFilePath = parsedUrl.query.path || "";
      if (!qFilePath) { res.writeHead(400); res.end(JSON.stringify({ error: "path is required" })); return; }
      try {
        var qCwd = process.cwd();
        var qResolved = path.resolve(qCwd, qFilePath);
        if (!qResolved.startsWith(qCwd + path.sep) && qResolved !== qCwd) {
          res.writeHead(400); res.end(JSON.stringify({ error: "Path outside project" })); return;
        }
        var qContent = null;
        try { qContent = fs.readFileSync(qResolved, "utf8"); } catch (e) {}
        res.writeHead(200);
        res.end(JSON.stringify({ exists: qContent !== null, content: qContent }));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
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
          // Accept both 'relativePath' (static recs) and 'path' (AI recs)
          var relativePath = payload.relativePath || payload.path;
          var content = payload.content;
          var mode = payload.mode || "auto"; // "auto"|"append"|"merge"|"overwrite"
          if (typeof relativePath !== "string" || !relativePath) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "path is required" }));
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
          var originalContent = null;
          try { originalContent = fs.readFileSync(resolvedPath, "utf8"); fileExists = true; } catch (e) {}

          if (!fileExists || mode === "overwrite") {
            fs.writeFileSync(resolvedPath, content, "utf8");
          } else if (relativePath.endsWith(".mcp.json") || relativePath === ".mcp.json") {
            // Smart merge: merge mcpServers objects
            try {
              var existing = JSON.parse(originalContent);
              var incoming = JSON.parse(content);
              var merged = Object.assign({}, existing);
              if (incoming.mcpServers) {
                merged.mcpServers = Object.assign({}, existing.mcpServers || {}, incoming.mcpServers);
              }
              fs.writeFileSync(resolvedPath, JSON.stringify(merged, null, 2), "utf8");
            } catch (e) {
              fs.appendFileSync(resolvedPath, "\n\n" + content, "utf8");
            }
          } else if (mode === "append" || relativePath.endsWith(".md")) {
            fs.appendFileSync(resolvedPath, "\n\n" + content, "utf8");
          } else {
            fs.appendFileSync(resolvedPath, "\n\n---\n\n" + content, "utf8");
          }
          res.writeHead(200);
          // Return original content so the client can offer a revert
          res.end(JSON.stringify({ success: true, path: path.relative(cwd, resolvedPath), originalContent: originalContent }));
        } catch (e) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message || "Internal server error" }));
        }
      });
      return;
    }

    if (pathname === "/api/coach/analyze") {
      if (req.method !== "POST") {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return;
      }
      var coachBody = "";
      req.on("data", function (chunk) { coachBody += chunk; });
      req.on("end", async function () {
        var abort = new AbortController();
        // res.on("close") fires when the client drops the connection (e.g. navigates away)
        // req.on("close") fires too early when POST body is consumed -- do NOT use for SSE
        res.on("close", function () { abort.abort(); });

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.writeHead(200);

        function sseEvent(data) {
          if (!res.writableEnded) res.write("data: " + JSON.stringify(data) + "\n\n");
        }

        // Provide the agent with a readConfigFile function backed by disk
        var cwd = process.cwd();
        function readConfigFile(filePath) {
          try {
            var resolved = path.resolve(cwd, filePath);
            // Security: must stay within cwd
            if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) return null;
            var stat = fs.statSync(resolved);
            if (stat.isDirectory()) {
              // Return listing for directories
              var entries = fs.readdirSync(resolved);
              return "Directory listing:\n" + entries.join("\n");
            }
            return fs.readFileSync(resolved, "utf8");
          } catch (e) {
            return null;
          }
        }

        try {
          var payload = JSON.parse(coachBody);

          var result = await runCoachAgent(payload, {
            signal: abort.signal,
            model: getConfiguredModel(),
            readConfigFile: readConfigFile,
            onStep: function (step) { sseEvent({ step: step }); },
          });

          sseEvent({ done: true, result: result });
          if (!res.writableEnded) res.end();
        } catch (e) {
          if (e.name === "AbortError") { if (!res.writableEnded) res.end(); return; }
          sseEvent({ error: e.message || "AI analysis failed" });
          if (!res.writableEnded) res.end();
        }
      });
      return;
    }

    // ── Q&A ask endpoint (SSE streaming) ─────────────────────────────
    if (pathname === "/api/qa/ask") {
      if (req.method !== "POST") {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return;
      }
      var qaBody = "";
      req.on("data", function (chunk) { qaBody += chunk; });
      req.on("end", async function () {
        var abort = new AbortController();
        res.on("close", function () { abort.abort(); });

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.writeHead(200);

        function sse(data) {
          if (!res.writableEnded) res.write("data: " + JSON.stringify(data) + "\n\n");
        }

        try {
          var payload = JSON.parse(qaBody);
          if (!payload.question || typeof payload.question !== "string") {
            sse({ error: "question is required" }); if (!res.writableEnded) res.end(); return;
          }

          var model = getConfiguredModel();
          await runQAQuery(payload, {
            model: model,
            signal: abort.signal,
            onToken: function (token) { sse({ token: token }); },
          });

          sse({ done: true });
          if (!res.writableEnded) res.end();
        } catch (e) {
          if (e.name === "AbortError") { if (!res.writableEnded) res.end(); return; }
          sse({ error: e.message || "Q&A query failed" });
          if (!res.writableEnded) res.end();
        }
      });
      return;
    }

    // ── Models list endpoint ─────────────────────────────────────────
    if (pathname === "/api/models") {
      res.setHeader("Content-Type", "application/json");
      if (req.method !== "GET") { res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return; }
      var current = getConfiguredModel();
      res.writeHead(200);
      res.end(JSON.stringify({ current: current }));
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
              // Handle both inline summary and YAML block scalar (summary: |-)
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

              // Filter out AI coach subprocess sessions:
              // These are spawned by the coach agent itself and have a prompt as their summary.
              if (summary && (
                summary.startsWith("Analyze this") ||
                (summary.includes("Session stats") && summary.includes("read_config"))
              )) {
                return; // skip
              }

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

    if (pathname === "/api/sessions/insights") {
      res.setHeader("Content-Type", "application/json");
      if (req.method !== "GET") { res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return; }

      (async function () {
        var insightsHomeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
        var sessions = [];

        // Collect Copilot CLI sessions
        var copilotRoot = path.join(insightsHomeDir, ".copilot", "session-state");
        try {
          fs.readdirSync(copilotRoot).forEach(function (dirName) {
            var eventsFile = path.join(copilotRoot, dirName, "events.jsonl");
            try {
              var stat = fs.statSync(eventsFile);
              var summary = null;
              try {
                var yamlText = fs.readFileSync(path.join(copilotRoot, dirName, "workspace.yaml"), "utf8");
                var inlineM = yamlText.match(/^summary:\s+(?!\|-\s*$)(.+)$/m);
                var blockM = yamlText.match(/^summary:\s*\|-\s*\n[ \t]+(.+)$/m);
                if (inlineM && inlineM[1].trim()) summary = inlineM[1].trim();
                else if (blockM && blockM[1].trim()) summary = blockM[1].trim();
              } catch (_) {}
              if (summary && (summary.startsWith("Analyze this") || (summary.includes("Session stats") && summary.includes("read_config")))) return;
              sessions.push({ path: eventsFile, format: "copilot-cli", summary: summary, mtime: stat.mtime.toISOString() });
            } catch (_) {}
          });
        } catch (_) {}

        // Collect Claude Code sessions
        var claudeRoot = path.join(insightsHomeDir, ".claude", "projects");
        try {
          fs.readdirSync(claudeRoot).forEach(function (projectDir) {
            var projectPath = path.join(claudeRoot, projectDir);
            try {
              if (!fs.statSync(projectPath).isDirectory()) return;
              fs.readdirSync(projectPath).forEach(function (fname) {
                if (!fname.endsWith(".jsonl")) return;
                var fp = path.join(projectPath, fname);
                try {
                  var stat = fs.statSync(fp);
                  sessions.push({ path: fp, format: "claude-code", summary: null, mtime: stat.mtime.toISOString() });
                } catch (_) {}
              });
            } catch (_) {}
          });
        } catch (_) {}

        // Try to supplement with session-store.db if available
        try {
          var { DatabaseSync } = await import("node:sqlite");
          var dbPath = path.join(insightsHomeDir, ".copilot", "session-store.db");
          if (fs.existsSync(dbPath)) {
            var db = new DatabaseSync(dbPath, { readOnly: true });
            try {
              var tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
              var sessionTable = (tableRows || []).map(function (r) { return r.name; }).find(function (t) { return /session/i.test(t); });
              if (sessionTable) {
                var dbRows = db.prepare("SELECT * FROM " + sessionTable + " LIMIT 200").all();
                // Merge DB session summaries into session list by matching session_id
                (dbRows || []).forEach(function (row) {
                  var sid = row.session_id || row.sessionId || row.id;
                  if (!sid) return;
                  var match = sessions.find(function (s) { return s.path.includes(String(sid)); });
                  if (match && !match.summary && (row.summary || row.description)) {
                    match.summary = String(row.summary || row.description);
                  }
                });
              }
            } catch (_) {}
            db.close();
          }
        } catch (_) {}

        sessions.sort(function (a, b) { return new Date(b.mtime) - new Date(a.mtime); });
        var toAnalyze = sessions.slice(0, 50);
        toAnalyze.forEach(function (s) { s.stats = analyzeSessionJSONL(s.path, s.format); });

        var insights = classifyInsights(toAnalyze, insightsHomeDir);
        res.writeHead(200);
        res.end(JSON.stringify({
          available: sessions.length > 0,
          sessionCount: sessions.length,
          analyzedCount: toAnalyze.length,
          insights: insights,
        }));
      })().catch(function (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message || "Internal server error" }));
      });
      return;
    }

    if (pathname === "/api/insights/apply") {
      res.setHeader("Content-Type", "application/json");
      if (req.method !== "POST") { res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return; }
      var insightsApplyBody = "";
      req.on("data", function (chunk) { insightsApplyBody += chunk; });
      req.on("end", function () {
        try {
          var payload = JSON.parse(insightsApplyBody);
          var targetPath = payload.targetPath;
          var content = payload.content;
          if (typeof targetPath !== "string" || !targetPath) {
            res.writeHead(400); res.end(JSON.stringify({ error: "targetPath is required" })); return;
          }
          if (typeof content !== "string") {
            res.writeHead(400); res.end(JSON.stringify({ error: "content is required" })); return;
          }
          var applyHomeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
          // Expand ~ to home dir
          var resolvedTarget = targetPath.startsWith("~/")
            ? path.join(applyHomeDir, targetPath.slice(2))
            : path.resolve(targetPath);
          // Security: only allow writes under ~/.copilot/ or ~/.github/
          var allowedRoots = [
            path.join(applyHomeDir, ".copilot") + path.sep,
            path.join(applyHomeDir, ".github") + path.sep,
          ];
          var isAllowed = allowedRoots.some(function (root) { return resolvedTarget.startsWith(root); });
          if (!isAllowed) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Target path must be under ~/.copilot/ or ~/.github/" }));
            return;
          }
          fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true });
          var existed = fs.existsSync(resolvedTarget);
          if (!existed) {
            fs.writeFileSync(resolvedTarget, content, "utf8");
          } else {
            fs.appendFileSync(resolvedTarget, "\n\n" + content, "utf8");
          }
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, path: resolvedTarget, created: !existed }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message || "Internal server error" }));
        }
      });
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
