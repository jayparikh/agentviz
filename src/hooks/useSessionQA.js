/**
 * Hook for managing Session Q&A conversations.
 *
 * Each analyzed session gets its own independent Q&A state. History is kept
 * in memory for fast tab switching, mirrored to localStorage as a fallback,
 * and persisted to the AGENTVIZ server so conversations survive app restarts
 * and port changes.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import usePersistentState from "./usePersistentState.js";
import { parseDetailRequests, buildDetailResponse } from "../lib/sessionQA.js";

var DEFAULT_MODEL = "gpt-5.4";
var STORAGE_KEY = "agentviz:qa-history";
var HISTORY_ENDPOINT = "/api/session-qa-history";
var CACHE_ENDPOINT = "/api/session-qa-cache";
var QA_SESSION_ROTATION_TURN_LIMIT_KEY = "agentviz:qa-session-turn-limit";
var DEFAULT_QA_SESSION_ROTATION_TURN_LIMIT = 6;
var MAX_QA_SESSION_RECAP_MESSAGES = 12;
var MAX_QA_SESSION_RECAP_MESSAGE_CHARS = 280;
var MAX_QA_SESSION_RECAP_CHARS = 3200;
var STATUS_PHASE_MAP = {
  "Building session index...": "precomputing-session",
  "Compiling query program...": "compiling-query-program",
  "Checking paraphrase-aware cache...": "checking-paraphrase-cache",
  "Querying SQLite fact store...": "querying-fact-store",
  "Launching fallback route...": "launching-fallback-route",
  "Canceling slower route...": "canceling-slower-route",
  "Using cached program answer...": "using-cached-program-answer",
  "Using precomputed metrics...": "using-precomputed-metrics",
  "Searching tool and query index...": "searching-index",
  "Searching session index...": "searching-index",
  "Scanning summary chunks...": "scanning-summary-chunks",
  "Reading targeted raw JSONL slices...": "reading-targeted-raw",
  "Reading full raw JSONL...": "reading-full-raw",
  "Preparing session context...": "preparing-context",
  "Retrieving session context...": "retrieving-context",
  "Resuming previous Q&A session...": "resuming-session",
  "Starting Q&A session...": "starting-session",
  "Waiting for model response...": "waiting-for-model",
  "Thinking through the session...": "thinking",
  "Streaming answer...": "streaming-answer",
  "Fetching detailed tool output...": "detail-fetch",
};

function sanitizeTiming(timing) {
  var totalMs = timing && timing.totalMs;
  var numericTotalMs = typeof totalMs === "number" ? totalMs : Number(totalMs);
  if (!Number.isFinite(numericTotalMs) || numericTotalMs < 0) return null;
  return { totalMs: Math.round(numericTotalMs) };
}

function sanitizeElapsedMs(value) {
  var numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return null;
  return Math.round(numericValue);
}

function normalizeProgressDetail(value) {
  if (typeof value !== "string") return null;
  var trimmed = value.trim();
  return trimmed || null;
}

function inferProgressPhase(status) {
  return status ? (STATUS_PHASE_MAP[status] || null) : null;
}

function createLoadingProgress(label, options) {
  var safeLabel = typeof label === "string" && label ? label : "Working on your question...";
  var opts = options && typeof options === "object" ? options : {};
  return {
    label: safeLabel,
    phase: opts.phase || inferProgressPhase(safeLabel) || null,
    detail: normalizeProgressDetail(opts.detail),
    elapsedMs: sanitizeElapsedMs(opts.elapsedMs),
  };
}

function setLoadingProgress(session, progress, startedAtMs) {
  session.loadingProgress = progress || null;
  session.loadingLabel = progress ? progress.label : null;
  if (!progress) {
    session.loadingStartedAtMs = 0;
    return;
  }
  if (startedAtMs !== undefined) {
    var safeStartedAt = sanitizeElapsedMs(startedAtMs);
    session.loadingStartedAtMs = safeStartedAt === null ? Date.now() : safeStartedAt;
    return;
  }
  if (!session.loadingStartedAtMs) session.loadingStartedAtMs = Date.now();
}

function updateLoadingProgress(session, payload, startedAtMs) {
  if (!session || !payload || typeof payload !== "object") return;
  var previous = session.loadingProgress;
  var nextLabel = typeof payload.status === "string" && payload.status
    ? payload.status
    : (previous && previous.label) || session.loadingLabel || "Working on your question...";
  var nextPhase = payload.phase || inferProgressPhase(nextLabel) || (previous && previous.phase) || null;
  var hasExplicitDetail = Object.prototype.hasOwnProperty.call(payload, "detail");
  var nextDetail = hasExplicitDetail
    ? normalizeProgressDetail(payload.detail)
    : (nextLabel !== ((previous && previous.label) || null) || nextPhase !== ((previous && previous.phase) || null)
      ? null
      : (previous && previous.detail) || null);
  var nextElapsedMs = Object.prototype.hasOwnProperty.call(payload, "elapsedMs")
    ? sanitizeElapsedMs(payload.elapsedMs)
    : (previous && previous.elapsedMs != null ? previous.elapsedMs : null);
  setLoadingProgress(session, createLoadingProgress(nextLabel, {
    phase: nextPhase,
    detail: nextDetail,
    elapsedMs: nextElapsedMs,
  }), startedAtMs);
}

function clearLoadingProgress(session) {
  setLoadingProgress(session, null);
}

function hasProgressUpdate(data) {
  if (!data || typeof data !== "object") return false;
  return Boolean(
    data.status ||
    data.phase ||
    Object.prototype.hasOwnProperty.call(data, "detail") ||
    Object.prototype.hasOwnProperty.call(data, "elapsedMs")
  );
}

function mergeTiming(existingTiming, nextTiming) {
  var base = sanitizeTiming(existingTiming);
  var incoming = sanitizeTiming(nextTiming);
  if (!base) return incoming;
  if (!incoming) return base;
  return { totalMs: base.totalMs + incoming.totalMs };
}

function createAssistantMessage(content, references, timing) {
  var message = {
    role: "assistant",
    content: typeof content === "string" ? content : "",
    references: Array.isArray(references) ? references : [],
  };
  var safeTiming = sanitizeTiming(timing);
  if (safeTiming) message.timing = safeTiming;
  return message;
}

function createUserMessage(content, options) {
  var message = {
    role: "user",
    content: typeof content === "string" ? content : "",
  };
  if (options && options.queued) message.queued = true;
  if (options && options.messageId) message.messageId = options.messageId;
  return message;
}

function sanitizeMessages(messages) {
  return Array.isArray(messages) ? messages
    .filter(function (message) {
      return message && typeof message.role === "string" &&
        typeof message.content === "string" &&
        (message.content || message.role !== "assistant");
    })
    .map(function (message) {
      var nextMessage = {
        role: message.role,
        content: message.content,
      };
      if (Array.isArray(message.references) && message.references.length > 0) {
        nextMessage.references = message.references;
      }
      var timing = sanitizeTiming(message.timing);
      if (timing) nextMessage.timing = timing;
      return nextMessage;
    }) : [];
}

function sanitizeTurnBaseline(value) {
  var numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return 0;
  return Math.floor(numericValue);
}

function getQASessionRotationTurnLimit() {
  try {
    var raw = localStorage.getItem(QA_SESSION_ROTATION_TURN_LIMIT_KEY);
    if (raw === null || raw === "") return DEFAULT_QA_SESSION_ROTATION_TURN_LIMIT;
    var numericValue = Number(raw);
    if (!Number.isFinite(numericValue)) return DEFAULT_QA_SESSION_ROTATION_TURN_LIMIT;
    if (numericValue <= 0) return 0;
    return Math.floor(numericValue);
  } catch (e) {
    return DEFAULT_QA_SESSION_ROTATION_TURN_LIMIT;
  }
}

function countVisibleQuestionTurns(messages) {
  return Array.isArray(messages) ? messages.reduce(function (count, message) {
    return count + (message && message.role === "user" && typeof message.content === "string" && message.content ? 1 : 0);
  }, 0) : 0;
}

function truncateRecapText(content, maxChars) {
  var normalized = typeof content === "string" ? content.replace(/\s+/g, " ").trim() : "";
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, Math.max(0, maxChars - 3)).trim() + "...";
}

function buildVisibleQARecap(messages) {
  var summarizedMessages = sanitizeMessages(messages).filter(function (message) {
    return message.role === "user" || message.role === "assistant";
  });
  if (summarizedMessages.length === 0) return "";

  var omittedCount = 0;
  if (summarizedMessages.length > MAX_QA_SESSION_RECAP_MESSAGES) {
    omittedCount = summarizedMessages.length - MAX_QA_SESSION_RECAP_MESSAGES;
    summarizedMessages = summarizedMessages.slice(-MAX_QA_SESSION_RECAP_MESSAGES);
  }

  var turnNumber = 0;
  var lines = summarizedMessages.map(function (message) {
    var recapText = truncateRecapText(message.content, MAX_QA_SESSION_RECAP_MESSAGE_CHARS);
    if (!recapText) return "";
    if (message.role === "user") {
      turnNumber += 1;
      return "Q" + turnNumber + " user: " + recapText;
    }
    return "A" + (turnNumber > 0 ? turnNumber : 1) + " assistant: " + recapText;
  }).filter(Boolean);

  while (lines.length > 1 && lines.join("\n").length > MAX_QA_SESSION_RECAP_CHARS) {
    lines.shift();
    omittedCount += 1;
  }

  if (omittedCount > 0) {
    lines.unshift("Earlier visible Q&A omitted for brevity: " + omittedCount + " message" + (omittedCount === 1 ? "" : "s") + ".");
  }

  return lines.join("\n");
}

function buildFreshSessionQuestion(question, priorMessages) {
  var recap = buildVisibleQARecap(priorMessages);
  if (!recap) return question;
  return [
    "AGENTVIZ Q&A recap from earlier visible chat:",
    recap,
    "",
    "Use that recap as context for this fresh Q&A session.",
    "",
    "Current question:",
    question,
  ].join("\n");
}

function shouldRotateQASession(session, priorMessages) {
  if (!session || !session.qaSessionId) return false;
  var turnLimit = getQASessionRotationTurnLimit();
  if (turnLimit <= 0) return false;
  return countVisibleQuestionTurns(priorMessages) - sanitizeTurnBaseline(session.qaSessionTurnBaseline) >= turnLimit;
}

function findMessageIndex(messages, messageId) {
  if (!Array.isArray(messages) || !messageId) return -1;
  for (var i = 0; i < messages.length; i++) {
    if (messages[i] && messages[i].messageId === messageId) return i;
  }
  return -1;
}

function activateQueuedUserMessage(messages, question, messageId) {
  var matched = false;
  return Array.isArray(messages) ? messages.map(function (message) {
    if (matched || !message) return message;
    if (messageId && message.messageId === messageId) {
      matched = true;
      return createUserMessage(question, { messageId: messageId });
    }
    if (message.queued && message.content === question) {
      matched = true;
      return createUserMessage(question, { messageId: message.messageId || messageId || undefined });
    }
    return message;
  }) : [];
}

function serializeSessionState(session) {
  return {
    messages: sanitizeMessages(session && session.messages),
    responseModel: session && session.responseModel ? session.responseModel : null,
    qaSessionId: session && session.qaSessionId ? session.qaSessionId : null,
    qaSessionTurnBaseline: sanitizeTurnBaseline(session && session.qaSessionTurnBaseline),
  };
}

function hasSessionCachePayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (Array.isArray(payload.events) && payload.events.length > 0) return true;
  if (Array.isArray(payload.turns) && payload.turns.length > 0) return true;
  if (payload.sessionFilePath) return true;
  if (typeof payload.rawText === "string" && payload.rawText) return true;
  return Boolean(payload.metadata && typeof payload.metadata === "object" && Object.keys(payload.metadata).length > 0);
}

function hashText(text) {
  var value = 0;
  var source = text || "";

  for (var index = 0; index < source.length; index += 1) {
    value = ((value << 5) - value + source.charCodeAt(index)) | 0;
  }

  return String(Math.abs(value));
}

function buildSessionCacheFingerprint(payload) {
  if (!payload || typeof payload !== "object") return "";
  var events = Array.isArray(payload.events) ? payload.events : [];
  var turns = Array.isArray(payload.turns) ? payload.turns : [];
  var metadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
  var lastEvent = events.length > 0 ? events[events.length - 1] : null;
  var rawText = typeof payload.rawText === "string" ? payload.rawText : "";
  return [
    events.length,
    lastEvent && lastEvent.t != null ? lastEvent.t : "",
    lastEvent && lastEvent.track ? lastEvent.track : "",
    lastEvent && lastEvent.agent ? lastEvent.agent : "",
    turns.length,
    metadata.totalEvents != null ? metadata.totalEvents : "",
    metadata.totalTurns != null ? metadata.totalTurns : "",
    metadata.totalToolCalls != null ? metadata.totalToolCalls : "",
    metadata.errorCount != null ? metadata.errorCount : "",
    metadata.duration != null ? metadata.duration : "",
    payload.sessionFilePath || "",
    rawText ? [rawText.length, hashText(rawText)].join(":") : "",
  ].join("|");
}

function buildQARequestBody(question, model, qaSessionId, key, fallbackPayload, useLeanPayload, requestKind) {
  var body = {
    question: question,
    model: model,
  };
  if (key) body.sessionKey = key;
  if (qaSessionId) body.qaSessionId = qaSessionId;
  if (requestKind) body.requestKind = requestKind;
  if (!useLeanPayload) {
    body.events = fallbackPayload.events;
    body.turns = fallbackPayload.turns;
    body.metadata = fallbackPayload.metadata;
    if (fallbackPayload.sessionFilePath) {
      body.sessionFilePath = fallbackPayload.sessionFilePath;
    } else if (typeof fallbackPayload.rawText === "string") {
      body.rawText = fallbackPayload.rawText;
    }
  }
  return body;
}

function freshState() {
  return {
    messages: [],
    loading: false,
    loadingLabel: null,
    loadingProgress: null,
    loadingStartedAtMs: 0,
    error: null,
    responseModel: null,
    qaSessionId: null,
    qaSessionTurnBaseline: 0,
    abort: null,
    activeAssistantIndex: null,
    activeRequestToken: 0,
    requestCounter: 0,
    hydrated: false,
    hydrating: false,
    hydrationToken: 0,
  };
}

function loadPersistedHistory() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

function savePersistedHistory(map) {
  try {
    var serializable = {};
    for (var key in map) {
      var serialized = serializeSessionState(map[key]);
      if (serialized.messages.length > 0 || serialized.qaSessionId) {
        serializable[key] = serialized;
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  } catch (e) {}
}

export default function useSessionQA() {
  var [selectedModel, setSelectedModel] = usePersistentState("agentviz:qa-model", DEFAULT_MODEL);
  var [sessionKey, setSessionKey] = useState(null);
  var sessionsRef = useRef(null);
  var queueRef = useRef({});
  var cacheStateRef = useRef({});
  var cacheSyncRef = useRef({});
  var [renderTick, setRenderTick] = useState(0);
  var messageIdRef = useRef(0);
  function tick() { setRenderTick(function (n) { return n + 1; }); }
  var nextMessageId = useCallback(function () {
    messageIdRef.current += 1;
    return "qa-message-" + messageIdRef.current;
  }, []);

  if (sessionsRef.current === null) {
    var persisted = loadPersistedHistory();
    var restored = {};
    for (var key in persisted) {
      restored[key] = Object.assign(freshState(), {
        messages: sanitizeMessages(persisted[key].messages),
        responseModel: persisted[key].responseModel || null,
        qaSessionId: persisted[key].qaSessionId || null,
        qaSessionTurnBaseline: sanitizeTurnBaseline(persisted[key].qaSessionTurnBaseline),
      });
    }
    sessionsRef.current = restored;
  }

  function getSession(key) {
    if (!key) return freshState();
    if (!sessionsRef.current[key]) sessionsRef.current[key] = freshState();
    return sessionsRef.current[key];
  }

  function persist() {
    savePersistedHistory(sessionsRef.current);
  }

  function persistServerHistory(key) {
    if (!key) return;
    var serialized = serializeSessionState(getSession(key));
    if (serialized.messages.length === 0 && !serialized.qaSessionId) return;
    fetch(HISTORY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey: key, history: serialized }),
    }).catch(function () {});
  }

  function deleteServerHistory(key) {
    if (!key) return;
    fetch(HISTORY_ENDPOINT + "?sessionKey=" + encodeURIComponent(key), {
      method: "DELETE",
    }).catch(function () {});
  }

  function markSessionCacheReady(key, fingerprint) {
    if (!key || !fingerprint) return;
    cacheStateRef.current[key] = {
      fingerprint: fingerprint,
      pendingFingerprint: null,
      pendingPromise: null,
    };
  }

  function hasRegisteredSessionCache(key, fingerprint) {
    if (!key || !fingerprint) return false;
    var cacheState = cacheStateRef.current[key];
    return Boolean(cacheState && cacheState.fingerprint === fingerprint);
  }

  var registerSessionCache = useCallback(function (key, payload) {
    if (!key || !hasSessionCachePayload(payload)) return Promise.resolve(false);
    var fingerprint = buildSessionCacheFingerprint(payload);
    if (!fingerprint) return Promise.resolve(false);
    var cacheState = cacheStateRef.current[key];
    if (cacheState && cacheState.fingerprint === fingerprint) return Promise.resolve(true);
    if (cacheState && cacheState.pendingFingerprint === fingerprint && cacheState.pendingPromise) {
      return cacheState.pendingPromise;
    }

    var cacheBody = {
      sessionKey: key,
      events: payload.events,
      turns: payload.turns,
      metadata: payload.metadata,
    };
    if (payload.sessionFilePath) {
      cacheBody.sessionFilePath = payload.sessionFilePath;
    } else if (typeof payload.rawText === "string") {
      cacheBody.rawText = payload.rawText;
    }

    var request = fetch(CACHE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cacheBody),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("Server error: " + res.status);
        markSessionCacheReady(key, fingerprint);
        return true;
      })
      .catch(function () {
        var nextState = cacheStateRef.current[key] || {};
        if (nextState.pendingFingerprint === fingerprint) {
          nextState.pendingFingerprint = null;
          nextState.pendingPromise = null;
        }
        cacheStateRef.current[key] = nextState;
        return false;
      });

    cacheStateRef.current[key] = {
      fingerprint: cacheState && cacheState.fingerprint ? cacheState.fingerprint : null,
      pendingFingerprint: fingerprint,
      pendingPromise: request,
    };
    return request;
  }, []);

  var scheduleSessionCacheRegistration = useCallback(function (key, payload) {
    if (!key || !hasSessionCachePayload(payload)) return;
    var fingerprint = buildSessionCacheFingerprint(payload);
    if (!fingerprint || hasRegisteredSessionCache(key, fingerprint)) return;
    var syncState = cacheSyncRef.current[key] || {
      timeoutId: null,
      nextPayload: null,
      lastSentAt: 0,
    };
    syncState.nextPayload = payload;
    syncState.nextFingerprint = fingerprint;

    if (syncState.timeoutId) {
      cacheSyncRef.current[key] = syncState;
      return;
    }

    var now = Date.now();
    var delay = Math.max(0, 1000 - (now - syncState.lastSentAt));
    syncState.timeoutId = setTimeout(function () {
      var currentSyncState = cacheSyncRef.current[key];
      if (!currentSyncState) return;
      currentSyncState.timeoutId = null;
      currentSyncState.lastSentAt = Date.now();
      cacheSyncRef.current[key] = currentSyncState;
      registerSessionCache(key, currentSyncState.nextPayload);
    }, delay);
    cacheSyncRef.current[key] = syncState;
  }, [registerSessionCache]);

  useEffect(function () {
    return function () {
      var syncMap = cacheSyncRef.current;
      for (var key in syncMap) {
        if (syncMap[key] && syncMap[key].timeoutId) {
          clearTimeout(syncMap[key].timeoutId);
        }
      }
      cacheSyncRef.current = {};
    };
  }, []);

  function hydrateSession(key, aliases) {
    if (!key) return;

    var sess = getSession(key);
    if (sess.hydrated || sess.hydrating) return;

    sess.hydrating = true;
    sess.hydrationToken += 1;
    var hydrationToken = sess.hydrationToken;
    var safeAliases = Array.isArray(aliases) ? aliases : [];

    for (var i = 0; i < safeAliases.length; i++) {
      var alias = safeAliases[i];
      if (!alias || alias === key) continue;
      var aliasSession = sessionsRef.current[alias];
      if (!aliasSession || (!aliasSession.messages.length && !aliasSession.qaSessionId)) continue;

      sessionsRef.current[key] = Object.assign(freshState(), serializeSessionState(aliasSession), {
        hydrated: true,
      });
      delete sessionsRef.current[alias];
      persist();
      persistServerHistory(key);
      tick();
      return;
    }

    if (sess.messages.length > 0 || sess.qaSessionId) {
      sess.hydrated = true;
      sess.hydrating = false;
      persist();
      persistServerHistory(key);
      tick();
      return;
    }

    fetch(HISTORY_ENDPOINT + "?sessionKey=" + encodeURIComponent(key))
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (payload) {
        var target = getSession(key);
        if (target.hydrationToken !== hydrationToken) return;
        target.hydrating = false;
        target.hydrated = true;

        if (target.messages.length === 0 && !target.qaSessionId && payload && payload.history) {
          target.messages = sanitizeMessages(payload.history.messages);
          target.responseModel = payload.history.responseModel || null;
          target.qaSessionId = payload.history.qaSessionId || null;
          target.qaSessionTurnBaseline = sanitizeTurnBaseline(payload.history.qaSessionTurnBaseline);
          persist();
        }

        tick();
      })
      .catch(function () {
        var target = getSession(key);
        if (target.hydrationToken !== hydrationToken) return;
        target.hydrating = false;
        target.hydrated = true;
        tick();
      });
  }

  function removeEmptyAssistantMessage(session) {
    if (typeof session.activeAssistantIndex !== "number") return;
    var index = session.activeAssistantIndex;
    var message = session.messages[index];
    if (message && message.role === "assistant" && !message.content) {
      session.messages = session.messages.filter(function (_, messageIndex) {
        return messageIndex !== index;
      });
    }
  }

  function isActiveRequest(key, requestToken) {
    return getSession(key).activeRequestToken === requestToken;
  }

  var current = getSession(sessionKey);

  function processQueue(key) {
    var sess = getSession(key);
    var queue = queueRef.current[key];
    if (!queue || queue.length === 0) return;
    if (sess.loading) return;

    var entry = queue.shift();
    var queuedMessageIndex = findMessageIndex(sess.messages, entry.messageId);
    var priorMessages = queuedMessageIndex >= 0
      ? sess.messages.slice(0, queuedMessageIndex)
      : sess.messages.slice();
    var priorVisibleTurnCount = countVisibleQuestionTurns(priorMessages);
    var rotateSession = shouldRotateQASession(sess, priorMessages);
    var shouldUseFreshSession = !sess.qaSessionId || rotateSession;
    var requestQuestion = shouldUseFreshSession
      ? buildFreshSessionQuestion(entry.question, priorMessages)
      : entry.question;
    var requestQaSessionId = rotateSession ? null : sess.qaSessionId;
    var requestTurnBaseline = shouldUseFreshSession
      ? priorVisibleTurnCount
      : sanitizeTurnBaseline(sess.qaSessionTurnBaseline);

    sess.messages = activateQueuedUserMessage(sess.messages, entry.question, entry.messageId);
    sess.loading = true;
    setLoadingProgress(sess, createLoadingProgress("Building session index...", {
      phase: "precomputing-session",
      detail: "Preparing metrics, indexes, and summary chunks before routing the question.",
      elapsedMs: 0,
    }), Date.now());
    sess.error = null;
    sess.requestCounter += 1;
    var requestToken = sess.requestCounter;
    sess.activeRequestToken = requestToken;
    sess.activeAssistantIndex = null;
    tick();

    var controller = new AbortController();
    sess.abort = controller;
    var accumulatedTiming = null;
    function requestQAStream(questionText, useLeanPayload, overrideQaSessionId, requestKind) {
      var effectiveQaSessionId = overrideQaSessionId === undefined ? requestQaSessionId : overrideQaSessionId;
      var requestBody = buildQARequestBody(
        questionText,
        entry.model,
        effectiveQaSessionId,
        key,
        entry.fallbackPayload,
        useLeanPayload,
        requestKind
      );
      return fetch("/api/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }).then(function (res) {
        if (res.ok || !useLeanPayload || !hasSessionCachePayload(entry.fallbackPayload)) {
          return {
            res: res,
            cacheReady: Boolean(res && res.ok && key && entry.registrationFingerprint),
          };
        }
        var fallbackBody = buildQARequestBody(
          questionText,
          entry.model,
          effectiveQaSessionId,
          key,
          entry.fallbackPayload,
          false,
          requestKind
        );
        return fetch("/api/qa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fallbackBody),
          signal: controller.signal,
        }).then(function (retryRes) {
          return {
            res: retryRes,
            cacheReady: Boolean(retryRes && retryRes.ok && key && entry.registrationFingerprint),
          };
        });
      });
    }

    Promise.resolve(entry.registrationPromise)
      .then(function (registered) {
        if (!isActiveRequest(key, requestToken)) return null;
        return requestQAStream(requestQuestion, Boolean(key && registered));
      })
      .then(function (requestResult) {
        if (!isActiveRequest(key, requestToken)) return null;
        if (!requestResult || !requestResult.res) return null;
        var res = requestResult.res;
        if (!res.ok) throw new Error("Server error: " + res.status);
        if (requestResult.cacheReady) {
          markSessionCacheReady(key, entry.registrationFingerprint);
        }

        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = "";
        var streamedText = "";

        var target = getSession(key);
        if (!isActiveRequest(key, requestToken)) return null;
        var msgIndex = target.messages.length;
        target.activeAssistantIndex = msgIndex;
        target.messages = target.messages.concat([createAssistantMessage("", [], null)]);
        tick();

        function readDetailResponse(detailQuestion, msgIndexValue) {
          return requestQAStream(
            detailQuestion,
            hasRegisteredSessionCache(key, entry.registrationFingerprint),
            getSession(key).qaSessionId || requestQaSessionId || null,
            "detail-fetch"
          ).then(function (detailResult) {
            if (!isActiveRequest(key, requestToken)) return;
            if (!detailResult || !detailResult.res) return;
            var res2 = detailResult.res;
            if (!res2.ok) throw new Error("Server error: " + res2.status);
            if (detailResult.cacheReady) {
              markSessionCacheReady(key, entry.registrationFingerprint);
            }

            var reader2 = res2.body.getReader();
            var buf2 = "";
            var text2 = "";

            function readDetailChunk() {
              return reader2.read().then(function (result2) {
                if (!isActiveRequest(key, requestToken)) return;
                if (result2.done) return;
                buf2 += decoder.decode(result2.value, { stream: true });
                var lines2 = buf2.split("\n");
                buf2 = lines2.pop() || "";

                for (var j = 0; j < lines2.length; j++) {
                  if (!lines2[j].startsWith("data: ")) continue;
                  var detailData;
                  try { detailData = JSON.parse(lines2[j].substring(6)); } catch (e) { continue; }
                  var detailTarget = getSession(key);
                  if (!isActiveRequest(key, requestToken)) return;

                  if (hasProgressUpdate(detailData)) {
                    updateLoadingProgress(detailTarget, detailData);
                    tick();
                  }
                  if (detailData.delta) {
                    text2 += detailData.delta;
                    var detailDeltaProgress = {
                      status: "Streaming answer...",
                      phase: detailData.phase || "streaming-answer",
                    };
                    if (Object.prototype.hasOwnProperty.call(detailData, "detail")) {
                      detailDeltaProgress.detail = detailData.detail;
                    }
                    if (Object.prototype.hasOwnProperty.call(detailData, "elapsedMs")) {
                      detailDeltaProgress.elapsedMs = detailData.elapsedMs;
                    }
                    updateLoadingProgress(detailTarget, detailDeltaProgress);
                    var update = detailTarget.messages.slice();
                    update[msgIndexValue] = createAssistantMessage(text2, [], null);
                    detailTarget.messages = update;
                    tick();
                  }
                  if (detailData.done) {
                    accumulatedTiming = mergeTiming(accumulatedTiming, detailData.timing);
                    var finalUpdate = detailTarget.messages.slice();
                    finalUpdate[msgIndexValue] = createAssistantMessage(
                      detailData.answer || text2,
                      detailData.references || [],
                      accumulatedTiming
                    );
                    detailTarget.messages = finalUpdate;
                    if (detailData.model) detailTarget.responseModel = detailData.model;
                    if (detailData.qaSessionId) detailTarget.qaSessionId = detailData.qaSessionId;
                    detailTarget.qaSessionTurnBaseline = requestTurnBaseline;
                    detailTarget.loading = false;
                    clearLoadingProgress(detailTarget);
                    detailTarget.abort = null;
                    detailTarget.activeAssistantIndex = null;
                    detailTarget.activeRequestToken = 0;
                    persist();
                    persistServerHistory(key);
                    tick();
                    processQueue(key);
                  }
                  if (detailData.error) {
                    detailTarget.error = detailData.error;
                    detailTarget.loading = false;
                    clearLoadingProgress(detailTarget);
                    detailTarget.abort = null;
                    detailTarget.activeAssistantIndex = null;
                    detailTarget.activeRequestToken = 0;
                    tick();
                    processQueue(key);
                  }
                }

                return readDetailChunk();
              });
            }

            return readDetailChunk();
          });
        }

        function readChunk() {
          return reader.read().then(function (result) {
            if (!isActiveRequest(key, requestToken)) return;
            if (result.done) return;
            buffer += decoder.decode(result.value, { stream: true });

            var lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (var li = 0; li < lines.length; li++) {
              var line = lines[li];
              if (!line.startsWith("data: ")) continue;
              var data;
              try { data = JSON.parse(line.substring(6)); } catch (e) { continue; }

              var tgt = getSession(key);
              if (!isActiveRequest(key, requestToken)) return;

              if (hasProgressUpdate(data)) {
                updateLoadingProgress(tgt, data);
                tick();
              }

              if (data.delta) {
                streamedText += data.delta;
                var deltaProgress = {
                  status: "Streaming answer...",
                  phase: data.phase || "streaming-answer",
                };
                if (Object.prototype.hasOwnProperty.call(data, "detail")) {
                  deltaProgress.detail = data.detail;
                }
                if (Object.prototype.hasOwnProperty.call(data, "elapsedMs")) {
                  deltaProgress.elapsedMs = data.elapsedMs;
                }
                updateLoadingProgress(tgt, deltaProgress);
                var updated = tgt.messages.slice();
                updated[msgIndex] = createAssistantMessage(streamedText, [], null);
                tgt.messages = updated;
                tick();
              }

              if (data.done) {
                accumulatedTiming = mergeTiming(accumulatedTiming, data.timing);
                var finalAnswer = data.answer || streamedText;
                if (data.model) tgt.responseModel = data.model;
                if (data.qaSessionId) tgt.qaSessionId = data.qaSessionId;
                var detailReqs = parseDetailRequests(finalAnswer);
                if (detailReqs.length > 0) {
                  var detailUpdate = tgt.messages.slice();
                  detailUpdate[msgIndex] = createAssistantMessage("Fetching detailed tool output...", [], null);
                  tgt.messages = detailUpdate;
                  updateLoadingProgress(tgt, {
                    status: "Fetching detailed tool output...",
                    phase: "detail-fetch",
                    detail: "Pulling the exact tool output referenced in the draft answer.",
                  });
                  tick();

                  var detailText = buildDetailResponse(detailReqs, entry.fallbackPayload.events);
                  return readDetailResponse(detailText, msgIndex);
                }

                var refs = data.references || [];
                var finalMessages = tgt.messages.slice();
                finalMessages[msgIndex] = createAssistantMessage(finalAnswer, refs, accumulatedTiming);
                tgt.messages = finalMessages;
                tgt.qaSessionTurnBaseline = requestTurnBaseline;
                tgt.loading = false;
                clearLoadingProgress(tgt);
                tgt.abort = null;
                tgt.activeAssistantIndex = null;
                tgt.activeRequestToken = 0;
                persist();
                persistServerHistory(key);
                tick();
                processQueue(key);
              }

              if (data.error) {
                tgt.error = data.error;
                tgt.loading = false;
                clearLoadingProgress(tgt);
                tgt.abort = null;
                tgt.activeAssistantIndex = null;
                tgt.activeRequestToken = 0;
                tick();
                processQueue(key);
              }
            }

            return readChunk();
          });
        }

        return readChunk();
      })
      .catch(function (err) {
        if (!isActiveRequest(key, requestToken)) return;
        if (err && err.name === "AbortError") return;
        var target = getSession(key);
        target.error = err && err.message ? err.message : "Failed to get answer";
        target.loading = false;
        clearLoadingProgress(target);
        target.abort = null;
        target.activeAssistantIndex = null;
        target.activeRequestToken = 0;
        tick();
        processQueue(key);
      });
  }

  var askQuestion = useCallback(function (question, events, turns, metadata, model, sessionFilePath, rawText) {
    if (!sessionKey || !question.trim()) return;
    var sess = getSession(sessionKey);
    var isQueued = sess.loading;
    var messageId = nextMessageId();
    var fallbackPayload = {
      events: events,
      turns: turns,
      metadata: metadata,
      sessionFilePath: sessionFilePath,
      rawText: rawText || null,
    };
    var registrationFingerprint = buildSessionCacheFingerprint(fallbackPayload);
    var registrationPromise = registerSessionCache(sessionKey, fallbackPayload);
    sess.messages = sess.messages.concat([createUserMessage(question, { queued: isQueued || undefined, messageId: messageId })]);
    persist();
    persistServerHistory(sessionKey);
    tick();

    if (!queueRef.current[sessionKey]) queueRef.current[sessionKey] = [];
    queueRef.current[sessionKey].push({
      question: question,
      messageId: messageId,
      model: model,
      fallbackPayload: fallbackPayload,
      registrationFingerprint: registrationFingerprint,
      registrationPromise: registrationPromise,
    });

    if (!isQueued) processQueue(sessionKey);
  }, [nextMessageId, registerSessionCache, sessionKey]);

  var stopAnswer = useCallback(function () {
    if (!sessionKey) return;
    var sess = getSession(sessionKey);
    if (!sess.loading) return;
    var controller = sess.abort;

    removeEmptyAssistantMessage(sess);
    sess.loading = false;
    clearLoadingProgress(sess);
    sess.error = null;
    sess.abort = null;
    sess.activeAssistantIndex = null;
    sess.activeRequestToken = 0;

    persist();
    persistServerHistory(sessionKey);
    tick();

    if (controller) controller.abort();
    processQueue(sessionKey);
  }, [sessionKey]);

  var clearHistory = useCallback(function () {
    if (!sessionKey) return;
    var sess = getSession(sessionKey);
    if (sess.abort) sess.abort.abort();
    queueRef.current[sessionKey] = [];
    if (cacheSyncRef.current[sessionKey] && cacheSyncRef.current[sessionKey].timeoutId) {
      clearTimeout(cacheSyncRef.current[sessionKey].timeoutId);
    }
    delete cacheSyncRef.current[sessionKey];
    delete cacheStateRef.current[sessionKey];
    sessionsRef.current[sessionKey] = Object.assign(freshState(), { hydrated: true });
    persist();
    deleteServerHistory(sessionKey);
    tick();
  }, [sessionKey]);

  var switchSession = useCallback(function (newSessionKey, aliases, sessionPayload) {
    if (!newSessionKey) return;
    if (newSessionKey !== sessionKey) setSessionKey(newSessionKey);
    hydrateSession(newSessionKey, aliases || []);
    scheduleSessionCacheRegistration(newSessionKey, sessionPayload);
  }, [scheduleSessionCacheRegistration, sessionKey]);

  return {
    messages: current.messages,
    loading: current.loading,
    loadingLabel: current.loadingLabel,
    loadingPhase: current.loadingProgress ? current.loadingProgress.phase : null,
    loadingDetail: current.loadingProgress ? current.loadingProgress.detail : null,
    loadingElapsedMs: current.loadingProgress ? current.loadingProgress.elapsedMs : null,
    loadingStartedAtMs: current.loadingStartedAtMs,
    queuedCount: sessionKey && queueRef.current[sessionKey] ? queueRef.current[sessionKey].length : 0,
    error: current.error,
    responseModel: current.responseModel,
    selectedModel: selectedModel,
    setSelectedModel: setSelectedModel,
    askQuestion: askQuestion,
    stopAnswer: stopAnswer,
    clearHistory: clearHistory,
    switchSession: switchSession,
  };
}
