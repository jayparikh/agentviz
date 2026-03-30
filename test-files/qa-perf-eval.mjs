/**
 * Phase 9 Q&A Performance Evaluation Harness
 * 
 * Loads sessions, runs questions through classifier + server, measures latency.
 * Usage: node test-files/qa-perf-eval.mjs [round_number]
 */

import fs from "fs";
import path from "path";
import { classify, buildModelContext, fingerprintQuestion } from "../src/lib/qaClassifier.js";
import { formatDuration } from "../src/lib/formatTime.js";

var SESSION_DIR = path.join(process.env.HOME || process.env.USERPROFILE || "", ".copilot", "session-state");
var GOLDEN_PATH = "C:/Users/arjagann/.copilot/session-state/8a86a63f-3963-430e-91a4-fbc9864c41c9/files/qa-golden-dataset.json";
var DEEP_PATH = "C:/Users/arjagann/.copilot/session-state/8a86a63f-3963-430e-91a4-fbc9864c41c9/files/qa-deep-questions.jsonl";
var SERVER_URL = "http://localhost:4242";
var TIMEOUT_MS = 60000;
var QUESTIONS_PER_ROUND = 200;
var SESSIONS_PER_ROUND = 20;

var round = parseInt(process.argv[2] || "1", 10);

console.log("=".repeat(60));
console.log("  PHASE 9 - ITERATION " + round + " / 10");
console.log("=".repeat(60));
console.log("");

