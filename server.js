/**
 * AGENTVIZ local server.
 * Serves dist/ as a static SPA and provides API routes via modular handlers.
 */

import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import url from "url";

import { handle as handleSessions } from "./routes/sessions.js";
import { handle as handleAI } from "./routes/ai.js";
import { handle as handleConfig } from "./routes/config.js";
import { handle as handleImport } from "./routes/import.js";

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
    try {
      var initContent = fs.readFileSync(sessionFile, "utf8");
      lastLineIdx = getCompleteJsonlLines(initContent).length;
    } catch (e) {}

    function attachWatcher() {
      try {
        watcher = fs.watch(sessionFile, function (eventType) {
          if (eventType === "change" || eventType === "rename") {
            broadcastNewLines();
            if (eventType === "rename") {
              try { watcher.close(); } catch (e) {}
              setTimeout(function () {
                if (watcherClosed) return;
                try { fs.accessSync(sessionFile); } catch (e) { return; }
                attachWatcher();
              }, 50);
            }
          }
        });
        watcher.on("error", function (err) {
          process.stderr.write("AGENTVIZ: file watcher error: " + (err && err.message || err) + "\n");
          var errPayload = "data: " + JSON.stringify({ error: "watcher_error" }) + "\n\n";
          for (var client of clients) {
            try { client.write(errPayload); } catch (e) { clients.delete(client); }
          }
        });
      } catch (e) {}
    }

    attachWatcher();
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

    // Restrict CORS to localhost origins only
    var origin = req.headers.origin || "";
    var isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (isLocalOrigin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    res.setHeader("Vary", "Origin");

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      if (isLocalOrigin) {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Vary": "Origin",
        });
      } else {
        res.writeHead(403);
      }
      res.end();
      return;
    }

    // Enforce body size limit (2 MB) on POST requests
    if (req.method === "POST") {
      var MAX_BODY = 2 * 1024 * 1024;
      var contentLength = parseInt(req.headers["content-length"], 10);
      if (contentLength > MAX_BODY) {
        res.writeHead(413);
        res.end("Payload too large");
        req.destroy();
        return;
      }
      var received = 0;
      req.on("data", function (chunk) {
        received += chunk.length;
        if (received > MAX_BODY) {
          res.writeHead(413);
          res.end("Payload too large");
          req.destroy();
        }
      });
    }

    // Shared context for route modules
    var ctx = { sessionFile: sessionFile, clients: clients, parsed: parsed, getConfiguredModel: getConfiguredModel };

    // Dispatch to route modules
    if (handleConfig(pathname, req, res, ctx)) return;
    if (handleImport(pathname, req, res, ctx)) return;
    if (handleAI(pathname, req, res, ctx)) return;
    if (handleSessions(pathname, req, res, ctx)) return;

    // Static file serving
    var filePath = pathname === "/" || pathname === "/index.html"
      ? path.join(distDir, "index.html")
      : path.join(distDir, pathname);

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
      serveStatic(res, path.join(distDir, "index.html"));
    }
  }

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
