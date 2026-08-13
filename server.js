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

var STREAM_READ_SIZE = 64 * 1024;

// ── Request guards ───────────────────────────────────────────────
// The server listens on 127.0.0.1, but "local" is not the same as "trusted":
// every website the user visits can make their browser send requests here.
// CORS response headers do not stop a request from being *sent* (so a page can
// POST and write files), and they do not stop a rebound DNS name from reading
// responses (so a page can exfiltrate session transcripts). Both classes are
// therefore rejected outright, before any route or static file is served.

var LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"];
var STATE_CHANGING_METHODS = ["POST", "PUT", "PATCH", "DELETE"];
var LOCAL_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** Extract the hostname from a Host header, handling ports and IPv6 literals. */
export function parseHostname(hostHeader) {
  var value = String(hostHeader || "").trim().toLowerCase();
  if (!value) return "";

  if (value.charAt(0) === "[") {
    var end = value.indexOf("]");
    return end === -1 ? "" : value.slice(1, end);
  }

  var colon = value.indexOf(":");
  return colon === -1 ? value : value.slice(0, colon);
}

/**
 * Blocks DNS rebinding. An attacker domain that resolves to 127.0.0.1 reaches
 * this server with its own name in the Host header, and the browser then treats
 * the response as same-origin and readable. Only loopback names are accepted.
 */
export function isAllowedHost(hostHeader) {
  return LOCAL_HOSTNAMES.indexOf(parseHostname(hostHeader)) !== -1;
}

export function isLocalOrigin(origin) {
  return LOCAL_ORIGIN_PATTERN.test(String(origin || ""));
}

function hasRequestBody(headers) {
  var length = parseInt(headers["content-length"], 10);
  if (!isNaN(length) && length > 0) return true;
  return Boolean(headers["transfer-encoding"]);
}

/**
 * Returns null when the request may proceed, or { status, message } when it
 * must be rejected.
 */
export function evaluateRequestGuard(req) {
  var headers = (req && req.headers) || {};

  if (!isAllowedHost(headers.host)) {
    return { status: 403, message: "Forbidden: invalid Host header" };
  }

  var method = String((req && req.method) || "GET").toUpperCase();
  if (STATE_CHANGING_METHODS.indexOf(method) === -1) return null;

  var origin = headers.origin || "";
  if (origin && !isLocalOrigin(origin)) {
    return { status: 403, message: "Forbidden: cross-origin request" };
  }

  // Set by the browser itself, so page script cannot forge it.
  var site = headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") {
    return { status: 403, message: "Forbidden: cross-site request" };
  }

  // A cross-site <form> can submit a body without an Origin header in older
  // browsers, but it can only send urlencoded/multipart/text-plain -- never
  // application/json. Requiring JSON closes that bypass. Bodiless posts such as
  // /api/qa/reset are exempt because a form submission always carries a body.
  if (hasRequestBody(headers) && !/^application\/json\b/i.test(headers["content-type"] || "")) {
    return { status: 415, message: "Unsupported Media Type: expected application/json" };
  }

  return null;
}

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

    // Reject CSRF and DNS-rebinding requests before any route or file is served.
    var guard = evaluateRequestGuard(req);
    if (guard) {
      res.writeHead(guard.status, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(guard.message);
      req.resume(); // drain the body so the socket is not left half-open
      return;
    }

    // Restrict CORS to localhost origins only
    var origin = req.headers.origin || "";
    var originIsLocal = isLocalOrigin(origin);
    if (originIsLocal) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    res.setHeader("Vary", "Origin");

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(originIsLocal ? 204 : 403);
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
