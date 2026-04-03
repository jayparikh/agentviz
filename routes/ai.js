/**
 * AI-powered routes: Coach analysis, Q&A, and model info.
 *
 * Handles:
 *   POST /api/coach/analyze -- SSE streaming AI coach analysis
 *   POST /api/qa/ask        -- SSE streaming Q&A
 *   GET  /api/models        -- current model info
 */

import fs from "fs";
import path from "path";
import { runCoachAgent } from "../src/lib/aiCoachAgent.js";
import { runQAQuery } from "../src/lib/qaAgent.js";

export function handle(pathname, req, res, ctx) {

  if (pathname === "/api/coach/analyze") {
    if (req.method !== "POST") {
      res.setHeader("Content-Type", "application/json");
      res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return true;
    }
    var coachBody = "";
    req.on("data", function (chunk) { coachBody += chunk; });
    req.on("end", async function () {
      var abort = new AbortController();
      res.on("close", function () { abort.abort(); });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.writeHead(200);

      function sseEvent(data) {
        if (!res.writableEnded) res.write("data: " + JSON.stringify(data) + "\n\n");
      }

      var cwd = process.cwd();
      function readConfigFile(filePath) {
        try {
          var resolved = path.resolve(cwd, filePath);
          if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) return null;
          // Resolve symlinks to prevent escaping via symlink targets
          var real = fs.realpathSync(resolved);
          if (!real.startsWith(cwd + path.sep) && real !== cwd) return null;
          var stat = fs.statSync(real);
          if (stat.isDirectory()) {
            var entries = fs.readdirSync(real);
            return "Directory listing:\n" + entries.join("\n");
          }
          return fs.readFileSync(real, "utf8");
        } catch (e) {
          return null;
        }
      }

      try {
        var payload = JSON.parse(coachBody);

        var result = await runCoachAgent(payload, {
          signal: abort.signal,
          model: ctx.getConfiguredModel(),
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
    return true;
  }

  if (pathname === "/api/qa/ask") {
    if (req.method !== "POST") {
      res.setHeader("Content-Type", "application/json");
      res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return true;
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

        sse({ status: "Analyzing session..." });

        var model = ctx.getConfiguredModel();
        await runQAQuery(payload, {
          model: model,
          signal: abort.signal,
          onStatus: function (status) { sse({ status: status }); },
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
    return true;
  }

  if (pathname === "/api/models") {
    res.setHeader("Content-Type", "application/json");
    if (req.method !== "GET") { res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return true; }
    var current = ctx.getConfiguredModel();
    res.writeHead(200);
    res.end(JSON.stringify({ current: current }));
    return true;
  }

  return false;
}
