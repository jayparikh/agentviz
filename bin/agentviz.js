#!/usr/bin/env node
/**
 * CLI entry point: npx agentviz [session.jsonl]
 * Builds the SPA (if dist/ not found), starts the local server, and opens the browser.
 */

import { createServer } from "../server.js";
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import net from "net";

var __dirname = path.dirname(fileURLToPath(import.meta.url));
var rootDir = path.resolve(__dirname, "..");
var distDir = path.join(rootDir, "dist");

// -- Resolve session file from argv --
// Accepts a .jsonl file path or a directory (picks the most recently modified .jsonl inside it).
function findLatestJsonl(dir) {
  var best = null;
  var bestMtime = 0;
  try {
    var entries = fs.readdirSync(dir);
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].endsWith(".jsonl")) continue;
      var full = path.join(dir, entries[i]);
      try {
        var mtime = fs.statSync(full).mtimeMs;
        if (mtime > bestMtime) { bestMtime = mtime; best = full; }
      } catch (e) {}
    }
  } catch (e) {}
  return best;
}

var sessionFile = null;
var argv = process.argv.slice(2);
for (var i = 0; i < argv.length; i++) {
  var arg = argv[i];
  if (!arg.startsWith("-")) {
    var resolved = path.resolve(arg);
    if (!fs.existsSync(resolved)) {
      process.stderr.write("Error: path not found: " + resolved + "\n");
      process.exit(1);
    }
    var stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      sessionFile = findLatestJsonl(resolved);
      if (!sessionFile) {
        process.stderr.write("Error: no .jsonl files found in " + resolved + "\n");
        process.exit(1);
      }
    } else {
      sessionFile = resolved;
    }
    break;
  }
}

// -- Find a free port starting from preferred --
function findFreePort(preferred, cb) {
  var server = net.createServer();
  server.listen(preferred, "127.0.0.1", function () {
    var port = server.address().port;
    server.close(function () { cb(null, port); });
  });
  server.on("error", function () {
    findFreePort(preferred + 1, cb);
  });
}

// -- Open browser (cross-platform) --
function openBrowser(url) {
  var platform = process.platform;
  var cmd = platform === "darwin" ? "open"
    : platform === "win32" ? "start"
    : "xdg-open";
  exec(cmd + " " + url, function () {});
}

// -- Check dist/ exists --
if (!fs.existsSync(path.join(distDir, "index.html"))) {
  process.stderr.write(
    "dist/ not found. Run `npm run build` inside the agentviz package first.\n"
  );
  process.exit(1);
}

findFreePort(4242, function (err, port) {
  var server = createServer({ sessionFile: sessionFile, distDir: distDir });
  server.listen(port, "127.0.0.1", function () {
    var url = "http://localhost:" + port;
    process.stdout.write("\n  AGENTVIZ. running at " + url + "\n");
    if (sessionFile) {
      process.stdout.write("  Session: " + path.basename(sessionFile) + "\n");
    }
    process.stdout.write("  Press Ctrl+C to stop.\n\n");
    openBrowser(url);
  });

  process.on("SIGINT", function () {
    server.close(function () { process.exit(0); });
  });
  process.on("SIGTERM", function () {
    server.close(function () { process.exit(0); });
  });
});
