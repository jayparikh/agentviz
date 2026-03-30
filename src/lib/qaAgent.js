/**
 * Q&A agent -- sends a session question to the Copilot SDK and streams tokens back.
 *
 * Lightweight wrapper: no tools, no retries, just a single prompt/response with streaming.
 * Reuses the CopilotClient pattern from aiCoachAgent.js.
 */

import { CopilotClient, approveAll } from "@github/copilot-sdk";

var SYSTEM_PROMPT = [
  "You are a session analysis assistant for AGENTVIZ, a developer tool that visualizes AI agent workflows.",
  "The user will ask questions about an AI coding session (Claude Code or Copilot CLI).",
  "Rules:",
  "1. Answer concisely using markdown: bullet lists, **bold** key terms, `code` for paths/commands.",
  "2. When referencing turns, use [Turn N] format so the UI can create clickable links.",
  "3. Only state facts that appear in the provided context. If the context is insufficient, say so.",
  "4. Do not speculate or infer beyond what the session data shows.",
  "5. Keep answers under 300 words. For long lists, show the top 5-10 and note how many more exist.",
].join("\n");

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

/**
 * Run a Q&A query against the Copilot SDK.
 *
 * @param {object} payload - { question: string, context: object }
 * @param {object} opts
 * @param {string|null} [opts.model] - model ID from config, or null for SDK default
 * @param {AbortSignal} [opts.signal] - cancellation signal
 * @param {function} [opts.onToken] - called with each streamed token string
 * @returns {Promise<void>}
 */
export async function runQAQuery(payload, opts) {
  var signal = opts && opts.signal;
  var onToken = opts && opts.onToken;
  var model = opts && opts.model;

  var client;
  var session;

  try {
    client = await getWarmClient();

    var sessionOpts = {
      onPermissionRequest: approveAll,
      systemMessage: { mode: "replace", content: SYSTEM_PROMPT },
    };
    if (model) sessionOpts.model = model;

    try {
      session = await withTimeout(client.createSession(sessionOpts), SDK_TIMEOUT_MS, "Copilot SDK session");
    } catch (sessionErr) {
      // Warm client may be stale -- invalidate and retry once
      _warmClient = null;
      client = await getWarmClient();
      session = await withTimeout(client.createSession(sessionOpts), SDK_TIMEOUT_MS, "Copilot SDK session (retry)");
    }

    if (signal && signal.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    if (signal) {
      signal.addEventListener("abort", function () {
        session && session.abort().catch(function () {});
      }, { once: true });
    }

    var contextBlock = formatContext(payload.context);
    // Limit total prompt to ~8K tokens (~32K chars) for faster model response
    var MAX_PROMPT_CHARS = 32000;
    if (contextBlock.length > MAX_PROMPT_CHARS) {
      contextBlock = contextBlock.slice(0, MAX_PROMPT_CHARS) + "\n\n[Context truncated for speed]";
    }
    var prompt = contextBlock + "\n\nUser question: " + payload.question;

    // Stream tokens via session events, with overall timeout
    await withTimeout(new Promise(function (resolve, reject) {
      var done = false;

      var unsubscribe = session.on(function (event) {
        if (done) return;
        if (event.type === "content.delta" && event.data && event.data.text) {
          if (onToken) onToken(event.data.text);
        } else if (event.type === "assistant.message" && event.data && event.data.content) {
          // SDK sent full response at once -- break into word-sized chunks
          // so the client sees progressive streaming
          if (onToken) {
            var words = event.data.content.split(/(\s+)/);
            for (var w = 0; w < words.length; w++) {
              onToken(words[w]);
            }
          }
        } else if (event.type === "session.idle") {
          done = true; unsubscribe(); resolve();
        } else if (event.type === "session.error") {
          done = true; unsubscribe();
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
  } finally {
    // Only disconnect the session; keep the warm client alive for reuse.
    // If the session errors in a way that corrupts the client, invalidate it
    // so the next call creates a fresh one.
    if (session) await session.disconnect().catch(function () {});
  }
}

/**
 * Format the context object into a readable text block for the model prompt.
 */
function formatContext(ctx) {
  if (!ctx) return "No session context provided.";

  var parts = [];

  if (ctx.metadata) {
    parts.push("## Session metadata");
    parts.push(typeof ctx.metadata === "string" ? ctx.metadata : JSON.stringify(ctx.metadata, null, 2));
  }

  if (ctx.topTools && ctx.topTools.length) {
    parts.push("\n## Top tools used");
    parts.push(typeof ctx.topTools === "string" ? ctx.topTools : JSON.stringify(ctx.topTools));
  }

  if (ctx.errorSamples && ctx.errorSamples.length) {
    parts.push("\n## Error samples");
    parts.push(typeof ctx.errorSamples === "string" ? ctx.errorSamples : JSON.stringify(ctx.errorSamples));
  }

  if (ctx.fileOperations && ctx.fileOperations.length) {
    parts.push("\n## File operations");
    parts.push(JSON.stringify(ctx.fileOperations));
  }

  if (ctx.commandHistory && ctx.commandHistory.length) {
    parts.push("\n## Command history");
    parts.push(JSON.stringify(ctx.commandHistory));
  }

  if (ctx.relevantTurns && ctx.relevantTurns.length) {
    parts.push("\n## Relevant turn events");
    parts.push(typeof ctx.relevantTurns === "string" ? ctx.relevantTurns : JSON.stringify(ctx.relevantTurns));
  }

  if (ctx.relevantEvents && ctx.relevantEvents.length) {
    parts.push("\n## Events matching question keywords");
    parts.push(JSON.stringify(ctx.relevantEvents));
  }

  if (ctx.turnMessages && ctx.turnMessages.length) {
    parts.push("\n## Turn user messages");
    parts.push(ctx.turnMessages.join("\n"));
  }

  if (ctx.userMessages && ctx.userMessages.length) {
    parts.push("\n## User messages (conversation history)");
    parts.push(typeof ctx.userMessages === "string" ? ctx.userMessages : ctx.userMessages.join("\n"));
  }

  if (ctx.conversationRecap) {
    parts.push("\n## Prior Q&A conversation");
    parts.push(ctx.conversationRecap);
  }

  return parts.join("\n");
}
