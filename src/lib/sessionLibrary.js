import { buildAutonomyMetrics, getNeedsReviewScore, getSessionCost } from "./autonomyMetrics.js";
import { truncateText } from "./formatTime.js";

export var SESSION_LIBRARY_KEY = "agentviz:session-library:v1";
var SESSION_CONTENT_PREFIX = "agentviz:session-content:v1:";

var DEV = typeof import.meta !== "undefined" && import.meta.env && import.meta.env.DEV;

function debugWarn(message, detail) {
  if (DEV) console.warn(message, detail); // eslint-disable-line no-console
}

function getStorage(storage) {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function storageError(error, operation) {
  var kind = error && error.name === "QuotaExceededError" ? "quota"
    : error && error.name === "SyntaxError" ? "corrupt" : "access";
  return {
    kind: kind,
    operation: operation,
    message: kind === "quota" ? "Browser storage is full."
      : kind === "corrupt" ? "The saved session index is damaged. It has not been replaced."
      : "Browser storage could not be accessed.",
  };
}

function requireStorage(storage) {
  var target = getStorage(storage);
  if (!target) throw new Error("Browser storage is unavailable");
  return target;
}

function readIndex(target) {
  var raw = target.getItem(SESSION_LIBRARY_KEY);
  var entries = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(entries) || entries.some(function (entry) {
    return !entry || typeof entry.id !== "string" || !entry.id;
  })) throw new SyntaxError("Invalid session index");
  return entries;
}

export function readSessionLibraryState(storage, prune) {
  var entries = null;
  var operation = "read index";
  try {
    var target = requireStorage(storage);
    entries = readIndex(target);
    operation = "read content";
    var next = entries.map(function (entry) {
      return entry.hasContent && !target.getItem(getSessionContentKey(entry.id))
        ? Object.assign({}, entry, { hasContent: false }) : entry;
    });
    if (prune) next = next.filter(function (entry) { return entry.hasContent || entry.discoveredPath; });
    operation = "write index";
    if (JSON.stringify(next) !== JSON.stringify(entries)) {
      entries = next;
      target.setItem(SESSION_LIBRARY_KEY, JSON.stringify(next));
    }
    return { entries: next, error: null };
  } catch (error) {
    // A failed read cannot establish which cached copies still exist.
    if (entries && operation === "read content") {
      entries = entries.map(function (entry) { return Object.assign({}, entry, { hasContent: false }); });
    }
    return { entries: entries, error: storageError(error, operation) };
  }
}

function hashText(text) {
  var value = 0;
  var source = text || "";

  for (var index = 0; index < source.length; index += 1) {
    value = ((value << 5) - value + source.charCodeAt(index)) | 0;
  }

  return String(Math.abs(value));
}

function buildPrimaryPrompt(result) {
  if (result && result.turns) {
    for (var index = 0; index < result.turns.length; index += 1) {
      if (result.turns[index].userMessage) return result.turns[index].userMessage;
    }
  }

  if (result && result.events) {
    for (var eventIndex = 0; eventIndex < result.events.length; eventIndex += 1) {
      if (result.events[eventIndex].agent === "user" && result.events[eventIndex].text) {
        return result.events[eventIndex].text;
      }
    }
  }

  return "";
}

export function createSessionStorageId(fileName, metadata, rawText) {
  if (metadata && metadata.sessionId) {
    return (metadata.format || "session") + ":" + metadata.sessionId;
  }
  if (metadata && metadata.sourcePath) return (metadata.format || "session") + ":source:" + metadata.sourcePath;
  var firstRecord = (rawText || "").slice(0, 4096).split(/\r?\n/, 1)[0];
  var recordIdentity = null;
  try {
    var record = JSON.parse(firstRecord);
    recordIdentity = record.sessionId || record.uuid || null;
  } catch {}

  return [
    metadata && metadata.format ? metadata.format : "session",
    metadata && metadata.repository ? metadata.repository : "",
    metadata && metadata.branch ? metadata.branch : "",
    fileName || "session.jsonl",
    // Unknown formats retain a content hash rather than merging distinct
    // transcripts that happen to start with the same user message.
    recordIdentity || hashText(rawText),
  ].join(":");
}

export function readSessionLibrary(storage) {
  try {
    return readIndex(requireStorage(storage));
  } catch (error) {
    debugWarn("Could not read session library", error);
    return [];
  }
}

export function reconcileSessionLibrary(storage) {
  return readSessionLibraryState(storage).entries || [];
}

function getSessionContentKey(id) {
  return SESSION_CONTENT_PREFIX + id;
}

export function readStoredSessionContent(id, storage) {
  try {
    return { text: requireStorage(storage).getItem(getSessionContentKey(id)) || "", error: null };
  } catch (error) {
    return { text: "", error: storageError(error, "read content") };
  }
}

export function loadStoredSessionContent(id, storage) {
  return readStoredSessionContent(id, storage).text;
}

