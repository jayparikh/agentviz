/**
 * Q&A agent -- sends a session question to the Copilot SDK and streams tokens back.
 *
 * Lightweight wrapper: no tools, no retries, just a single prompt/response with streaming.
 * Reuses the CopilotClient pattern from aiCoachAgent.js.
 * Keeps a persistent SDK session across calls to avoid per-question cold starts.
 */

import { CopilotClient, approveAll } from "@github/copilot-sdk";

var SYSTEM_PROMPT = [
  "You are a session analysis assistant for AGENTVIZ, a developer tool that visualizes AI agent workflows.",
  "The user will ask questions about an AI coding session (Claude Code or Copilot CLI).",
  "Answer concisely and precisely based on the provided session context.",
  "When referencing specific turns, use the format [Turn N] so the UI can create clickable links.",
  "If the context does not contain enough information to answer, say so honestly.",
  "Do not speculate beyond what the session data shows.",
].join(" ");

var SDK_TIMEOUT_MS = 15000; // 15s for client.start() and createSession()
var SESSION_TIMEOUT_MS = 60000; // 60s for the full model response

function withTimeout(promise, ms, label) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () {
      reject(new Error(label + " timed out after " + (ms / 1000) + "s"));
    }, ms);
    promise.then(
      function (val) { clearTimeout(timer); resolve(val); },
      function (err) { clearTimeout(timer); reject(err); }
    );
  });
}

// ── Warm client pool ─────────────────────────────────────────────
// Keep a started CopilotClient ready so the first Q&A call doesn't
// pay the cold-start penalty (~5-15s). The client is started once on
// import and reused across calls. If it dies, we recreate on next use.

var _warmClient = null;
var _warmingPromise = null;

function getWarmClient() {
  if (_warmClient) return Promise.resolve(_warmClient);
  if (_warmingPromise) return _warmingPromise;
  _warmingPromise = (async function () {
    var client = new CopilotClient();
    await withTimeout(client.start(), SDK_TIMEOUT_MS, "Copilot SDK start");
    _warmClient = client;
    _warmingPromise = null;
    return client;
  })().catch(function (err) {
    _warmingPromise = null;
    throw err;
  });
  return _warmingPromise;
}

// Kick off warm-up immediately on import (fire and forget)
getWarmClient().catch(function () {});

// ── Persistent session ──────────────────────────────────────────
// Keep a single SDK session alive across Q&A calls so follow-up
// questions don't pay the createSession() penalty (~2-5s).
// The session is invalidated on error or model change.

var _persistentSession = null;
var _sessionModel = null;

async function getOrCreateSession(client, model) {
  // Reuse if same model and session exists
  if (_persistentSession && _sessionModel === model) {
    return _persistentSession;
  }
  // Tear down stale session
  if (_persistentSession) {
    _persistentSession.disconnect().catch(function () {});
    _persistentSession = null;
  }

  var sessionOpts = {
    onPermissionRequest: approveAll,
    systemMessage: { mode: "replace", content: SYSTEM_PROMPT },
  };
  if (model) sessionOpts.model = model;

  try {
    _persistentSession = await withTimeout(client.createSession(sessionOpts), SDK_TIMEOUT_MS, "Copilot SDK session");
  } catch (sessionErr) {
    // Warm client may be stale -- invalidate and retry once
    _warmClient = null;
    client = await getWarmClient();
    _persistentSession = await withTimeout(client.createSession(sessionOpts), SDK_TIMEOUT_MS, "Copilot SDK session (retry)");
  }
  _sessionModel = model;
  return _persistentSession;
}

/**
 * Run a Q&A query against the Copilot SDK.
 *
 * @param {object} payload - { question: string, context: object, history?: Array<{role, content}> }
 * @param {object} opts
 * @param {string|null} [opts.model] - model ID from config, or null for SDK default
 * @param {AbortSignal} [opts.signal] - cancellation signal
 * @param {function} [opts.onToken] - called with each streamed token string
 * @param {function} [opts.onStatus] - called with status updates (e.g. "Retrieving context...")
 * @returns {Promise<void>}
 */
