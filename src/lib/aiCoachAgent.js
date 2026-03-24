/**
 * AI Coach Agent
 *
 * Analyzes an AgentViz session and returns contextual recommendations using
 * GitHub Models API (OpenAI-compatible) authenticated via the developer's
 * existing `gh auth` credential -- no additional setup required.
 *
 * Architecture: single-turn agent with structured JSON output.
 * The system prompt defines a coach persona and a strict output schema.
 * The user message carries the session payload (stats, errors, config).
 */

import { execFile } from "child_process";
import OpenAI from "openai";

// GitHub Models endpoint -- OpenAI-compatible, authenticated via gh token
var GITHUB_MODELS_BASE_URL = "https://models.inference.ai.azure.com";
var COACH_MODEL = "gpt-4o-mini";
var MAX_TOKENS = 1400;

// ─────────────────────────────────────────────────────────────────────────────
// Token acquisition
// ─────────────────────────────────────────────────────────────────────────────

export function getGhToken() {
  return new Promise(function (resolve, reject) {
    execFile("gh", ["auth", "token"], { timeout: 6000 }, function (err, stdout) {
      var token = (stdout || "").trim();
      if (err || !token) {
        reject(new Error("Could not get gh auth token. Run: gh auth login"));
        return;
      }
      resolve(token);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt builder
// ─────────────────────────────────────────────────────────────────────────────

var SYSTEM_PROMPT = [
  "You are an expert AI agent workflow coach. You analyze session telemetry from",
  "AI coding agents (Claude Code, GitHub Copilot CLI) and produce specific,",
  "evidence-based recommendations to improve autonomy and reduce human interventions.",
  "",
  "Rules:",
  "- Base every recommendation on the actual data provided (errors, tool counts, idle time).",
  "- Never give generic advice like 'improve your prompts'.",
  "- If there are specific error messages, diagnose them precisely.",
  "- If there is high idle time, identify the exact cause and fix.",
  "- If web_fetch is failing, specify exactly what config/tool to add.",
  "- Keep each recommendation actionable: the developer should be able to apply it in 5 minutes.",
  "- The 'draft' field must be ready-to-paste config, code, or a command -- not prose.",
  "",
  "Output format: a JSON array only, no markdown, no prose before or after.",
  "Each item in the array must have exactly these fields:",
  '{ "title": string, "priority": "high"|"medium", "summary": string, "fix": string, "draft": string }',
].join("\n");

export function buildCoachPrompt(payload) {
  var {
    format, primaryModel, totalEvents, totalTurns, errorCount, totalToolCalls,
    productiveRuntime, humanResponseTime, idleTime, interventions, autonomyEfficiency,
    topTools, errorSamples, userFollowUps, configSummary,
  } = payload;

  var agentType = format === "copilot-cli" ? "GitHub Copilot CLI" : "Claude Code";
  var toolList = (topTools || []).slice(0, 10).map(function (t) { return t.name + " x" + t.count; }).join(", ");
  var errors = (errorSamples || []).slice(0, 6).map(function (e, i) { return (i + 1) + ". " + e; }).join("\n");
  var followUps = (userFollowUps || []).slice(0, 5).map(function (m) { return "- " + m; }).join("\n");

  var sections = [
    "Analyze this " + agentType + " session and return 2-4 recommendations.",
    "",
    "## Session stats",
    "- Model: " + (primaryModel || "unknown"),
    "- Events: " + (totalEvents || 0) + ", Turns: " + (totalTurns || 0) + ", Tool calls: " + (totalToolCalls || 0),
    "- Errors: " + (errorCount || 0),
    "- Productive runtime: " + (productiveRuntime || "0s"),
    "- Human response time: " + (humanResponseTime || "0s"),
    "- Idle time: " + (idleTime || "0s"),
    "- Interventions needed: " + (interventions || 0),
    "- Autonomy efficiency: " + (autonomyEfficiency || "0%"),
    "- Top tools used: " + (toolList || "none"),
  ];

  if (errors) {
    sections.push("", "## Errors observed (most important -- diagnose these)", errors);
  }
  if (followUps) {
    sections.push("", "## Human follow-up messages (where agent got stuck)", followUps);
  }
  if (configSummary) {
    sections.push("", "## Current agent config", configSummary);
  }

  return sections.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the coach agent.
 *
 * @param {object} payload - session stats from the UI
 * @param {object} opts
 * @param {AbortSignal} [opts.signal] - cancellation signal
 * @param {function} [opts.onChunk] - called with partial text as tokens stream in
 * @returns {Promise<{ recommendations: object[], model: string, usage: object }>}
 */
export async function runCoachAgent(payload, opts) {
  var signal = opts && opts.signal;
  var onChunk = opts && opts.onChunk;

  var token = await getGhToken();

  var client = new OpenAI({
    apiKey: token,
    baseURL: GITHUB_MODELS_BASE_URL,
    defaultHeaders: { "X-GitHub-Api-Version": "2022-11-28" },
  });

  var userMessage = buildCoachPrompt(payload);

  var requestParams = {
    model: COACH_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: 0.2,
    max_tokens: MAX_TOKENS,
    // Note: json_object mode is not used with streaming (delays all tokens until
    // JSON is complete). Plain text streaming with parseRecommendations works well.
  };

  // Use streaming if caller wants live chunks; otherwise plain completion
  if (onChunk) {
    return runStreaming(client, requestParams, signal, onChunk);
  }
  return runCompletion(client, requestParams, signal);
}

async function runCompletion(client, params, signal) {
  // Add json_object for non-streaming -- enforces valid JSON output
  var completionParams = Object.assign({}, params, { response_format: { type: "json_object" } });
  var completion = await client.chat.completions.create(completionParams, { signal });
  var raw = completion.choices[0]?.message?.content?.trim() || "";
  return {
    recommendations: parseRecommendations(raw),
    model: completion.model || COACH_MODEL,
    usage: completion.usage || null,
    raw,
  };
}

async function runStreaming(client, params, signal, onChunk) {
  var streamParams = Object.assign({}, params, { stream: true });
  var stream = await client.chat.completions.create(streamParams, { signal });

  var accumulated = "";
  var finalUsage = null;

  for await (var chunk of stream) {
    if (signal && signal.aborted) break;
    var delta = chunk.choices?.[0]?.delta?.content || "";
    if (delta) {
      accumulated += delta;
      onChunk(delta);
    }
    if (chunk.usage) finalUsage = chunk.usage;
  }

  return {
    recommendations: parseRecommendations(accumulated),
    model: COACH_MODEL,
    usage: finalUsage,
    raw: accumulated,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse JSON recommendations from LLM output.
 * Handles:
 *   - Plain JSON array: [...]
 *   - JSON object with array property: { "recommendations": [...] }
 *   - Markdown code fences: ```json ... ```
 */
export function parseRecommendations(raw) {
  if (!raw) throw new Error("Empty response from AI");

  // Strip markdown code fences if present
  var cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  // Try direct parse first
  var parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // Try extracting array substring
    var arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
      throw new Error("AI response was not valid JSON: " + cleaned.substring(0, 300));
    }
    try {
      parsed = JSON.parse(arrayMatch[0]);
    } catch (e2) {
      throw new Error("Could not parse AI JSON: " + arrayMatch[0].substring(0, 300));
    }
  }

  // Unwrap { recommendations: [...] } or { "items": [...] } envelope
  if (parsed && !Array.isArray(parsed)) {
    var keys = Object.keys(parsed);
    for (var i = 0; i < keys.length; i++) {
      if (Array.isArray(parsed[keys[i]])) {
        parsed = parsed[keys[i]];
        break;
      }
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error("AI returned unexpected shape: " + JSON.stringify(parsed).substring(0, 200));
  }

  // Validate and normalize each recommendation
  return parsed.map(function (item, idx) {
    if (!item || typeof item !== "object") {
      return { title: "Recommendation " + (idx + 1), priority: "medium", summary: String(item), fix: "", draft: "" };
    }
    return {
      title: String(item.title || "Recommendation " + (idx + 1)),
      priority: item.priority === "high" ? "high" : "medium",
      summary: String(item.summary || ""),
      fix: String(item.fix || ""),
      draft: String(item.draft || ""),
    };
  });
}