// Load datasets
var golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8"));
var deepLines = fs.readFileSync(DEEP_PATH, "utf8").trim().split("\n");
var deepQuestions = deepLines.map(function (l) { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);

// Discover sessions
function discoverSessions(limit) {
  var results = [];
  try {
    var dirs = fs.readdirSync(SESSION_DIR);
    for (var i = 0; i < dirs.length && results.length < limit * 3; i++) {
      var sessionDir = path.join(SESSION_DIR, dirs[i]);
      try {
        if (!fs.statSync(sessionDir).isDirectory()) continue;
        var eventsFile = path.join(sessionDir, "events.jsonl");
        if (fs.existsSync(eventsFile)) {
          var stat = fs.statSync(eventsFile);
          results.push({ id: dirs[i], path: eventsFile, size: stat.size });
        }
      } catch (_) {}
    }
  } catch (_) {}
  // Sort by size for variety, pick every Nth
  results.sort(function (a, b) { return a.size - b.size; });
  var step = Math.max(1, Math.floor(results.length / limit));
  var selected = [];
  for (var j = 0; j < results.length && selected.length < limit; j += step) {
    selected.push(results[j]);
  }
  return selected;
}

// Parse a session file into events/turns/metadata
async function parseSessionFile(filePath) {
  try {
    var content = fs.readFileSync(filePath, "utf8");
    if (!content.trim()) return null;
    // Quick JSONL parse: extract events, build turns and metadata inline
    var lines = content.split("\n").filter(function (l) { return l.trim(); });
    var events = [];
    var turnMap = {};
    for (var i = 0; i < lines.length; i++) {
      try {
        var obj = JSON.parse(lines[i]);
        var ev = {
          t: obj.timestamp || obj.t || i,
          agent: obj.role || obj.agent || "assistant",
          track: obj.type === "tool_call" || obj.toolName ? "tool_call" : (obj.type || "output"),
          text: obj.text || obj.content || "",
          toolName: obj.toolName || obj.tool_name || null,
          toolInput: obj.toolInput || obj.input || null,
          isError: Boolean(obj.isError || obj.error),
          turnIndex: obj.turnIndex != null ? obj.turnIndex : 0,
          duration: obj.duration || 0,
          intensity: obj.intensity || 0.5,
        };
        events.push(ev);
        if (!turnMap[ev.turnIndex]) {
          turnMap[ev.turnIndex] = { index: ev.turnIndex, startTime: ev.t, endTime: ev.t, eventIndices: [], userMessage: null, toolCount: 0, hasError: false };
        }
        var turn = turnMap[ev.turnIndex];
        turn.eventIndices.push(i);
        if (ev.t > turn.endTime) turn.endTime = ev.t;
        if (ev.agent === "user" && ev.text && !turn.userMessage) turn.userMessage = ev.text;
        if (ev.track === "tool_call") turn.toolCount++;
        if (ev.isError) turn.hasError = true;
      } catch (_) {}
    }
    if (events.length === 0) return null;
    var turns = Object.values(turnMap).sort(function (a, b) { return a.index - b.index; });
    var toolCounts = {};
    events.forEach(function (e) { if (e.track === "tool_call" && e.toolName) toolCounts[e.toolName] = (toolCounts[e.toolName] || 0) + 1; });
    var totalDuration = events.length > 1 ? events[events.length - 1].t - events[0].t : 0;
    var metadata = {
      totalEvents: events.length,
      totalTurns: turns.length,
      totalToolCalls: events.filter(function (e) { return e.track === "tool_call"; }).length,
      errorCount: events.filter(function (e) { return e.isError; }).length,
      duration: totalDuration,
      models: {},
      primaryModel: "unknown",
      format: "copilot-cli",
    };
    return { events: events, turns: turns, metadata: metadata, autonomyMetrics: null };
  } catch (e) {
    return null;
  }
}

// Ask a question via the server SSE endpoint
function askServer(question, context) {
  return new Promise(function (resolve) {
    var startedAt = Date.now();
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
      resolve({ answer: "", elapsedMs: Date.now() - startedAt, timedOut: true, tier: "model" });
    }, TIMEOUT_MS);

    fetch(SERVER_URL + "/api/qa/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: question, context: context }),
      signal: controller.signal,
    }).then(function (res) {
      if (!res.ok) {
        clearTimeout(timer);
        resolve({ answer: "", elapsedMs: Date.now() - startedAt, error: "HTTP " + res.status, tier: "model" });
        return;
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";
      var answer = "";

      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            clearTimeout(timer);
            resolve({ answer: answer, elapsedMs: Date.now() - startedAt, tier: "model" });
            return;
          }
          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (var i = 0; i < lines.length; i++) {
            if (lines[i].startsWith("data: ")) {
              try {
                var data = JSON.parse(lines[i].slice(6));
                if (data.token) answer += data.token;
                else if (data.done) {
                  clearTimeout(timer);
                  resolve({ answer: answer, elapsedMs: Date.now() - startedAt, tier: "model" });
                  return;
                }
                else if (data.error) {
                  clearTimeout(timer);
                  resolve({ answer: "", elapsedMs: Date.now() - startedAt, error: data.error, tier: "model" });
                  return;
                }
              } catch (_) {}
            }
          }
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        resolve({ answer: "", elapsedMs: Date.now() - startedAt, timedOut: true, tier: "model" });
      } else {
        resolve({ answer: "", elapsedMs: Date.now() - startedAt, error: err.message, tier: "model" });
      }
    });
  });
}

// Select questions for this round
function selectQuestions(sessions) {
  var questions = [];
  
  // Take from golden dataset (general questions work with any session)
  var generalQ = golden.questions.filter(function (q) { return q.scope === "general"; });
  var sessionQ = golden.questions.filter(function (q) { return q.scope !== "general"; });
  
  // Shuffle and pick
  generalQ.sort(function () { return Math.random() - 0.5; });
  sessionQ.sort(function () { return Math.random() - 0.5; });
  deepQuestions.sort(function () { return Math.random() - 0.5; });
  
  // 40 general, 100 session-specific from golden, 60 deep
  for (var i = 0; i < Math.min(40, generalQ.length); i++) {
    questions.push({ text: generalQ[i].question, difficulty: generalQ[i].difficulty, source: "golden", family: generalQ[i].expectedFamily });
  }
  for (var j = 0; j < Math.min(100, sessionQ.length); j++) {
    questions.push({ text: sessionQ[j].question, difficulty: sessionQ[j].difficulty, source: "golden", family: sessionQ[j].expectedFamily });
  }
  for (var k = 0; k < Math.min(60, deepQuestions.length); k++) {
    questions.push({ text: deepQuestions[k].question, difficulty: deepQuestions[k].difficulty || "hard", source: "deep", family: "model" });
  }
  
  return questions.slice(0, QUESTIONS_PER_ROUND);
}

