/**
 * AGENTVIZ local server.
 * Serves dist/ as a static SPA and provides API routes via modular handlers.
 */

import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import url from "url";
import { StringDecoder } from "string_decoder";

import { handle as handleSessions } from "./routes/sessions.js";
import { handle as handleAI } from "./routes/ai.js";
import { handle as handleConfig } from "./routes/config.js";
import { shutdownQA } from "./src/lib/qaAgent.js";

// ── Model configuration ──────────────────────────────────────────
function getConfigPath() {
  var envPath = process.env.AGENTVIZ_CONFIG;
  if (envPath) return envPath;
  return path.join(os.homedir(), ".agentviz", "config.json");
}

var _modelCache = null;
var _modelCacheTime = 0;
var MODEL_CACHE_TTL = 30000; // 30 seconds

export function getConfiguredModel() {
  var envModel = process.env.AGENTVIZ_MODEL;
  if (envModel) return envModel;

  var now = Date.now();
  if (_modelCache !== null && now - _modelCacheTime < MODEL_CACHE_TTL) {
    return _modelCache.value;
  }

  try {
    var raw = fs.readFileSync(getConfigPath(), "utf8");
    var cfg = JSON.parse(raw);
    var model = cfg.model || null;
    _modelCache = { value: model };
    _modelCacheTime = now;
    return model;
  } catch (_) {
    _modelCache = { value: null };
    _modelCacheTime = now;
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

var STREAM_READ_SIZE = 64 * 1024;

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

function readInitialStreamState(filePath, initialDecoder) {
  var fd = fs.openSync(filePath, "r");
  try {
    var fileSize = fs.fstatSync(fd).size;
    if (fileSize === 0) return { byteOffset: 0, partialLine: "" };

    var chunks = [];
    var trailingLength = 0;
    var position = fileSize;

    while (position > 0) {
      var chunkSize = Math.min(STREAM_READ_SIZE, position);
      position -= chunkSize;

      var chunk = Buffer.alloc(chunkSize);
      var bytesRead = fs.readSync(fd, chunk, 0, chunkSize, position);
      var scanChunk = bytesRead === chunkSize ? chunk : chunk.subarray(0, bytesRead);
      var newlineIdx = scanChunk.lastIndexOf(10);

      if (newlineIdx !== -1) {
        var afterNewline = scanChunk.subarray(newlineIdx + 1);
        if (afterNewline.length > 0) {
          chunks.push(afterNewline);
          trailingLength += afterNewline.length;
        }
        break;
      }

      chunks.push(scanChunk);
      trailingLength += scanChunk.length;
    }

    if (trailingLength === 0) {
      return { byteOffset: fileSize, partialLine: "" };
    }

    var suffix = Buffer.alloc(trailingLength);
    var offset = 0;
    for (var i = chunks.length - 1; i >= 0; i -= 1) {
      chunks[i].copy(suffix, offset);
      offset += chunks[i].length;
    }

    return { byteOffset: fileSize, partialLine: initialDecoder.write(suffix) };
  } finally {
    fs.closeSync(fd);
  }
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
  var lastByteOffset = 0;
  var partialLine = "";
  var decoder = new StringDecoder("utf8");
  var watcher = null;
  var watcherClosed = false;
  var pollInterval = null;

  function broadcastNewLines() {
    if (!sessionFile || clients.size === 0) return;
    try {
      var stat = fs.statSync(sessionFile);

      // Handle file truncation/recreation (e.g. session restart)
      if (stat.size < lastByteOffset) {
        lastByteOffset = 0;
        partialLine = "";
        decoder = new StringDecoder("utf8");
      }

      if (stat.size === lastByteOffset) return;

      var targetSize = stat.size;
      var fd = fs.openSync(sessionFile, "r");
      try {
        while (lastByteOffset < targetSize) {
          var bufSize = Math.min(STREAM_READ_SIZE, targetSize - lastByteOffset);
          var buf = Buffer.alloc(bufSize);
          var bytesRead = fs.readSync(fd, buf, 0, bufSize, lastByteOffset);
          if (bytesRead === 0) return;
          lastByteOffset += bytesRead;

          var chunk = partialLine + decoder.write(buf.subarray(0, bytesRead));
          chunk = chunk.replace(/\r\n/g, "\n");
          var lines = chunk.split("\n");
          partialLine = lines.pop() || "";

          var newLines = lines.filter(function (line) { return line.trim(); });
          if (newLines.length === 0) continue;

          var payload = "data: " + JSON.stringify({ lines: newLines.join("\n") }) + "\n\n";
          for (var client of clients) {
            try { client.write(payload); } catch (e) { clients.delete(client); }
          }
        }
      } finally {
        fs.closeSync(fd);
      }
    } catch (e) {}
  }

  if (sessionFile) {
    try {
      var initialState = readInitialStreamState(sessionFile, decoder);
      lastByteOffset = initialState.byteOffset;
      partialLine = initialState.partialLine;
    } catch (e) {}

    function attachWatcher() {
      try {
        watcher = fs.watch(sessionFile, function (eventType) {
          if (eventType === "rename") {
            try { watcher.close(); } catch (e) {}
            lastByteOffset = 0;
            partialLine = "";
            decoder = new StringDecoder("utf8");
            broadcastNewLines();
            setTimeout(function () {
              if (watcherClosed) return;
              try { fs.accessSync(sessionFile); } catch (e) { return; }
              attachWatcher();
            }, 50);
            return;
          }

          if (eventType === "change") {
            broadcastNewLines();
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
      res.writeHead(isLocalOrigin ? 204 : 403);
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
    if (handleAI(pathname, req, res, ctx)) return;
    if (handleSessions(pathname, req, res, ctx)) return;

    // Unmatched API routes return 404 JSON (not SPA HTML)
    if (pathname.startsWith("/api/")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    // Static file serving -- sandbox resolved path to distDir
    var filePath = pathname === "/" || pathname === "/index.html"
      ? path.join(distDir, "index.html")
      : path.resolve(distDir, path.join(".", pathname));

    if (!filePath.startsWith(distDir + path.sep) && filePath !== distDir) {
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
    for (var client of clients) {
      try { client.end(); } catch (e) {}
    }
    clients.clear();
    shutdownQA().catch(function () {});
  });

  server.on("error", function (err) {
    process.stderr.write("[agentviz] server error: " + err.message + "\n" + (err.stack || "") + "\n");
  });

  return server;
}
