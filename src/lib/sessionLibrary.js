import { buildAutonomyMetrics, getNeedsReviewScore, getSessionCost } from "./autonomyMetrics.js";

export var SESSION_LIBRARY_KEY = "agentviz:session-library:v1";
var SESSION_CONTENT_PREFIX = "agentviz:session-content:v1:";

function getStorage(storage) {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function safeParse(raw, fallback) {
  if (!raw) return fallback;

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn("Could not parse stored session library data", error);
    return fallback;
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

function truncateText(text, max) {
  if (!text) return "";
  return text.length > max ? text.substring(0, max) + "..." : text;
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

  return [
    metadata && metadata.format ? metadata.format : "session",
    metadata && metadata.repository ? metadata.repository : "",
    metadata && metadata.branch ? metadata.branch : "",
    fileName || "session.jsonl",
    hashText(rawText),
  ].join(":");
}

export function readSessionLibrary(storage) {
  var target = getStorage(storage);
  if (!target) return [];

  try {
    var parsed = safeParse(target.getItem(SESSION_LIBRARY_KEY), []);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Could not read session library", error);
    return [];
  }
}

function writeSessionLibrary(entries, storage) {
  var target = getStorage(storage);
  if (!target) return false;

  try {
    target.setItem(SESSION_LIBRARY_KEY, JSON.stringify(entries));
    return true;
  } catch (error) {
    console.warn("Could not persist session library", error);
    return false;
  }
}

function getSessionContentKey(id) {
  return SESSION_CONTENT_PREFIX + id;
}

function removeStoredSessionContent(id, storage) {
  var target = getStorage(storage);
  if (!target || !id) return;

  try {
    target.removeItem(getSessionContentKey(id));
  } catch (error) {
    console.warn("Could not remove stored session content", error);
  }
}

export function loadStoredSessionContent(id, storage) {
  var target = getStorage(storage);
  if (!target || !id) return "";

  try {
    return target.getItem(getSessionContentKey(id)) || "";
  } catch (error) {
    console.warn("Could not read stored session content", error);
    return "";
  }
}

function storeSessionContent(id, rawText, storage, existingEntries) {
  var target = getStorage(storage);
  if (!target || !id || !rawText) return false;

  try {
    target.setItem(getSessionContentKey(id), rawText);
    return true;
  } catch (error) {
    if (!(error && error.name === "QuotaExceededError")) {
      console.warn("Could not persist session content", error);
      return false;
    }
  }

  var evictableEntries = Array.isArray(existingEntries)
    ? existingEntries
      .filter(function (entry) { return entry && entry.id && entry.id !== id && entry.hasContent; })
      .sort(function (left, right) {
        return String(left.updatedAt || left.importedAt || "").localeCompare(String(right.updatedAt || right.importedAt || ""));
      })
    : [];

  for (var index = 0; index < evictableEntries.length; index += 1) {
    removeStoredSessionContent(evictableEntries[index].id, target);

    try {
      target.setItem(getSessionContentKey(id), rawText);
      return true;
    } catch (retryError) {
      if (!(retryError && retryError.name === "QuotaExceededError")) {
        console.warn("Could not persist session content", retryError);
        return false;
      }
    }
  }

  console.warn("Could not persist session content because storage quota was exceeded", { id: id });
  return false;
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
    totalCost: getSessionCost(metadata),
    premiumRequests: metadata.premiumRequests || null,
    warnings: metadata.warnings || [],
    autonomyMetrics: autonomyMetrics,
    reviewScore: getNeedsReviewScore({
      errorCount: metadata.errorCount || 0,
      autonomyMetrics: autonomyMetrics,
    }),
    importedAt: previousEntry ? previousEntry.importedAt : now,
    updatedAt: now,
    hasContent: Boolean(rawText),
  };
}

export function persistSessionSnapshot(fileName, result, rawText, storage) {
  var target = getStorage(storage);
  if (!target || !result) return { entries: [], entry: null };

  var existingEntries = readSessionLibrary(target);
  var existingIndex = -1;
  var provisionalId = createSessionStorageId(fileName, result.metadata || {}, rawText);

  for (var index = 0; index < existingEntries.length; index += 1) {
    if (existingEntries[index].id === provisionalId) {
      existingIndex = index;
      break;
    }
  }

  var previousEntry = existingIndex >= 0 ? existingEntries[existingIndex] : null;
  var entry = buildSessionLibraryEntry(fileName, result, rawText, previousEntry);
  entry.hasContent = storeSessionContent(entry.id, rawText, target, existingEntries);

  var nextEntries = existingEntries.slice();
  if (existingIndex >= 0) {
    nextEntries.splice(existingIndex, 1, entry);
  } else {
    nextEntries.push(entry);
  }

  nextEntries.sort(function (left, right) {
    return String(right.updatedAt).localeCompare(String(left.updatedAt));
  });

  writeSessionLibrary(nextEntries, target);

  return {
    entries: nextEntries,
    entry: entry,
  };
}
