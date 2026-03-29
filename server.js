/**
 * AGENTVIZ local server.
 * Serves dist/ as a static SPA and provides:
 *   GET /api/file   -- returns the watched session file as text
 *   GET /api/meta   -- returns { filename } JSON
 *   GET /api/stream -- SSE endpoint, pushes new JSONL lines as the file grows
 */

import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import url from "url";
import { runCoachAgent } from "./src/lib/aiCoachAgent.js";
import {
  buildQAContext,
  buildQAPrompt,
  buildRawJsonlRecordIndex,
  buildSessionQAProgramCacheKey,
  buildSessionQAArtifacts,
  buildToolCallSearchIndex,
  compileSessionQAQueryProgram,
  describeSessionQAQueryProgram,
  routeSessionQAQuestion,
  scanRawJsonlQuestionMatches,
} from "./src/lib/sessionQA.js";
import {
  ensureSessionQAFactStore,
  querySessionQAFactStore,
} from "./src/lib/sessionQAFactStore.js";
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

export function buildQASessionConfig(promptSystem, onPermissionRequest) {
  return {
    onPermissionRequest: onPermissionRequest,
    streaming: true,
    systemMessage: {
      mode: "replace",
      content: promptSystem,
    },
  };
}

export function getSessionQAHistoryFilePath(homeDir) {
  return path.join(homeDir || os.homedir(), ".agentviz", "session-qa-history.json");
}

export function sanitizeSessionQATiming(timing) {
  var totalMs = timing && timing.totalMs;
  var numericTotalMs = typeof totalMs === "number" ? totalMs : Number(totalMs);
  if (!Number.isFinite(numericTotalMs) || numericTotalMs < 0) return null;
  return { totalMs: Math.round(numericTotalMs) };
}

export function sanitizeSessionQAMessages(messages) {
  return Array.isArray(messages) ? messages
    .filter(function (message) {
      return message && typeof message.role === "string" &&
        typeof message.content === "string" &&
        (message.content || message.role !== "assistant");
    })
    .map(function (message) {
      var sanitizedMessage = {
        role: message.role,
        content: message.content,
        references: Array.isArray(message.references) ? message.references : [],
      };
      var timing = sanitizeSessionQATiming(message.timing);
      if (timing) sanitizedMessage.timing = timing;
      return sanitizedMessage;
    }) : [];
}

export function sanitizeSessionQAHistoryEntry(entry) {
  return {
    messages: sanitizeSessionQAMessages(entry && entry.messages),
    responseModel: entry && entry.responseModel ? String(entry.responseModel) : null,
    qaSessionId: entry && entry.qaSessionId ? String(entry.qaSessionId) : null,
    updatedAt: new Date().toISOString(),
  };
}

export function readSessionQAHistoryStore(filePath, fsModule) {
  var targetFs = fsModule || fs;
  try {
    var raw = targetFs.readFileSync(filePath, "utf8");
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { version: 1, sessions: {} };
    return {
      version: 1,
      sessions: parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {},
    };
  } catch (error) {
    return { version: 1, sessions: {} };
  }
}

export function writeSessionQAHistoryStore(filePath, store, fsModule) {
  var targetFs = fsModule || fs;
  targetFs.mkdirSync(path.dirname(filePath), { recursive: true });
  targetFs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
}

export function getSessionQAHistoryEntry(filePath, sessionKey, fsModule) {
  if (!sessionKey) return null;
  var store = readSessionQAHistoryStore(filePath, fsModule);
  return store.sessions[sessionKey] || null;
}

export function saveSessionQAHistoryEntry(filePath, sessionKey, entry, fsModule) {
  if (!sessionKey) return null;
  var store = readSessionQAHistoryStore(filePath, fsModule);
  store.sessions[sessionKey] = sanitizeSessionQAHistoryEntry(entry);
  writeSessionQAHistoryStore(filePath, store, fsModule);
  return store.sessions[sessionKey];
}

export function removeSessionQAHistoryEntry(filePath, sessionKey, fsModule) {
  if (!sessionKey) return false;
  var store = readSessionQAHistoryStore(filePath, fsModule);
  if (!Object.prototype.hasOwnProperty.call(store.sessions, sessionKey)) return false;
  delete store.sessions[sessionKey];
  writeSessionQAHistoryStore(filePath, store, fsModule);
  return true;
}

function hashText(text) {
  var value = 0;
  var source = text || "";

  for (var index = 0; index < source.length; index += 1) {
    value = ((value << 5) - value + source.charCodeAt(index)) | 0;
  }

  return String(Math.abs(value));
}

