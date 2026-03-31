/**
 * Import route: accept a remote JSONL URL, download it locally, and return
 * an import ID that the SPA can use to auto-load the session.
 *
 * Handles:
 *   POST /api/import   -- { url, name? } → download JSONL, return { id, path }
 *   GET  /api/imports   -- list imported sessions (for discovery)
 */

import fs from "fs";
import path from "path";
import os from "os";
import https from "https";
import http from "http";
import crypto from "crypto";

var IMPORTS_DIR = path.join(os.homedir(), ".agentviz", "imports");
var TTL_MS = 60 * 60 * 1000; // 1 hour

function ensureImportsDir() {
  fs.mkdirSync(IMPORTS_DIR, { recursive: true });
}

// Remove files older than TTL
function cleanupExpired() {
  try {
    var files = fs.readdirSync(IMPORTS_DIR);
    var now = Date.now();
    files.forEach(function (fname) {
      var filePath = path.join(IMPORTS_DIR, fname);
      try {
        var stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > TTL_MS) {
          fs.unlinkSync(filePath);
        }
      } catch (_) {}
    });
  } catch (_) {}
}

function fetchUrl(targetUrl) {
  return new Promise(function (resolve, reject) {
    var mod = targetUrl.startsWith("https") ? https : http;
    var req = mod.get(targetUrl, { timeout: 30000 }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow one redirect
        fetchUrl(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error("HTTP " + res.statusCode));
        return;
      }
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () { resolve(Buffer.concat(chunks)); });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", function () { req.destroy(); reject(new Error("timeout")); });
  });
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    req.on("data", function (c) { chunks.push(c); });
    req.on("end", function () { resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}

export function handle(pathname, req, res, ctx) {

  if (pathname === "/api/import" && req.method === "POST") {
    readBody(req).then(function (bodyStr) {
      var body;
      try { body = JSON.parse(bodyStr); } catch (_) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }

      var targetUrl = body.url;
      if (!targetUrl || typeof targetUrl !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "url is required" }));
        return;
      }

      // Only allow http/https URLs
      if (!/^https?:\/\//.test(targetUrl)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Only http/https URLs are supported" }));
        return;
      }

      ensureImportsDir();
      cleanupExpired();

      var importId = crypto.randomUUID();
      var safeName = (body.name || importId).replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 100);
      if (!safeName.endsWith(".jsonl")) safeName += ".jsonl";
      var destPath = path.join(IMPORTS_DIR, importId + "__" + safeName);

      fetchUrl(targetUrl).then(function (data) {
        fs.writeFileSync(destPath, data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: importId, path: destPath, name: safeName }));
      }).catch(function (err) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to download: " + err.message }));
      });
    });
    return true;
  }

  if (pathname === "/api/imports" && req.method === "GET") {
    ensureImportsDir();
    cleanupExpired();
    var results = [];
    try {
      fs.readdirSync(IMPORTS_DIR).forEach(function (fname) {
        if (!fname.endsWith(".jsonl")) return;
        var filePath = path.join(IMPORTS_DIR, fname);
        try {
          var stat = fs.statSync(filePath);
          var parts = fname.split("__");
          var id = parts[0];
          var displayName = parts.slice(1).join("__") || fname;
          results.push({
            id: "import:" + id,
            path: filePath,
            filename: displayName,
            project: "Imported",
            format: "imported",
            size: stat.size,
            mtime: stat.mtime.toISOString(),
          });
        } catch (_) {}
      });
    } catch (_) {}
    results.sort(function (a, b) { return new Date(b.mtime) - new Date(a.mtime); });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(results));
    return true;
  }

  return false;
}
