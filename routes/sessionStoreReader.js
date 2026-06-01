/**
 * Session store reader -- enriches session discovery with metadata from
 * Copilot CLI's local SQLite databases.
 *
 * Reads:
 *   ~/.copilot/session-store.db  -- summary, repo, branch, host_type, turns
 *   ~/.copilot/data.db           -- model, reasoning_effort, custom title
 *
 * Gracefully returns empty results if databases do not exist.
 */

import path from "path";
import fs from "fs";

var _DatabaseSync = null;

function getDatabase() {
  if (_DatabaseSync !== null) return _DatabaseSync;
  try {
    _DatabaseSync = require("node:sqlite").DatabaseSync;
  } catch (e) {
    _DatabaseSync = false;
  }
  return _DatabaseSync;
}

function openDB(dbPath) {
  var DB = getDatabase();
  if (!DB) return null;
  try {
    if (!fs.existsSync(dbPath)) return null;
    return new DB(dbPath, { readOnly: true });
  } catch (e) {
    return null;
  }
}

function safeClose(db) {
  if (!db) return;
  try { db.close(); } catch (e) {}
}

/**
 * Read session metadata from session-store.db.
 * Returns a Map keyed by session ID.
 */
export function readSessionStoreMetadata(homeDir) {
  var result = new Map();
  var dbPath = path.join(homeDir, ".copilot", "session-store.db");
  var db = openDB(dbPath);
  if (!db) return result;

  try {
    var rows = db.prepare(
      "SELECT s.id, s.cwd, s.repository, s.branch, s.summary, s.host_type, s.created_at, s.updated_at, " +
      "(SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id) as turn_count " +
      "FROM sessions s ORDER BY s.updated_at DESC LIMIT 500"
    ).all();

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      result.set(row.id, {
        summary: row.summary || null,
        repository: row.repository || null,
        branch: row.branch || null,
        cwd: row.cwd || null,
        hostType: row.host_type || null,
        turnCount: row.turn_count || 0,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
      });
    }
  } catch (e) {
    // Database may have different schema version
  }

  safeClose(db);
  return result;
}

/**
 * Read session metadata from data.db (Copilot CLI app database).
 * Returns a Map keyed by session ID.
 */
export function readAppDbMetadata(homeDir) {
  var result = new Map();
  var dbPath = path.join(homeDir, ".copilot", "data.db");
  var db = openDB(dbPath);
  if (!db) return result;

  try {
    var rows = db.prepare(
      "SELECT id, title, model, reasoning_effort, session_type, mode FROM sessions ORDER BY updated_at DESC LIMIT 500"
    ).all();

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      result.set(row.id, {
        title: row.title || null,
        model: row.model || null,
        reasoningEffort: row.reasoning_effort || null,
        sessionType: row.session_type || null,
        mode: row.mode || null,
      });
    }
  } catch (e) {
    // Database may have different schema version
  }

  safeClose(db);
  return result;
}

/**
 * Merge store metadata into a list of session results (mutates in place).
 * Also returns store-only sessions (in store but not in results).
 */
export function enrichSessionResults(results, homeDir) {
  var storeData = readSessionStoreMetadata(homeDir);
  var appData = readAppDbMetadata(homeDir);

  if (storeData.size === 0 && appData.size === 0) return [];

  var seenIds = new Set();

  for (var i = 0; i < results.length; i++) {
    var entry = results[i];
    if (entry.format !== "copilot-cli" || !entry.sessionId) continue;

    seenIds.add(entry.sessionId);

    var store = storeData.get(entry.sessionId);
    if (store) {
      // Prefer store summary over workspace.yaml/first-message fallback
      if (store.summary && (!entry.summary || entry.summary.length < store.summary.length)) {
        entry.summary = store.summary;
        entry.project = store.summary;
      }
      if (store.repository && !entry.repository) entry.repository = store.repository;
      if (store.branch && !entry.branch) entry.branch = store.branch;
      if (store.hostType) entry.hostType = store.hostType;
      if (store.turnCount) entry.turnCount = store.turnCount;
    }

    var app = appData.get(entry.sessionId);
    if (app) {
      if (app.title) entry.customTitle = app.title;
      if (app.model) entry.model = app.model;
      if (app.reasoningEffort) entry.reasoningEffort = app.reasoningEffort;
      if (app.sessionType) entry.sessionType = app.sessionType;
      if (app.mode) entry.mode = app.mode;
    }
  }

  // Find store-only sessions (have events.jsonl but not in scan results)
  var extras = [];
  var copilotRoot = path.join(homeDir, ".copilot", "session-state");

  storeData.forEach(function (store, sessionId) {
    if (seenIds.has(sessionId)) return;

    var eventsFile = path.join(copilotRoot, sessionId, "events.jsonl");
    try {
      var stat = fs.statSync(eventsFile);
      var app = appData.get(sessionId) || {};
      extras.push({
        id: "copilot-cli:" + sessionId + ":events.jsonl",
        path: eventsFile,
        filename: "events.jsonl",
        file: store.summary || "events.jsonl",
        project: store.summary || sessionId.substring(0, 8),
        projectDir: sessionId,
        sessionId: sessionId,
        repository: store.repository || null,
        branch: store.branch || null,
        summary: store.summary || null,
        format: "copilot-cli",
        source: "store",
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        hostType: store.hostType || null,
        turnCount: store.turnCount || 0,
        model: app.model || null,
        reasoningEffort: app.reasoningEffort || null,
        customTitle: app.title || null,
      });
    } catch (e) {
      // events.jsonl doesn't exist -- skip
    }
  });

  return extras;
}