function storeSessionContent(id, rawText, target, existingEntries, evictedIds) {
  try {
    target.setItem(getSessionContentKey(id), rawText);
    return;
  } catch (error) {
    if (!(error && error.name === "QuotaExceededError")) throw error;
  }

  var evictableEntries = Array.isArray(existingEntries)
    ? existingEntries
      .filter(function (entry) { return entry && entry.id && entry.id !== id && entry.hasContent; })
      .sort(function (left, right) {
        return String(left.updatedAt || left.importedAt || "").localeCompare(String(right.updatedAt || right.importedAt || ""));
      })
    : [];

  for (var index = 0; index < evictableEntries.length; index += 1) {
    target.removeItem(getSessionContentKey(evictableEntries[index].id));
    evictedIds.push(evictableEntries[index].id);

    try {
      target.setItem(getSessionContentKey(id), rawText);
      return;
    } catch (retryError) {
      if (!(retryError && retryError.name === "QuotaExceededError")) {
        throw retryError;
      }
    }
  }

  var quotaError = new Error("Storage quota exceeded");
  quotaError.name = "QuotaExceededError";
  throw quotaError;
}

export function pruneDeadEntries(storage) {
  return readSessionLibraryState(storage, true).entries || [];
}

export function buildSessionLibraryEntry(fileName, result, rawText, previousEntry) {
  var metadata = result.metadata || {};
  var autonomyMetrics = buildAutonomyMetrics(result.events, result.turns, metadata);
  var id = createSessionStorageId(fileName, metadata, rawText);
  var now = new Date().toISOString();

  return {
    id: id,
    file: fileName,
    format: metadata.format || "claude-code",
    sessionId: metadata.sessionId || null,
    repository: metadata.repository || null,
    branch: metadata.branch || null,
    cwd: metadata.cwd || null,
    primaryModel: metadata.primaryModel || null,
    primaryPrompt: truncateText(buildPrimaryPrompt(result), 180),
    totalEvents: metadata.totalEvents || result.events.length,
    totalTurns: metadata.totalTurns || result.turns.length,
    totalToolCalls: metadata.totalToolCalls || 0,
    errorCount: metadata.errorCount || 0,
    duration: metadata.duration || 0,
    totalCost: getSessionCost(metadata, result.events),
    totalCostUnit: metadata.totalCostUnit || null,
    aiCredits: metadata.aiCredits != null ? metadata.aiCredits : null,
    warnings: metadata.warnings || [],
    autonomyMetrics: autonomyMetrics,
    reviewScore: getNeedsReviewScore({
      errorCount: metadata.errorCount || 0,
      autonomyMetrics: autonomyMetrics,
    }),
    discoveredPath: previousEntry ? (previousEntry.discoveredPath || null) : null,
    importedAt: previousEntry ? previousEntry.importedAt : now,
    updatedAt: now,
    hasContent: Boolean(rawText),
  };
}

export function persistSessionSnapshot(fileName, result, rawText, storage) {
  var id = createSessionStorageId(fileName, result.metadata || {}, rawText);
  var entries = null;
  var evictedIds = [];
  var operation = "read index";
  var wroteContent = false;
  var oldText = null;
  try {
    var target = requireStorage(storage);
    entries = readIndex(target);
    operation = "read content";
    // Finish all reads before changing content or evicting anything.
    entries = entries.map(function (entry) {
      return entry.hasContent && !target.getItem(getSessionContentKey(entry.id))
        ? Object.assign({}, entry, { hasContent: false }) : entry;
    });
    oldText = target.getItem(getSessionContentKey(id));
    var previousEntry = entries.find(function (entry) { return entry.id === id; });
    var entry = buildSessionLibraryEntry(fileName, result, rawText, previousEntry);
    if (!rawText) throw new Error("No transcript to save");
    operation = "write content";
    storeSessionContent(id, rawText, target, entries, evictedIds);
    wroteContent = true;
    var next = entries.filter(function (item) { return item.id !== id; }).map(function (item) {
      return evictedIds.includes(item.id) ? Object.assign({}, item, { hasContent: false }) : item;
    }).concat(entry);
    next.sort(function (left, right) { return String(right.updatedAt).localeCompare(String(left.updatedAt)); });
    operation = "write index";
    target.setItem(SESSION_LIBRARY_KEY, JSON.stringify(next));
    return { entries: next, entry: entry, id: id, saved: true, error: null, evictedIds: evictedIds };
  } catch (error) {
    var failure = storageError(error, operation);
    if (wroteContent) {
      try {
        if (oldText === null) target.removeItem(getSessionContentKey(id));
        else target.setItem(getSessionContentKey(id), oldText);
      } catch (rollbackError) {
        failure.rollbackError = storageError(rollbackError, "restore content");
      }
    }
    if (entries) entries = entries.map(function (item) {
      return evictedIds.includes(item.id) || operation === "read content" || (item.id === id && failure.rollbackError)
        ? Object.assign({}, item, { hasContent: false }) : item;
    });
    if (entries && (evictedIds.length || failure.rollbackError)) {
      try {
        target.setItem(SESSION_LIBRARY_KEY, JSON.stringify(entries));
      } catch (indexError) {
        failure.indexError = storageError(indexError, "write index");
      }
    }
    var previousSaved = Boolean(oldText && !failure.rollbackError && entries && entries.some(function (item) {
      return item.id === id && item.hasContent;
    }));
    return { entries: entries, entry: null, id: id, saved: false, previousSaved: previousSaved, error: failure, evictedIds: evictedIds };
  }
}