// Build histogram
function buildHistogram(latencies) {
  var buckets = [
    { label: "<100ms (instant)", max: 100, count: 0 },
    { label: "100ms-1s", max: 1000, count: 0 },
    { label: "1-5s", max: 5000, count: 0 },
    { label: "5-15s", max: 15000, count: 0 },
    { label: "15-30s", max: 30000, count: 0 },
    { label: "30-60s", max: 60000, count: 0 },
    { label: ">60s (timeout)", max: Infinity, count: 0 },
  ];
  for (var i = 0; i < latencies.length; i++) {
    for (var j = 0; j < buckets.length; j++) {
      if (latencies[i] < buckets[j].max) { buckets[j].count++; break; }
    }
  }
  return buckets;
}

function percentile(sorted, p) {
  var idx = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function run() {
  function step(num, label) {
    console.log("\n--- ITERATION " + round + " | STEP " + num + ": " + label + " ---\n");
  }

  step(1, "DISCOVERING SESSIONS");
  var sessions = discoverSessions(SESSIONS_PER_ROUND);
  console.log("Found " + sessions.length + " sessions");
  
  step(2, "PARSING SESSIONS");
  var parsedSessions = [];
  for (var s = 0; s < sessions.length; s++) {
    var parsed = await parseSessionFile(sessions[s].path);
    if (parsed && parsed.events.length > 0) {
      parsedSessions.push({ id: sessions[s].id, size: sessions[s].size, data: parsed });
      process.stdout.write("  [" + (s + 1) + "/" + sessions.length + "] " + sessions[s].id.slice(0, 12) + "... " + parsed.events.length + " events (" + Math.round(sessions[s].size / 1024) + " KB)\n");
    }
  }
  console.log("Parsed " + parsedSessions.length + " sessions successfully");
  
  step(3, "SELECTING QUESTIONS");
  var questions = selectQuestions(parsedSessions);
  console.log("Selected " + questions.length + " questions (40 general + 100 session-specific + 60 deep)");
  
  step(4, "RUNNING QUESTIONS");
  var results = [];
  var instantCount = 0;
  var modelCount = 0;
  var cachedCount = 0;
  var errorCount = 0;
  var timeoutCount = 0;
  
  for (var q = 0; q < questions.length; q++) {
    var question = questions[q];
    var sessionIdx = q % parsedSessions.length;
    var sessionData = parsedSessions[sessionIdx].data;
    
    var startedAt = Date.now();
    var result = classify(question.text, sessionData);
    
    if (result.tier === "instant") {
      var elapsed = Date.now() - startedAt;
      results.push({ question: question.text, tier: "instant", elapsedMs: elapsed, difficulty: question.difficulty });
      instantCount++;
      if ((q + 1) % 20 === 0) process.stdout.write("  [" + (q + 1) + "/" + questions.length + "] instant: " + instantCount + " model: " + modelCount + " timeout: " + timeoutCount + "\n");
      continue;
    }
    
    // Check fingerprint cache (simulated - just skip if same fingerprint seen)
    var fp = fingerprintQuestion(question.text);
    var alreadySeen = results.some(function (r) { return r.fingerprint === fp && r.tier !== "instant" && r.answer; });
    if (alreadySeen && fp) {
      results.push({ question: question.text, tier: "cached", elapsedMs: 1, difficulty: question.difficulty, fingerprint: fp });
      cachedCount++;
      if ((q + 1) % 20 === 0) process.stdout.write("  [" + (q + 1) + "/" + questions.length + "] instant: " + instantCount + " model: " + modelCount + " cached: " + cachedCount + " timeout: " + timeoutCount + "\n");
      continue;
    }
    
    // Model fallback via server
    var context = buildModelContext(question.text, sessionData);
    var serverResult = await askServer(question.text, context);
    
    if (serverResult.timedOut) timeoutCount++;
    if (serverResult.error) errorCount++;
    
    results.push({
      question: question.text,
      tier: serverResult.timedOut ? "timeout" : "model",
      elapsedMs: serverResult.elapsedMs,
      difficulty: question.difficulty,
      fingerprint: fp,
      answer: serverResult.answer ? serverResult.answer.slice(0, 100) : "",
      error: serverResult.error || null,
    });
    modelCount++;
    
    if ((q + 1) % 20 === 0 || q === questions.length - 1) {
      process.stdout.write("  [" + (q + 1) + "/" + questions.length + "] instant: " + instantCount + " model: " + modelCount + " cached: " + cachedCount + " timeout: " + timeoutCount + "\n");
    }
  }
  
  step(5, "COMPUTING STATISTICS");
  var allLatencies = results.map(function (r) { return r.elapsedMs; }).sort(function (a, b) { return a - b; });
  var modelLatencies = results.filter(function (r) { return r.tier === "model"; }).map(function (r) { return r.elapsedMs; }).sort(function (a, b) { return a - b; });
  
  console.log("\n" + "=".repeat(60));
  console.log("  ITERATION " + round + " RESULTS");
  console.log("=".repeat(60));
  console.log("");
  console.log("Questions: " + results.length);
  console.log("Instant:   " + instantCount + " (" + Math.round(instantCount / results.length * 100) + "%)");
  console.log("Cached:    " + cachedCount + " (" + Math.round(cachedCount / results.length * 100) + "%)");
  console.log("Model:     " + modelCount + " (" + Math.round(modelCount / results.length * 100) + "%)");
  console.log("Timeouts:  " + timeoutCount);
  console.log("Errors:    " + errorCount);
  console.log("");
  console.log("Overall latency:");
  console.log("  p50: " + percentile(allLatencies, 50) + "ms");
  console.log("  p90: " + percentile(allLatencies, 90) + "ms");
  console.log("  p99: " + percentile(allLatencies, 99) + "ms");
  
  if (modelLatencies.length > 0) {
    console.log("\nModel-only latency:");
    console.log("  p50: " + percentile(modelLatencies, 50) + "ms");
    console.log("  p90: " + percentile(modelLatencies, 90) + "ms");
    console.log("  p99: " + percentile(modelLatencies, 99) + "ms");
  }
  
  console.log("\nHistogram:");
  var hist = buildHistogram(allLatencies);
  var maxCount = Math.max.apply(null, hist.map(function (b) { return b.count; }));
  for (var h = 0; h < hist.length; h++) {
    var bar = "#".repeat(Math.round(hist[h].count / Math.max(maxCount, 1) * 30));
    console.log("  " + hist[h].label.padEnd(20) + " " + String(hist[h].count).padStart(4) + " " + bar);
  }
  
  // Slowest queries
  var slowest = results.filter(function (r) { return r.tier === "model" || r.tier === "timeout"; }).sort(function (a, b) { return b.elapsedMs - a.elapsedMs; }).slice(0, 10);
  if (slowest.length > 0) {
    console.log("\nSlowest queries:");
    for (var sl = 0; sl < slowest.length; sl++) {
      var s = slowest[sl];
      console.log("  " + (s.elapsedMs / 1000).toFixed(1) + "s | " + s.tier + " | " + s.difficulty + " | " + s.question.slice(0, 80));
    }
  }
  
  step(6, "SAVING RESULTS");
  var outPath = "C:/Users/arjagann/.copilot/session-state/8a86a63f-3963-430e-91a4-fbc9864c41c9/files/phase-9-round-" + round + ".json";
  fs.writeFileSync(outPath, JSON.stringify({
    round: round,
    timestamp: new Date().toISOString(),
    questions: results.length,
    instant: instantCount,
    cached: cachedCount,
    model: modelCount,
    timeouts: timeoutCount,
    errors: errorCount,
    p50: percentile(allLatencies, 50),
    p90: percentile(allLatencies, 90),
    p99: percentile(allLatencies, 99),
    histogram: hist,
    slowest: slowest.slice(0, 5).map(function (s) { return { question: s.question, elapsedMs: s.elapsedMs, tier: s.tier }; }),
  }, null, 2));
  console.log("\nResults saved to " + outPath);
}

run().catch(function (e) { console.error("Fatal:", e); process.exit(1); });