function cloneJsonValue(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

var SESSION_QA_PRECOMPUTE_VERSION = 2;

export function getSessionQAPrecomputeCacheDir(homeDir) {
  return path.join(homeDir || os.homedir(), ".agentviz", "session-qa-cache");
}

export function getSessionQASidecarFilePath(sessionFilePath) {
  if (!sessionFilePath) return null;
  var ext = path.extname(sessionFilePath);
  if (ext.toLowerCase() === ".jsonl") {
    return sessionFilePath.slice(0, sessionFilePath.length - ext.length) + ".agentviz-qa.json";
  }
  return sessionFilePath + ".agentviz-qa.json";
}

function getManagedSessionQAPrecomputePath(fingerprint, homeDir) {
  return path.join(getSessionQAPrecomputeCacheDir(homeDir), "session-" + hashText(fingerprint) + ".json");
}

export function readSessionQAPrecompute(filePath, fsModule) {
  if (!filePath) return null;
  var targetFs = fsModule || fs;
  try {
    var raw = targetFs.readFileSync(filePath, "utf8");
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

export function writeSessionQAPrecompute(filePath, record, fsModule) {
  if (!filePath || !record) return false;
  var targetFs = fsModule || fs;
  try {
    targetFs.mkdirSync(path.dirname(filePath), { recursive: true });
    targetFs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf8");
    return true;
  } catch (error) {
    return false;
  }
}

function getSessionQARawText(entry, fsModule) {
  if (entry && typeof entry.rawText === "string") return entry.rawText;
  if (!entry || !entry.sessionFilePath) return "";
  var targetFs = fsModule || fs;
  try {
    return targetFs.readFileSync(entry.sessionFilePath, "utf8");
  } catch (error) {
    return "";
  }
}

function copyPersistedRawSlice(rawSlice) {
  if (!rawSlice || typeof rawSlice !== "object") return null;
  return {
    strategy: rawSlice.strategy || "unknown",
    lineStart: typeof rawSlice.lineStart === "number" ? rawSlice.lineStart : null,
    lineEnd: typeof rawSlice.lineEnd === "number" ? rawSlice.lineEnd : null,
    charStart: typeof rawSlice.charStart === "number" ? rawSlice.charStart : null,
    charEnd: typeof rawSlice.charEnd === "number" ? rawSlice.charEnd : null,
    startRecordIndex: typeof rawSlice.startRecordIndex === "number" ? rawSlice.startRecordIndex : null,
    endRecordIndex: typeof rawSlice.endRecordIndex === "number" ? rawSlice.endRecordIndex : null,
    toolCallId: rawSlice.toolCallId || null,
    toolUseId: rawSlice.toolUseId || null,
  };
}

function copyPersistedLedgerEntry(entry) {
  var cloned = cloneJsonValue(entry);
  if (!cloned || typeof cloned !== "object") return null;
  if (cloned.rawSlice) cloned.rawSlice = copyPersistedRawSlice(cloned.rawSlice);
  return cloned;
}

function sanitizePersistedSessionQAArtifacts(artifacts) {
  if (!artifacts || typeof artifacts !== "object") return null;
  var ledger = Array.isArray(artifacts.ledger)
    ? artifacts.ledger.map(copyPersistedLedgerEntry).filter(Boolean)
    : [];

  return {
    turnRecords: Array.isArray(artifacts.turnRecords) ? cloneJsonValue(artifacts.turnRecords) : [],
    ledger: ledger,
    turnSummaries: Array.isArray(artifacts.turnSummaries) ? cloneJsonValue(artifacts.turnSummaries) : [],
    summaryChunks: Array.isArray(artifacts.summaryChunks) ? cloneJsonValue(artifacts.summaryChunks) : [],
    stats: artifacts.stats && typeof artifacts.stats === "object" ? cloneJsonValue(artifacts.stats) : null,
    metricCatalog: artifacts.metricCatalog && typeof artifacts.metricCatalog === "object"
      ? cloneJsonValue(artifacts.metricCatalog)
      : null,
    metadata: artifacts.metadata && typeof artifacts.metadata === "object" ? cloneJsonValue(artifacts.metadata) : null,
    rawLookup: artifacts.rawLookup && typeof artifacts.rawLookup === "object"
      ? { matchedCount: Number(artifacts.rawLookup.matchedCount) || 0 }
      : null,
    rawIndex: null,
  };
}

function hydratePersistedSessionQAArtifacts(artifacts, rawText) {
  var cloned = cloneJsonValue(artifacts);
  if (!cloned || typeof cloned !== "object") return null;
  var ledger = Array.isArray(cloned.ledger) ? cloned.ledger : [];
  if (!cloned.ledgerIndex && ledger.length > 0) {
    cloned.ledgerIndex = buildToolCallSearchIndex(ledger);
  }
  cloned.rawIndex = null;
  if (cloned.rawLookup || rawText) {
    cloned.rawLookup = Object.assign({}, cloned.rawLookup || {}, {
      rawText: rawText || "",
      rawIndex: null,
      ledger: ledger,
      ledgerIndex: cloned.ledgerIndex || null,
    });
  }
  return cloned;
}

export function buildSessionQAPrecomputeFingerprint(entry, fsModule) {
  var targetFs = fsModule || fs;
  var events = Array.isArray(entry && entry.events) ? entry.events : [];
  var turns = Array.isArray(entry && entry.turns) ? entry.turns : [];
  var metadata = entry && entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {};
  var lastEvent = events.length > 0 ? events[events.length - 1] : null;
  var rawText = entry && typeof entry.rawText === "string" ? entry.rawText : "";
  var fileStat = "";

  if (!rawText && entry && entry.sessionFilePath) {
    try {
      var stat = targetFs.statSync(entry.sessionFilePath);
      fileStat = [stat.size, Math.round(stat.mtimeMs)].join("|");
    } catch (error) {}
  }

  return [
    entry && entry.sessionFilePath ? String(entry.sessionFilePath).toLowerCase() : "",
    rawText ? [rawText.length, hashText(rawText)].join(":") : "",
    events.length,
    turns.length,
    lastEvent && lastEvent.t != null ? lastEvent.t : "",
    lastEvent && lastEvent.toolName ? lastEvent.toolName : "",
    metadata.totalEvents != null ? metadata.totalEvents : "",
    metadata.totalTurns != null ? metadata.totalTurns : "",
    metadata.totalToolCalls != null ? metadata.totalToolCalls : "",
    metadata.errorCount != null ? metadata.errorCount : "",
    metadata.duration != null ? metadata.duration : "",
    fileStat,
  ].join("|");
}

export function buildSessionQAPrecomputeEntry(entry, options) {
  var opts = options && typeof options === "object" ? options : {};
  var targetFs = opts.fsModule || fs;
  var fingerprint = buildSessionQAPrecomputeFingerprint(entry, targetFs);
  var rawText = getSessionQARawText(entry, targetFs);
  var includeRawText = !entry || !entry.sessionFilePath;
  var candidatePaths = [];
  var sidecarPath = entry && entry.sessionFilePath ? getSessionQASidecarFilePath(entry.sessionFilePath) : null;
  var managedPath = getManagedSessionQAPrecomputePath(fingerprint, opts.homeDir);
  if (sidecarPath) candidatePaths.push({ path: sidecarPath, storage: "sidecar" });
  candidatePaths.push({ path: managedPath, storage: "managed" });

  for (var candidateIndex = 0; candidateIndex < candidatePaths.length; candidateIndex++) {
    var existing = readSessionQAPrecompute(candidatePaths[candidateIndex].path, targetFs);
    if (
      !existing ||
      existing.version !== SESSION_QA_PRECOMPUTE_VERSION ||
      existing.fingerprint !== fingerprint ||
      !existing.artifacts
    ) continue;
    var persistedRawText = typeof existing.rawText === "string" ? existing.rawText : rawText;
    return {
      fingerprint: fingerprint,
      storage: candidatePaths[candidateIndex].storage,
      path: candidatePaths[candidateIndex].path,
      builtAt: existing.builtAt || existing.updatedAt || null,
      reused: true,
      artifacts: hydratePersistedSessionQAArtifacts(existing.artifacts, persistedRawText),
      rawText: persistedRawText || null,
    };
  }

  var artifactOptions = rawText ? { rawText: rawText } : null;
  var artifacts = buildSessionQAArtifacts(entry && entry.events, entry && entry.turns, entry && entry.metadata, artifactOptions);
  var builtAt = new Date().toISOString();
  var record = {
    version: SESSION_QA_PRECOMPUTE_VERSION,
    fingerprint: fingerprint,
    builtAt: builtAt,
    sessionFilePath: entry && entry.sessionFilePath ? String(entry.sessionFilePath) : null,
    rawText: includeRawText ? rawText : null,
    artifacts: sanitizePersistedSessionQAArtifacts(artifacts),
  };
  var persistedStorage = "memory";
  var persistedPath = null;

  for (var writeIndex = 0; writeIndex < candidatePaths.length; writeIndex++) {
    if (!writeSessionQAPrecompute(candidatePaths[writeIndex].path, record, targetFs)) continue;
    persistedStorage = candidatePaths[writeIndex].storage;
    persistedPath = candidatePaths[writeIndex].path;
    break;
  }

  var hydratedArtifacts = hydratePersistedSessionQAArtifacts(record.artifacts, rawText);

  return {
    fingerprint: fingerprint,
    storage: persistedStorage,
    path: persistedPath,
    builtAt: builtAt,
    reused: false,
    artifacts: hydratedArtifacts || artifacts,
    rawText: rawText || null,
  };
}

export function ensureSessionQAPrecomputed(entry, options) {
  if (!entry || typeof entry !== "object") return null;
  var opts = options && typeof options === "object" ? options : {};
  var targetFs = opts.fsModule || fs;
  var fingerprint = buildSessionQAPrecomputeFingerprint(entry, targetFs);
  if (entry.precomputed && entry.precomputed.fingerprint === fingerprint && entry.precomputed.artifacts) {
    return entry.precomputed;
  }
  var built = buildSessionQAPrecomputeEntry(entry, opts);
  entry.precomputed = built;
  if (!entry.questionCache || entry.questionCacheFingerprint !== built.fingerprint) {
    entry.questionCache = {};
    entry.questionCacheFingerprint = built.fingerprint;
  }
  if (!entry.programCache || entry.programCacheFingerprint !== built.fingerprint) {
    entry.programCache = {};
    entry.programCacheFingerprint = built.fingerprint;
  }
  if (entry.factStore && entry.factStore.fingerprint !== built.fingerprint) {
    entry.factStore = null;
  }
  return built;
}

export function createSessionQACacheStore() {
  return new Map();
}

export function sanitizeSessionQACacheEntry(entry) {
  return {
    events: Array.isArray(entry && entry.events) ? entry.events.slice() : [],
    turns: Array.isArray(entry && entry.turns) ? entry.turns.slice() : [],
    metadata: entry && entry.metadata && typeof entry.metadata === "object"
      ? Object.assign({}, entry.metadata)
      : {},
    sessionFilePath: entry && entry.sessionFilePath ? String(entry.sessionFilePath) : null,
    rawText: entry && typeof entry.rawText === "string" ? entry.rawText : null,
    precomputed: entry && entry.precomputed ? entry.precomputed : null,
    questionCache: entry && entry.questionCache && typeof entry.questionCache === "object"
      ? entry.questionCache
      : {},
    questionCacheFingerprint: entry && entry.questionCacheFingerprint ? String(entry.questionCacheFingerprint) : null,
    programCache: entry && entry.programCache && typeof entry.programCache === "object"
      ? entry.programCache
      : {},
    programCacheFingerprint: entry && entry.programCacheFingerprint ? String(entry.programCacheFingerprint) : null,
    factStore: entry && entry.factStore && typeof entry.factStore === "object"
      ? entry.factStore
      : null,
    updatedAt: new Date().toISOString(),
  };
}

export function getSessionQACacheEntry(cache, sessionKey) {
  if (!cache || !sessionKey) return null;
  return cache.get(String(sessionKey)) || null;
}

export function saveSessionQACacheEntry(cache, sessionKey, entry) {
  if (!cache || !sessionKey) return null;
  var existing = cache.get(String(sessionKey)) || null;
  var saved = sanitizeSessionQACacheEntry(entry);
  if (existing && existing.precomputed && !saved.precomputed) saved.precomputed = existing.precomputed;
  if (existing && existing.questionCache && Object.keys(existing.questionCache).length > 0) {
    saved.questionCache = existing.questionCache;
    if (!saved.questionCacheFingerprint && existing.questionCacheFingerprint) {
      saved.questionCacheFingerprint = existing.questionCacheFingerprint;
    }
  }
  if (existing && existing.programCache && Object.keys(existing.programCache).length > 0) {
    saved.programCache = existing.programCache;
    if (!saved.programCacheFingerprint && existing.programCacheFingerprint) {
      saved.programCacheFingerprint = existing.programCacheFingerprint;
    }
  }
  if (existing && existing.factStore && !saved.factStore) {
    saved.factStore = existing.factStore;
  }
  cache.set(String(sessionKey), saved);
  return saved;
}

export function removeSessionQACacheEntry(cache, sessionKey) {
  if (!cache || !sessionKey) return false;
  return cache.delete(String(sessionKey));
}

function hasInlineSessionQAArtifacts(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (Array.isArray(payload.events)) return true;
  if (Array.isArray(payload.turns)) return true;
  if (payload.metadata && typeof payload.metadata === "object") return true;
  return Boolean(payload.sessionFilePath);
}

export function resolveSessionQAArtifacts(cache, payload) {
  var sessionKey = payload && payload.sessionKey ? String(payload.sessionKey) : null;
  var cached = sessionKey ? getSessionQACacheEntry(cache, sessionKey) : null;
  if (cached) {
    return Object.assign({ sessionKey: sessionKey, source: "cache" }, cached);
  }
  if (!hasInlineSessionQAArtifacts(payload)) return null;
  var inlineEntry = sessionKey
    ? saveSessionQACacheEntry(cache, sessionKey, payload)
    : sanitizeSessionQACacheEntry(payload);
  return Object.assign({ sessionKey: sessionKey, source: "inline" }, inlineEntry);
}

export function getQAEventText(data, isDelta) {
  if (!data) return "";
  if (isDelta && typeof data.deltaContent === "string") return data.deltaContent;
  if (typeof data.text === "string") return data.text;
  if (typeof data.content === "string") return data.content;
  if (Array.isArray(data.content)) {
    return data.content.map(function (item) {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      return item.text || item.content || "";
    }).join("");
  }
  if (data.content && typeof data.content === "object") {
    return data.content.text || data.content.content || "";
  }
  if (typeof data.deltaContent === "string") return data.deltaContent;
  return "";
}

export function buildQATiming(startedAtMs, completedAtMs) {
  var start = typeof startedAtMs === "number" ? startedAtMs : Number(startedAtMs);
  var end = typeof completedAtMs === "number" ? completedAtMs : Number(completedAtMs);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { totalMs: 0 };
  return { totalMs: Math.max(0, Math.round(end - start)) };
}

export function buildQADonePayload(answer, references, modelLabel, qaSessionId, startedAtMs, completedAtMs) {
  return {
    done: true,
    answer: answer,
    references: references,
    model: modelLabel,
    qaSessionId: qaSessionId,
    timing: buildQATiming(startedAtMs, completedAtMs),
  };
}

export function getQAToolName(data) {
  if (!data || typeof data !== "object") return "";
  return data.toolName || data.name || (data.tool && data.tool.name) ||
    (data.invocation && data.invocation.toolName) || "";
}

export function describeQAToolStatus(toolName, phase) {
  var name = String(toolName || "").trim();
  var lower = name.toLowerCase();
  if (!lower) {
    return phase === "complete" ? "Analyzing tool results..." : "Running tools...";
  }
  if (lower === "view" || lower === "read" || lower === "grep" || lower === "rg" || lower === "search_code") {
    return phase === "complete" ? "Analyzing search results..." : "Searching the session...";
  }
  if (lower.indexOf("kusto") !== -1) {
    return phase === "complete" ? "Analyzing Kusto results..." : "Running Kusto queries...";
  }
  if (lower === "powershell" || lower === "bash" || lower === "terminal") {
    return phase === "complete" ? "Analyzing command output..." : "Running shell commands...";
  }
  return phase === "complete" ? "Analyzing " + name + " results..." : "Running " + name + "...";
}

function sanitizeQAElapsedMs(value) {
  var numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return null;
  return Math.round(numericValue);
}

function formatQACount(value, singular, plural) {
  var numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return null;
  var roundedValue = Math.round(numericValue);
  return roundedValue.toLocaleString() + " " + (roundedValue === 1 ? singular : (plural || singular + "s"));
}

function describeQAContextPreparation(events, turns, metadata) {
  var safeMetadata = metadata && typeof metadata === "object" ? metadata : {};
  var eventCount = safeMetadata.totalEvents != null ? safeMetadata.totalEvents : (Array.isArray(events) ? events.length : 0);
  var turnCount = safeMetadata.totalTurns != null ? safeMetadata.totalTurns : (Array.isArray(turns) ? turns.length : 0);
  var eventLabel = formatQACount(eventCount, "event");
  var turnLabel = formatQACount(turnCount, "turn");
  if (eventLabel && turnLabel) return "Reviewing " + eventLabel + " across " + turnLabel + ".";
  if (eventLabel) return "Reviewing " + eventLabel + ".";
  if (turnLabel) return "Reviewing " + turnLabel + ".";
  return "Reviewing the loaded session.";
}

function describeQAContextRetrieval(resolvedSession) {
  if (!resolvedSession || typeof resolvedSession !== "object") return null;
  var source = resolvedSession.source === "cache"
    ? "Using the cached session snapshot."
    : "Using the session data from this request.";
  if (!resolvedSession.sessionFilePath) return source;
  return source + " Raw session file access is available if the model needs exact output.";
}

function describeSessionQAProgramCompilation(queryProgram) {
  if (!queryProgram) return "Compiling the question into a structured session query.";
  var family = describeSessionQAQueryProgram(queryProgram);
  if (queryProgram.deterministic && !queryProgram.needsModel) {
    return "Compiled the question into the " + family + " family so AGENTVIZ can avoid the model if possible.";
  }
  return "Compiled the question into the " + family + " family before choosing the fastest route.";
}

function describeSessionQAFactStoreLookup(queryProgram, factStore) {
  var family = describeSessionQAQueryProgram(queryProgram);
  if (factStore && factStore.storage === "sidecar") {
    return "Querying the SQLite fact-store sidecar for the " + family + " family.";
  }
  return "Querying the SQLite fact store for the " + family + " family.";
}

function shouldLaunchSessionQARace(queryProgram) {
  return Boolean(queryProgram && queryProgram.raceEligible && queryProgram.canAnswerFromFactStore);
}

function buildSessionQARoutePlan(question, events, turns, metadata, qaArtifacts, options) {
  var opts = options && typeof options === "object" ? options : {};
  var route = routeSessionQAQuestion(question, qaArtifacts, {
    rawText: opts.rawText,
    rawIndex: opts.rawIndex,
    sessionFilePath: opts.sessionFilePath,
    queryProgram: opts.queryProgram,
    questionProfile: opts.queryProgram && opts.queryProgram.questionProfile
      ? opts.queryProgram.questionProfile
      : null,
  });
  var rawIndex = opts.rawIndex || null;

  if (route && route.kind === "raw-full" && rawIndex) {
    route.rawMatches = scanRawJsonlQuestionMatches(rawIndex, question, {
      questionProfile: route.profile,
      artifacts: qaArtifacts,
    });
  } else if (route && route.kind === "raw-full" && opts.rawText) {
    rawIndex = buildRawJsonlRecordIndex(opts.rawText);
    if (qaArtifacts && !qaArtifacts.rawIndex) qaArtifacts.rawIndex = rawIndex;
    route.rawMatches = scanRawJsonlQuestionMatches(rawIndex, question, {
      questionProfile: route.profile,
      artifacts: qaArtifacts,
    });
  }

  var context = "";
  if (route && route.kind !== "metric") {
    context = buildQAContext(events, turns, metadata, {
      question: question,
      artifacts: qaArtifacts,
      route: route,
    });
  }

  return {
    route: route,
    context: context,
    rawIndex: rawIndex,
  };
}

function describeQAToolDetail(toolName) {
  var name = String(toolName || "").trim();
  return name ? "Tool: " + name : null;
}

export function getQAProgressStatus(phase, options) {
  var opts = options && typeof options === "object" ? options : {};
  if (opts.status) return String(opts.status);
  if (phase === "tool-running") return describeQAToolStatus(opts.toolName, "start");
  if (phase === "tool-finished") return describeQAToolStatus(opts.toolName, "complete");
  if (phase === "precomputing-session") return "Building session index...";
  if (phase === "compiling-query-program") return "Compiling query program...";
  if (phase === "checking-paraphrase-cache") return "Checking paraphrase-aware cache...";
  if (phase === "querying-fact-store") return "Querying SQLite fact store...";
  if (phase === "launching-fallback-route") return "Launching fallback route...";
  if (phase === "canceling-slower-route") return "Canceling slower route...";
  if (phase === "using-cached-program-answer") return "Using cached program answer...";
  if (phase === "using-precomputed-metrics") return "Using precomputed metrics...";
  if (phase === "searching-index") return "Searching tool and query index...";
  if (phase === "scanning-summary-chunks") return "Scanning summary chunks...";
  if (phase === "reading-targeted-raw") return "Reading targeted raw JSONL slices...";
  if (phase === "reading-full-raw") return "Reading full raw JSONL...";
  if (phase === "preparing-context") return "Preparing session context...";
  if (phase === "retrieving-context") return "Retrieving session context...";
  if (phase === "resuming-session") return "Resuming previous Q&A session...";
  if (phase === "starting-session") return "Starting Q&A session...";
  if (phase === "waiting-for-model") return "Waiting for model response...";
  if (phase === "thinking") return "Thinking through the session...";
  if (phase === "detail-fetch") return "Fetching detailed tool output...";
  if (phase === "streaming-answer") return "Streaming answer...";
  return "Working on your question...";
}

export function buildQAProgressPayload(phase, options) {
  var opts = options && typeof options === "object" ? options : {};
  var payload = {
    status: getQAProgressStatus(phase, opts),
  };
  if (phase) payload.phase = phase;

  var detail = typeof opts.detail === "string" ? opts.detail.trim() : "";
  if (!detail && (phase === "tool-running" || phase === "tool-finished")) {
    detail = describeQAToolDetail(opts.toolName) || "";
  }
  if (detail) payload.detail = detail;

  var elapsedMs = sanitizeQAElapsedMs(opts.elapsedMs);
  if (elapsedMs !== null) payload.elapsedMs = elapsedMs;
  if (opts.heartbeat) payload.heartbeat = true;
  return payload;
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

export function createServer({ sessionFile, distDir, maxBodyBytes }) {
  var clients = new Set();
  var lastLineIdx = 0;
  var watcher = null;
  var watcherClosed = false;
  var pollInterval = null;
  var sessionQACache = createSessionQACacheStore();

  // Periodically clear stale session QA cache entries to prevent unbounded
  // memory growth in long-running server processes.
  var SESSION_QA_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  setInterval(function () {
    if (sessionQACache && typeof sessionQACache.clear === "function") {
      sessionQACache.clear();
    }
  }, SESSION_QA_CACHE_TTL_MS);

  // Context-based model answer cache: stores model answers keyed by a hash of
  // the context + question family, so different phrasings that produce the same
  // retrieval context can share cached answers. Max 50 entries, LRU eviction.
  var modelAnswerCache = {};
  var modelAnswerCacheOrder = [];
  var MODEL_ANSWER_CACHE_MAX = 50;

  function hashContextKey(fingerprint, family, contextSubstr, model) {
    var input = (fingerprint || "") + "|" + (family || "") + "|" + (model || "") + "|" + (contextSubstr || "");
    var hash = 0;
    for (var i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return String(Math.abs(hash));
  }

  function getCachedModelAnswer(fingerprint, family, context, model) {
    var key = hashContextKey(fingerprint, family, context, model);
    var entry = modelAnswerCache[key];
    if (!entry) return null;
    var idx = modelAnswerCacheOrder.indexOf(key);
    if (idx > 0) { modelAnswerCacheOrder.splice(idx, 1); modelAnswerCacheOrder.unshift(key); }
    return entry;
  }

  function setCachedModelAnswer(fingerprint, family, context, answer, references, model) {
    var key = hashContextKey(fingerprint, family, context, model);
    modelAnswerCache[key] = { answer: answer, references: references, model: model, cachedAt: Date.now() };
    var idx = modelAnswerCacheOrder.indexOf(key);
    if (idx !== -1) modelAnswerCacheOrder.splice(idx, 1);
    modelAnswerCacheOrder.unshift(key);
    while (modelAnswerCacheOrder.length > MODEL_ANSWER_CACHE_MAX) {
      var evicted = modelAnswerCacheOrder.pop();
      delete modelAnswerCache[evicted];
    }
  }

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
          res.end(JSON.stringify({ success: true, path: resolvedPath, originalContent: originalContent }));
        } catch (e) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: e.message || "Internal server error" }));
        }
      });
      return;
    }

    if (pathname === "/api/session-qa-history") {
      res.setHeader("Content-Type", "application/json");
      var qaHistoryFile = getSessionQAHistoryFilePath();

      if (req.method === "GET") {
        var historySessionKey = parsed.query.sessionKey || "";
        if (!historySessionKey) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "sessionKey is required" }));
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ history: getSessionQAHistoryEntry(qaHistoryFile, historySessionKey) }));
        return;
      }

      if (req.method === "DELETE") {
        var deleteSessionKey = parsed.query.sessionKey || "";
        if (!deleteSessionKey) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "sessionKey is required" }));
          return;
        }
        removeSessionQAHistoryEntry(qaHistoryFile, deleteSessionKey);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (req.method !== "POST") {
        res.writeHead(405);
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      var qaHistoryBody = "";
      req.on("data", function (chunk) { qaHistoryBody += chunk; });
      req.on("end", function () {
        try {
          var historyPayload = JSON.parse(qaHistoryBody || "{}");
          if (!historyPayload.sessionKey) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "sessionKey is required" }));
            return;
          }
          var savedHistory = saveSessionQAHistoryEntry(
            qaHistoryFile,
            historyPayload.sessionKey,
            historyPayload.history || historyPayload
          );
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, history: savedHistory }));
        } catch (error) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: error.message || "Could not persist session Q&A history" }));
        }
      });
      return;
    }

    if (pathname === "/api/session-qa-cache") {
      res.setHeader("Content-Type", "application/json");

      if (req.method === "GET") {
        var cacheSessionKey = parsed.query.sessionKey || "";
        if (!cacheSessionKey) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "sessionKey is required" }));
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ session: getSessionQACacheEntry(sessionQACache, cacheSessionKey) }));
        return;
      }

      if (req.method === "DELETE") {
        var deleteCacheSessionKey = parsed.query.sessionKey || "";
        if (!deleteCacheSessionKey) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "sessionKey is required" }));
          return;
        }
        removeSessionQACacheEntry(sessionQACache, deleteCacheSessionKey);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (req.method !== "POST") {
        res.writeHead(405);
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      var qaCacheChunks = [];
      var qaCacheBytes = 0;
      var qaCacheOverflow = false;
      var MAX_CACHE_BODY_BYTES = maxBodyBytes || 100 * 1024 * 1024; // 100MB default
      req.on("data", function (chunk) {
        if (qaCacheOverflow) return;
        var chunkBytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
        qaCacheBytes += chunkBytes;
        if (qaCacheBytes > MAX_CACHE_BODY_BYTES) {
          qaCacheOverflow = true;
          qaCacheChunks = [];
          req.resume();
          return;
        }
        qaCacheChunks.push(chunk);
      });
      req.on("end", async function () {
        if (qaCacheOverflow) {
          res.writeHead(413, {
            "Content-Type": "application/json",
            "Connection": "keep-alive",
          });
          res.end(JSON.stringify({ error: "Request body too large" }));
          return;
        }
        var qaCacheBody = qaCacheChunks.length > 0
          ? (Buffer.isBuffer(qaCacheChunks[0]) ? Buffer.concat(qaCacheChunks).toString("utf8") : qaCacheChunks.join(""))
          : "{}";
        qaCacheChunks = [];
        try {
          var cachePayload = JSON.parse(qaCacheBody || "{}");
          if (!cachePayload.sessionKey) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "sessionKey is required" }));
            return;
          }
          var savedSession = saveSessionQACacheEntry(
            sessionQACache,
            cachePayload.sessionKey,
            cachePayload
          );
          var precomputed = ensureSessionQAPrecomputed(savedSession);
          var factStore = await ensureSessionQAFactStore(savedSession, precomputed, { homeDir: os.homedir() });
          res.writeHead(200);
          res.end(JSON.stringify({
            success: true,
            sessionKey: cachePayload.sessionKey,
            updatedAt: savedSession ? savedSession.updatedAt : null,
            precomputed: precomputed ? {
              fingerprint: precomputed.fingerprint,
              storage: precomputed.storage,
              builtAt: precomputed.builtAt,
              reused: precomputed.reused,
            } : null,
            factStore: factStore ? {
              storage: factStore.storage,
              builtAt: factStore.builtAt,
              reused: factStore.reused,
            } : null,
          }));
        } catch (error) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: error.message || "Could not cache session Q&A data" }));
        }
      });
      return;
    }

    if (pathname === "/api/qa") {
      if (req.method !== "POST") {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(405); res.end(JSON.stringify({ error: "Method not allowed" })); return;
      }
      var qaRequestStartedAt = Date.now();
      var qaChunks = [];
      var qaBytes = 0;
      var qaOverflow = false;
      var MAX_QA_BODY_BYTES = maxBodyBytes || 100 * 1024 * 1024; // 100MB default
      req.on("data", function (chunk) {
        if (qaOverflow) return;
        var chunkBytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
        qaBytes += chunkBytes;
        if (qaBytes > MAX_QA_BODY_BYTES) {
          qaOverflow = true;
          qaChunks = [];
          req.resume();
          return;
        }
        qaChunks.push(chunk);
      });
      req.on("end", async function () {
        if (qaOverflow) {
          res.writeHead(413, {
            "Content-Type": "application/json",
            "Connection": "keep-alive",
          });
          res.end(JSON.stringify({ error: "Request body too large" }));
          return;
        }
        var qaBody = qaChunks.length > 0
          ? (Buffer.isBuffer(qaChunks[0]) ? Buffer.concat(qaChunks).toString("utf8") : qaChunks.join(""))
          : "{}";
        qaChunks = [];
        var payload;
        try {
          payload = JSON.parse(qaBody || "{}");
        } catch (error) {
          res.setHeader("Content-Type", "application/json");
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        var question = payload.question;
        var requestedModel = payload.model || null;
        var qaSessionId = payload.qaSessionId || null;
        var resolvedSession = resolveSessionQAArtifacts(sessionQACache, payload);

        if (!question) {
          res.setHeader("Content-Type", "application/json");
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Missing 'question' field" }));
          return;
        }
        if (!resolvedSession) {
          res.setHeader("Content-Type", "application/json");
          res.writeHead(payload.sessionKey ? 409 : 400);
          res.end(JSON.stringify({
            error: payload.sessionKey
              ? "No cached session found for sessionKey. Register the session before asking questions."
              : "Missing session data",
          }));
          return;
        }

        // SSE streaming response
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.writeHead(200);

        function sseSend(data) {
          if (!res.writableEnded) res.write("data: " + JSON.stringify(data) + "\n\n");
        }
        var stopProgressHeartbeat = function () {};
        try {
          var events = resolvedSession.events;
          var turns = resolvedSession.turns;
          var metadata = resolvedSession.metadata;
          var sessionFilePath = resolvedSession.sessionFilePath;
          var precomputed = ensureSessionQAPrecomputed(resolvedSession);
          var qaArtifacts = precomputed && precomputed.artifacts
            ? precomputed.artifacts
            : buildSessionQAArtifacts(events, turns, metadata);
          var rawText = precomputed && typeof precomputed.rawText === "string"
            ? precomputed.rawText
            : getSessionQARawText(resolvedSession);
          var rawIndex = qaArtifacts && qaArtifacts.rawIndex
            ? qaArtifacts.rawIndex
            : null;
          if (qaArtifacts && qaArtifacts.rawLookup && rawText && !qaArtifacts.rawLookup.rawText) {
            qaArtifacts.rawLookup.rawText = rawText;
          }

          var currentProgress = null;
          var lastProgressSignature = "";
          var lastProgressSentAt = 0;
          var progressHeartbeat = setInterval(function () {
            if (!currentProgress || currentProgress.phase === "streaming-answer") return;
            if (Date.now() - lastProgressSentAt < 2000) return;
            lastProgressSentAt = Date.now();
            sseSend(buildQAProgressPayload(currentProgress.phase, {
              status: currentProgress.status,
              detail: currentProgress.detail,
              elapsedMs: Date.now() - qaRequestStartedAt,
              heartbeat: true,
            }));
          }, 1500);

          stopProgressHeartbeat = function () {
            if (!progressHeartbeat) return;
            clearInterval(progressHeartbeat);
            progressHeartbeat = null;
          };

          function sendProgress(phase, options) {
            var opts = options && typeof options === "object" ? options : {};
            var payload = buildQAProgressPayload(phase, {
              status: opts.status,
              detail: opts.detail,
              toolName: opts.toolName,
              elapsedMs: opts.elapsedMs != null ? opts.elapsedMs : (Date.now() - qaRequestStartedAt),
              heartbeat: opts.heartbeat,
            });
            currentProgress = {
              phase: payload.phase || phase || null,
              status: payload.status,
              detail: payload.detail || null,
            };
            var signature = [currentProgress.phase || "", currentProgress.status || "", currentProgress.detail || ""].join("|");
            if (!opts.force && signature === lastProgressSignature) return;
            lastProgressSignature = signature;
            lastProgressSentAt = Date.now();
            sseSend(payload);
          }

          sendProgress("precomputing-session", {
            detail: precomputed && precomputed.reused
              ? "Using the precomputed metrics, indexes, and summary chunks for this session."
              : "Building precomputed metrics, indexes, and summary chunks for this session.",
            force: true,
          });

          var context = "";
          var prompt = null;
          var route = null;
          var queryProgram = null;

          if (payload.requestKind === "detail-fetch") {
            sendProgress("detail-fetch", {
              detail: "Pulling the exact tool output referenced in the draft answer.",
              force: true,
            });
            context = buildQAContext(events, turns, metadata, {
              question: question,
              artifacts: qaArtifacts,
            });
            prompt = buildQAPrompt(question, context, { sessionFilePath: null });
          } else {
            queryProgram = compileSessionQAQueryProgram(question, qaArtifacts);
            var programCacheKey = buildSessionQAProgramCacheKey(queryProgram, {
              fingerprint: precomputed ? precomputed.fingerprint : null,
            });
            var cachedProgramPlan = programCacheKey && resolvedSession.programCache
              ? resolvedSession.programCache[programCacheKey]
              : null;

            sendProgress("compiling-query-program", {
              detail: describeSessionQAProgramCompilation(queryProgram),
              force: true,
            });

            sendProgress("checking-paraphrase-cache", {
              detail: cachedProgramPlan && cachedProgramPlan.fingerprint === (precomputed && precomputed.fingerprint)
                ? "Found a paraphrase-aware cache hit for this question family."
                : "No paraphrase-aware cache hit yet, so AGENTVIZ will evaluate the live session facts.",
              force: true,
            });

            if (cachedProgramPlan && cachedProgramPlan.fingerprint === (precomputed && precomputed.fingerprint) &&
                !(queryProgram.deterministic && !queryProgram.needsModel)) {
              if (cachedProgramPlan.directAnswer) {
                sendProgress("using-cached-program-answer", {
                  detail: "Reusing the cached " + describeSessionQAQueryProgram(queryProgram) + " answer.",
                  force: true,
                });
                stopProgressHeartbeat();
                sseSend(buildQADonePayload(
                  cachedProgramPlan.directAnswer,
                  cachedProgramPlan.references || [],
                  cachedProgramPlan.model || "AGENTVIZ cached program answer",
                  qaSessionId,
                  qaRequestStartedAt,
                  Date.now()
                ));
                res.end();
                return;
              }
              route = cachedProgramPlan.route || null;
              context = cachedProgramPlan.context || "";
            }

            if (!route && queryProgram.family === "metric") {
              var metricPlan = buildSessionQARoutePlan(question, events, turns, metadata, qaArtifacts, {
                rawText: rawText,
                rawIndex: rawIndex,
                sessionFilePath: sessionFilePath,
                queryProgram: queryProgram,
              });
              route = metricPlan.route;
              context = metricPlan.context || "";
              rawIndex = metricPlan.rawIndex || rawIndex;
            }

            var fallbackPlanPromise = null;
            if (!route && shouldLaunchSessionQARace(queryProgram)) {
              sendProgress("launching-fallback-route", {
                detail: "Launching the existing router in parallel while AGENTVIZ checks the SQLite fact store.",
                force: true,
              });
              fallbackPlanPromise = Promise.resolve().then(function () {
                return buildSessionQARoutePlan(question, events, turns, metadata, qaArtifacts, {
                  rawText: rawText,
                  rawIndex: rawIndex,
                  sessionFilePath: sessionFilePath,
                  queryProgram: queryProgram,
                });
              });
              fallbackPlanPromise.catch(function () {});
            }

            if (!route && queryProgram.canAnswerFromFactStore) {
              var factStore = await ensureSessionQAFactStore(resolvedSession, precomputed, { homeDir: os.homedir() });
              if (factStore && factStore.path) {
                sendProgress("querying-fact-store", {
                  detail: describeSessionQAFactStoreLookup(queryProgram, factStore),
                  force: true,
                });
                var factStoreResult = await querySessionQAFactStore(queryProgram, factStore, { rawText: rawText });
                if (factStoreResult && typeof factStoreResult.answer === "string" && factStoreResult.answer.trim()) {
                  if (programCacheKey) {
                    resolvedSession.programCache[programCacheKey] = {
                      fingerprint: precomputed ? precomputed.fingerprint : null,
                      directAnswer: factStoreResult.answer,
                      references: factStoreResult.references || [],
                      model: factStoreResult.model || "AGENTVIZ SQLite fact store",
                    };
                  }
                  if (fallbackPlanPromise) {
                    sendProgress("canceling-slower-route", {
                      detail: "The fact-store route answered the question, so AGENTVIZ skipped the slower fallback path.",
                      force: true,
                    });
                  }
                  stopProgressHeartbeat();
                  sseSend(buildQADonePayload(
                    factStoreResult.answer,
                    factStoreResult.references || [],
                    factStoreResult.model || "AGENTVIZ SQLite fact store",
                    qaSessionId,
                    qaRequestStartedAt,
                    Date.now()
                  ));
                  res.end();
                  return;
                }
                if (factStoreResult && typeof factStoreResult.context === "string" && factStoreResult.context.trim()) {
                  route = {
                    kind: "fact-store",
                    phase: "querying-fact-store",
                    status: "Using SQLite fact store...",
                    detail: factStoreResult.detail || describeSessionQAFactStoreLookup(queryProgram, factStore),
                    profile: queryProgram.questionProfile,
                    queryProgram: queryProgram,
                  };
                  context = factStoreResult.context;
                  if (programCacheKey) {
                    resolvedSession.programCache[programCacheKey] = {
                      fingerprint: precomputed ? precomputed.fingerprint : null,
                      route: cloneJsonValue(route),
                      context: context,
                    };
                  }
                  if (fallbackPlanPromise) {
                    sendProgress("canceling-slower-route", {
                      detail: "The fact-store route produced enough context, so AGENTVIZ skipped the slower fallback path.",
                      force: true,
                    });
                  }
                }
              }
            }

            if (!route) {
              var preparedPlan = fallbackPlanPromise
                ? await fallbackPlanPromise
                : buildSessionQARoutePlan(question, events, turns, metadata, qaArtifacts, {
                  rawText: rawText,
                  rawIndex: rawIndex,
                  sessionFilePath: sessionFilePath,
                  queryProgram: queryProgram,
                });
              route = preparedPlan.route;
              context = preparedPlan.context || "";
              rawIndex = preparedPlan.rawIndex || rawIndex;
              if (programCacheKey && route) {
                resolvedSession.programCache[programCacheKey] = {
                  fingerprint: precomputed ? precomputed.fingerprint : null,
                  route: cloneJsonValue(route),
                  context: context || "",
                };
              }
            }

            if (route) {
              sendProgress(route.phase, {
                status: route.status,
                detail: route.detail,
                force: true,
              });
            }

            if (route && route.kind === "metric") {
              if (programCacheKey) {
                resolvedSession.programCache[programCacheKey] = {
                  fingerprint: precomputed ? precomputed.fingerprint : null,
                  directAnswer: route.directAnswer,
                  references: route.references || [],
                  model: "AGENTVIZ precomputed metrics",
                };
              }
              stopProgressHeartbeat();
              sseSend(buildQADonePayload(
                route.directAnswer,
                route.references || [],
                "AGENTVIZ precomputed metrics",
                qaSessionId,
                qaRequestStartedAt,
                Date.now()
              ));
              res.end();
              return;
            }

            if (!route || route.kind === "model") {
              sendProgress("preparing-context", {
                detail: describeQAContextPreparation(events, turns, metadata),
                force: true,
              });
            }
            // Only offer raw file access to the model when retrieval came up short.
            // When search/index/chunk retrieval found good matches, the model should
            // answer from the provided context without scanning the raw JSONL file
            // (which can take 3+ minutes on large sessions).
            var promptSessionFilePath = null;
            if (route && (route.kind === "raw-full" || route.kind === "raw-targeted")) {
              promptSessionFilePath = sessionFilePath;
            }
            // For all other routes (search, index, chunk, model), do NOT offer
            // raw file access. The model must answer from the provided context.
            // This prevents 3+ minute file-scan chains on large sessions.
            var sdkImportPromise = import("@github/copilot-sdk");
            prompt = buildQAPrompt(question, context, { sessionFilePath: promptSessionFilePath });
            sendProgress("retrieving-context", {
              detail: route && route.kind !== "model"
                ? route.detail + " " + describeQAContextRetrieval(resolvedSession)
                : describeQAContextRetrieval(resolvedSession),
            });
          }

          // Check context-based model answer cache before calling the model
          var contextFingerprint = precomputed ? precomputed.fingerprint : null;
          var contextFamily = queryProgram ? queryProgram.family : "unknown";
          var cachedModelAnswer = context ? getCachedModelAnswer(contextFingerprint, contextFamily, context, requestedModel || "default") : null;
          if (cachedModelAnswer && cachedModelAnswer.answer) {
            sendProgress("using-cached-program-answer", {
              detail: "Reusing a cached model answer for similar context.",
              force: true,
            });
            stopProgressHeartbeat();
            sseSend(buildQADonePayload(
              cachedModelAnswer.answer,
              cachedModelAnswer.references || [],
              cachedModelAnswer.model || "AGENTVIZ cached model answer",
              qaSessionId,
              qaRequestStartedAt,
              Date.now()
            ));
            res.end();
            return;
          }

          var sdkModule = typeof sdkImportPromise !== "undefined"
            ? await sdkImportPromise
            : await import("@github/copilot-sdk");
          var CopilotClient = sdkModule.CopilotClient;
          var approveAll = sdkModule.approveAll;
          var client = new CopilotClient();
          var answer = "";
          var returnedSessionId = qaSessionId;

          try {
            await client.start();

            var session;
            if (qaSessionId) {
              sendProgress("resuming-session", {
                detail: "Continuing the previous Q&A conversation with the loaded session.",
              });
              try {
                session = await client.resumeSession(
                  qaSessionId,
                  buildQASessionConfig(prompt.system, approveAll)
                );
              } catch (resumeErr) {
                session = null;
              }
            }

            if (!session) {
              sendProgress("starting-session", {
                detail: requestedModel
                  ? "Launching a fresh " + requestedModel + " Q&A session."
                  : "Launching a fresh Q&A session.",
              });
              var sessionOpts = buildQASessionConfig(prompt.system, approveAll);
              if (requestedModel) sessionOpts.model = requestedModel;
              session = await client.createSession(sessionOpts);
              returnedSessionId = session.sessionId;
            }

            // Abort on client disconnect
            res.on("close", function () {
              stopProgressHeartbeat();
              session && session.abort && session.abort().catch(function () {});
            });

            // Send the question and stream deltas back via SSE
            await new Promise(function (resolve, reject) {
              var done = false;
              var sawDelta = false;
              var unsubscribe = session.on(function (event) {
                if (done) return;
                if (event.type === "session.idle") {
                  done = true;
                  unsubscribe();
                  resolve();
                } else if (event.type === "session.error") {
                  done = true;
                  unsubscribe();
                  reject(new Error(event.data && event.data.message ? event.data.message : "Session error"));
                } else if (event.type === "tool.execution_start") {
                  sendProgress("tool-running", {
                    toolName: getQAToolName(event.data),
                  });
                } else if (event.type === "tool.execution_complete" && !sawDelta) {
                  sendProgress("tool-finished", {
                    toolName: getQAToolName(event.data),
                  });
                } else if (event.type === "assistant.reasoning_delta" && !sawDelta) {
                  sendProgress("thinking", {
                    detail: "Synthesizing an answer from the session timeline.",
                  });
                } else if (event.type === "assistant.message_delta" || event.type === "assistant.message.delta") {
                  var delta = getQAEventText(event.data, true);
                  if (delta) {
                    sawDelta = true;
                    answer += delta;
                    sendProgress("streaming-answer", {
                      detail: "Composing the final answer.",
                    });
                    sseSend({ delta: delta });
                  }
                } else if (event.type === "assistant.message") {
                  var text = getQAEventText(event.data, false);
                  if (text) {
                    answer = text;
                    if (!sawDelta) {
                      sendProgress("streaming-answer", {
                        detail: "Composing the final answer.",
                      });
                      sseSend({ delta: text });
                    }
                  }
                }
              });
              sendProgress("waiting-for-model", {
                detail: payload.requestKind === "detail-fetch"
                  ? "Prompt sent. Fetching the exact tool output referenced in the draft answer."
                  : sessionFilePath
                    ? "Prompt sent. Raw session file access is available if the model needs exact output."
                    : "Prompt sent. Waiting for the first model response.",
                force: true,
              });
              session.send({ prompt: "[AGENTVIZ-QA] " + prompt.user }).catch(function (err) {
                if (!done) { done = true; unsubscribe(); reject(err); }
              });
            });

            await session.disconnect();
          } finally {
            stopProgressHeartbeat();
            await client.stop().catch(function () {});
          }

          // Extract turn references from the answer
          var references = [];
          var refRegex = /\[Turns?\s+[\d][\d\s,\-\u2013andTurn]*/gi;
          var refMatch;
          while ((refMatch = refRegex.exec(answer)) !== null) {
            var refClose = answer.indexOf("]", refMatch.index);
            if (refClose === -1) continue;
            var refBody = answer.substring(refMatch.index + 1, refClose);
            // Split on commas and "and", extract numbers and ranges
            var refSegments = refBody.split(/,|\band\b/);
            for (var si = 0; si < refSegments.length; si++) {
              var seg = refSegments[si].trim();
              var rangeMatch = seg.match(/(?:Turns?\s*)?(\d+)\s*[-\u2013]\s*(?:Turn\s*)?(\d+)/i);
              if (rangeMatch) {
                for (var ri = parseInt(rangeMatch[1], 10); ri <= parseInt(rangeMatch[2], 10); ri++) {
                  if (!references.some(function (r) { return r.turnIndex === ri; })) {
                    references.push({ turnIndex: ri });
                  }
                }
                continue;
              }
              var singleMatch = seg.match(/(?:Turns?\s*)?(\d+)/i);
              if (singleMatch) {
                var turnIdx = parseInt(singleMatch[1], 10);
                if (!references.some(function (r) { return r.turnIndex === turnIdx; })) {
                  references.push({ turnIndex: turnIdx });
                }
              }
            }
            refRegex.lastIndex = refClose + 1;
          }

          // Cache the model answer for paraphrase reuse on future similar questions
          if (programCacheKey && answer && resolvedSession.programCache) {
            resolvedSession.programCache[programCacheKey] = {
              fingerprint: precomputed ? precomputed.fingerprint : null,
              directAnswer: answer,
              references: references,
              model: requestedModel || "default",
              context: context || "",
            };
          }

          // Also cache by context hash for cross-phrasing reuse
          if (context && answer) {
            setCachedModelAnswer(
              precomputed ? precomputed.fingerprint : null,
              queryProgram ? queryProgram.family : "unknown",
              context,
              answer,
              references,
              requestedModel || "default"
            );
          }

          var modelLabel = requestedModel || "default";
          sseSend(buildQADonePayload(
            answer,
            references,
            modelLabel,
            returnedSessionId,
            qaRequestStartedAt,
            Date.now()
          ));
          if (!res.writableEnded) res.end();
        } catch (e) {
          stopProgressHeartbeat();
          sseSend({ error: e.message || "Q&A failed" });
          if (!res.writableEnded) res.end();
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

              // Filter out AI coach and Q&A subprocess sessions:
              // These are spawned by AGENTVIZ itself and should not appear in the inbox.
              if (summary && (
                summary.startsWith("Analyze this") ||
                (summary.includes("Session stats") && summary.includes("read_config")) ||
                summary.includes("SESSION DATA:") ||
                summary.includes("SESSION OVERVIEW") ||
                summary.includes("You are an AI assistant that answers questions about a coding session") ||
                summary.includes("[AGENTVIZ-QA]")
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
        path: sessionFile || null,
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