export async function runQAQuery(payload, opts) {
  var signal = opts && opts.signal;
  var onToken = opts && opts.onToken;
  var onStatus = opts && opts.onStatus;
  var model = opts && opts.model;

  var client;
  var session;

  try {
    if (onStatus) onStatus("Connecting to AI...");

    client = await getWarmClient();
    session = await getOrCreateSession(client, model);

    if (signal && signal.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    if (signal) {
      signal.addEventListener("abort", function () {
        session && session.abort().catch(function () {});
      }, { once: true });
    }

    if (onStatus) onStatus("Generating answer...");

    var contextBlock = formatContext(payload.context);
    var historyBlock = formatHistory(payload.history);
    var prompt = contextBlock + historyBlock + "\n\nUser question: " + payload.question;

    // Guard against duplicate output: track whether we got content.delta events.
    // If so, ignore the final assistant.message to prevent duplication.
    var gotDeltas = false;

    // Stream tokens via session events, with overall timeout
    await withTimeout(new Promise(function (resolve, reject) {
      var done = false;

      var unsubscribe = session.on(function (event) {
        if (done) return;
        if (event.type === "content.delta" && event.data && event.data.text) {
          gotDeltas = true;
          if (onToken) onToken(event.data.text);
        } else if (event.type === "assistant.message" && event.data && event.data.content) {
          // Only use the full message if we didn't get streaming deltas
          if (!gotDeltas && onToken) onToken(event.data.content);
        } else if (event.type === "session.idle") {
          done = true; unsubscribe(); resolve();
        } else if (event.type === "session.error") {
          done = true; unsubscribe();
          // Disconnect and invalidate persistent session on error
          session.disconnect().catch(function () {});
          _persistentSession = null;
          reject(new Error(event.data && event.data.message ? event.data.message : "Session error"));
        }
      });

      session.send({ prompt: prompt }).catch(function (err) {
        if (!done) { done = true; unsubscribe(); reject(err); }
      });
    }), SESSION_TIMEOUT_MS, "Q&A model response");

    if (signal && signal.aborted) {
      throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    }
  } catch (err) {
    // Disconnect and invalidate persistent session on non-abort errors
    if (err.name !== "AbortError" && _persistentSession) {
      _persistentSession.disconnect().catch(function () {});
      _persistentSession = null;
    }
    throw err;
  }
  // Note: we no longer disconnect the session -- it stays alive for reuse
}

/**
 * Invalidate the persistent SDK session (e.g. when user switches sessions or clears Q&A).
 * Next call to runQAQuery will create a fresh session.
 */
export function resetQASession() {
  if (_persistentSession) {
    _persistentSession.disconnect().catch(function () {});
    _persistentSession = null;
  }
}

/**
 * Format conversation history into a prompt section for follow-up context.
 */
function formatHistory(history) {
  if (!history || history.length === 0) return "";
  var lines = ["\n\n## Prior conversation"];
  for (var i = 0; i < history.length; i++) {
    var msg = history[i];
    var role = msg.role === "user" ? "User" : "Assistant";
    lines.push(role + ": " + msg.content);
  }
  return lines.join("\n");
}

/**
 * Format the context object into a readable text block for the model prompt.
 */
function formatContextValue(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function formatContext(ctx) {
  if (!ctx) return "No session context provided.";

  var parts = [];

  if (ctx.metadata) {
    parts.push("## Session metadata");
    parts.push(formatContextValue(ctx.metadata));
  }

  if (ctx.topTools) {
    parts.push("\n## Top tools used");
    parts.push(formatContextValue(ctx.topTools));
  }

  if (ctx.errorSamples) {
    parts.push("\n## Error samples");
    parts.push(formatContextValue(ctx.errorSamples));
  }

  if (ctx.relevantTurns) {
    parts.push("\n## Relevant turns");
    parts.push(formatContextValue(ctx.relevantTurns));
  }

  if (ctx.userMessages) {
    parts.push("\n## Recent user messages");
    parts.push(formatContextValue(ctx.userMessages));
  }

  return parts.join("\n");
}
