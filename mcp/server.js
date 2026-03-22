#!/usr/bin/env node
/**
 * AgentViz MCP server.
 *
 * Exposes one tool: launch_agentviz
 *   - Finds the current (or most recent) Claude Code session file
 *   - Starts the AgentViz HTTP server on a free port
 *   - Opens the browser with live streaming enabled
 *   - Returns the URL
 *
 * Register in ~/.claude/settings.json:
 *   "mcpServers": {
 *     "agentviz": {
 *       "command": "node",
 *       "args": ["/Users/jay/workspace/agentviz/mcp/server.js"]
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../server.js";
import fs from "fs";
import path from "path";
import net from "net";
import os from "os";
import { exec } from "child_process";
import { fileURLToPath } from "url";

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var distDir = path.resolve(__dirname, "../dist");

// Directories to search for session files, in priority order.
// Each entry is either a flat directory (Copilot) or a directory of
// subdirectories each containing .jsonl files (Claude Code).
var SESSION_DIRS = [
  { path: path.join(os.homedir(), ".claude", "projects"), nested: true },
  { path: path.join(os.homedir(), ".copilot", "session-state"), nested: false },
];

// Find the most recently modified .jsonl file across all known session dirs.
function findLatestSessionFile() {
  var best = null;
  var bestMtime = 0;

  for (var i = 0; i < SESSION_DIRS.length; i++) {
    var dir = SESSION_DIRS[i];
    if (!fs.existsSync(dir.path)) continue;

    try {
      var entries = fs.readdirSync(dir.path);
    } catch (e) { continue; }

    if (dir.nested) {
      // Claude Code: ~/.claude/projects/<project>/<uuid>.jsonl
      for (var j = 0; j < entries.length; j++) {
        var subPath = path.join(dir.path, entries[j]);
        try { if (!fs.statSync(subPath).isDirectory()) continue; } catch (e) { continue; }
        try {
          for (var file of fs.readdirSync(subPath)) {
            if (!file.endsWith(".jsonl")) continue;
            var filePath = path.join(subPath, file);
            try {
              var mtime = fs.statSync(filePath).mtimeMs;
              if (mtime > bestMtime) { bestMtime = mtime; best = filePath; }
            } catch (e) {}
          }
        } catch (e) {}
      }
    } else {
      // Copilot CLI: ~/.copilot/session-state/<file>.jsonl
      for (var k = 0; k < entries.length; k++) {
        if (!entries[k].endsWith(".jsonl")) continue;
        var fp = path.join(dir.path, entries[k]);
        try {
          var mt = fs.statSync(fp).mtimeMs;
          if (mt > bestMtime) { bestMtime = mt; best = fp; }
        } catch (e) {}
      }
    }
  }

  return best;
}

function findFreePort(preferred, cb) {
  var server = net.createServer();
  server.listen(preferred, "127.0.0.1", function () {
    var port = server.address().port;
    server.close(function () { cb(null, port); });
  });
  server.on("error", function () { findFreePort(preferred + 1, cb); });
}

function openBrowser(url) {
  var platform = process.platform;
  var cmd = platform === "darwin" ? "open"
    : platform === "win32" ? "start"
    : "xdg-open";
  exec(cmd + " " + url, function () {});
}

// Track running servers so we don't stack them up
var runningServers = new Map(); // port -> { server, sessionFile }

var mcpServer = new Server(
  { name: "agentviz", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async function () {
  return {
    tools: [
      {
        name: "launch_agentviz",
        description: "Open the current Claude Code session in AGENTVIZ for live visualization. Starts a local server and opens a browser window showing the session replay in real time.",
        inputSchema: {
          type: "object",
          properties: {
            session_file: {
              type: "string",
              description: "Absolute path to a specific .jsonl session file. If omitted, auto-detects the most recently active session.",
            },
          },
          required: [],
        },
      },
      {
        name: "close_agentviz",
        description: "Stop a running AGENTVIZ server.",
        inputSchema: {
          type: "object",
          properties: {
            port: {
              type: "number",
              description: "Port of the server to stop. If omitted, stops all running servers.",
            },
          },
          required: [],
        },
      },
    ],
  };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async function (request) {
  var name = request.params.name;

  if (name === "launch_agentviz") {
    if (!fs.existsSync(distDir)) {
      return {
        content: [{
          type: "text",
          text: "Error: dist/ not found. Run `npm run build` inside the agentviz repo first.",
        }],
        isError: true,
      };
    }

    var sessionFile = (request.params.arguments && request.params.arguments.session_file)
      || findLatestSessionFile();

    if (sessionFile && !fs.existsSync(sessionFile)) {
      return {
        content: [{ type: "text", text: "Error: session file not found: " + sessionFile }],
        isError: true,
      };
    }

    return new Promise(function (resolve) {
      findFreePort(4242, function (err, port) {
        var httpServer = createServer({
          sessionFile: sessionFile || null,
          distDir: distDir,
        });

        httpServer.listen(port, "127.0.0.1", function () {
          runningServers.set(port, { server: httpServer, sessionFile: sessionFile });
          var url = "http://localhost:" + port;
          openBrowser(url);

          var msg = "AGENTVIZ. is live at " + url;
          if (sessionFile) {
            msg += "\nStreaming: " + path.basename(sessionFile);
          } else {
            msg += "\nNo session file found -- drop a .jsonl file in the browser to load one.";
          }

          resolve({ content: [{ type: "text", text: msg }] });
        });

        httpServer.on("error", function (e) {
          resolve({
            content: [{ type: "text", text: "Failed to start server: " + e.message }],
            isError: true,
          });
        });
      });
    });
  }

  if (name === "close_agentviz") {
    var port = request.params.arguments && request.params.arguments.port;

    if (runningServers.size === 0) {
      return { content: [{ type: "text", text: "No running AGENTVIZ servers." }] };
    }

    var closed = [];
    var targets = port ? [port] : Array.from(runningServers.keys());

    await Promise.all(targets.map(function (p) {
      return new Promise(function (resolve) {
        var entry = runningServers.get(p);
        if (!entry) { resolve(); return; }
        entry.server.close(function () {
          runningServers.delete(p);
          closed.push(p);
          resolve();
        });
      });
    }));

    return {
      content: [{
        type: "text",
        text: "Stopped AGENTVIZ server" + (closed.length > 1 ? "s" : "") + " on port" + (closed.length > 1 ? "s" : "") + " " + closed.join(", "),
      }],
    };
  }

  return {
    content: [{ type: "text", text: "Unknown tool: " + name }],
    isError: true,
  };
});

var transport = new StdioServerTransport();
await mcpServer.connect(transport);
