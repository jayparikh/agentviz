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

  var client = new CopilotClient();
  var session;

  try {
    await withTimeout(client.start(), SDK_TIMEOUT_MS, "Copilot SDK start");

    var sessionOpts = {
      onPermissionRequest: approveAll,
      systemMessage: { mode: "replace", content: SYSTEM_PROMPT },
    };
    if (model) sessionOpts.model = model;

    session = await withTimeout(client.createSession(sessionOpts), SDK_TIMEOUT_MS, "Copilot SDK session");

    if (signal && signal.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    if (signal) {
      signal.addEventListener("abort", function () {
        session && session.abort().catch(function () {});
      }, { once: true });
    }

    var contextBlock = formatContext(payload.context);
    var prompt = contextBlock + "\n\nUser question: " + payload.question;

    // Stream tokens via session events, with overall timeout
    await withTimeout(new Promise(function (resolve, reject) {
      var done = false;

      var unsubscribe = session.on(function (event) {
        if (done) return;
        if (event.type === "content.delta" && event.data && event.data.text) {
          if (onToken) onToken(event.data.text);
        } else if (event.type === "assistant.message" && event.data && event.data.content) {
          // SDK may send full response as a single message instead of streaming deltas
          if (onToken) onToken(event.data.content);
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
    if (session) await session.disconnect().catch(function () {});
    await client.stop().catch(function () {});
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
    parts.push(ctx.metadata);
  }

  if (ctx.topTools) {
    parts.push("\n## Top tools used");
    parts.push(ctx.topTools);
  }

  if (ctx.errorSamples) {
    parts.push("\n## Error samples");
    parts.push(ctx.errorSamples);
  }

  if (ctx.relevantTurns) {
    parts.push("\n## Relevant turns");
    parts.push(ctx.relevantTurns);
  }

  if (ctx.userMessages) {
    parts.push("\n## Recent user messages");
    parts.push(ctx.userMessages);
  }

  return parts.join("\n");
}
