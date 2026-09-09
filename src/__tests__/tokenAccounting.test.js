// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { parseSession } from "../lib/parseSession";
import { buildCostAnalysis } from "../lib/costAnalysis.js";
import { buildMetrics } from "../components/CompareView.jsx";
import { buildReviewSummary } from "../components/v2/ReviewHub.jsx";
import StatsView from "../components/StatsView.jsx";

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

function expectUsage(actual, expected) {
  expect(actual).toMatchObject(expected);
}

function expectSurfacesAgree(session, expected) {
  expectUsage(session.metadata.tokenUsage, expected);

  var costAnalysis = buildCostAnalysis(session.events, session.metadata);
  expect(costAnalysis.totals.inputTokens).toBe(expected.inputTokens);
  expect(costAnalysis.totals.outputTokens).toBe(expected.outputTokens);
  expect(costAnalysis.totals.cacheRead).toBe(expected.cacheRead);
  expect(costAnalysis.totals.cacheWrite).toBe(expected.cacheWrite);

  var compareMetrics = buildMetrics({
    events: session.events,
    turns: session.turns,
    metadata: session.metadata,
    total: session.metadata.duration,
  });
  expect(compareMetrics.inputTokens).toBe(expected.inputTokens);
  expect(compareMetrics.outputTokens).toBe(expected.outputTokens);
  expect(compareMetrics.cacheRead).toBe(expected.cacheRead);
  expect(compareMetrics.cacheWrite).toBe(expected.cacheWrite);

  var review = buildReviewSummary({
    events: session.events,
    turns: session.turns,
    metadata: session.metadata,
  }, null);
  expect(review.totalEvents).toBe(session.metadata.totalEvents);
}

async function renderStatsText(session) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  var container = document.createElement("div");
  document.body.appendChild(container);
  var root = createRoot(container);
  await act(async function () {
    root.render(React.createElement(StatsView, {
      events: session.events,
      totalTime: session.metadata.duration,
      metadata: session.metadata,
      turns: session.turns,
      autonomyMetrics: null,
    }));
  });
  var text = container.textContent || "";
  await act(async function () {
    root.unmount();
  });
  container.remove();
  return text;
}

function rawCopilotShutdownUsage(text) {
  var lines = text.trim().split(/\r?\n/).map(function (line) { return JSON.parse(line); });
  var shutdown = lines.find(function (record) { return record.type === "session.shutdown"; });
  var usage = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };
  Object.keys(shutdown.data.modelMetrics || {}).forEach(function (model) {
    var raw = shutdown.data.modelMetrics[model].usage || {};
    usage.inputTokens += raw.inputTokens || 0;
    usage.outputTokens += raw.outputTokens || 0;
    usage.cacheRead += raw.cacheReadTokens || 0;
    usage.cacheWrite += raw.cacheWriteTokens || 0;
  });
  return usage;
}

function rawAtifFinalUsage(text) {
  var parsed = JSON.parse(text);
  var finalMetrics = parsed.final_metrics || {};
  return {
    inputTokens: finalMetrics.total_prompt_tokens || 0,
    outputTokens: finalMetrics.total_completion_tokens || 0,
    cacheRead: finalMetrics.total_cached_tokens || 0,
    cacheWrite: 0,
  };
}

function promptFixture() {
  return JSON.stringify([
    {
      request: {
        model: "gpt-4.1",
        messages: [{ role: "user", content: "Build a parser" }],
      },
      response: {
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 120,
          prompt_tokens_details: { cached_tokens: 200 },
          cache_creation_input_tokens: 50,
        },
      },
    },
    {
      request: {
        model: "gpt-4.1",
        messages: [{ role: "user", content: "Build the UI" }],
      },
      response: {
        usage: {
          input_tokens: 1800,
          output_tokens: 240,
          input_tokens_details: { cached_tokens: 900 },
          cache_write_input_tokens: 20,
        },
      },
    },
  ]);
}

describe("token accounting across parsers and surfaces", function () {
  it("uses per-request mixed-model prices in Cost, Stats, Compare, and Review", async function () {
    var session = parseSession(JSON.stringify(["gpt-5.6-sol", "gpt-6-astra"].map(model => ({
      request: { model, messages: [{ role: "user", content: "Synthetic cost request" }] },
      response: { usage: { input_tokens: 200000, output_tokens: 10000, input_tokens_details: { cached_tokens: 60000, cache_write_tokens: 20000 } } },
    }))));
    expect(session.metadata.totalCost).toBeUndefined();
    var expected = 0.804 + 2.01;
    expect(buildCostAnalysis(session.events, session.metadata).totals.cost).toBeCloseTo(expected, 8);
    expect(buildMetrics(session).cost).toBeCloseTo(expected, 8);
    expect(buildReviewSummary(session, null).cost).toBeCloseTo(expected, 8);
    var stats = await renderStatsText(session);
    expect(stats).toContain("$2.81");
    expect(stats).toContain("$0.804");
    expect(stats).toContain("$2.01");
    expect(stats).toContain("Standard service tier assumed");
    expect(stats).not.toContain("reported by API");
  });

  it("shows missing pricing evidence instead of zero dollars in Stats", async function () {
    var session = parseSession(JSON.stringify([{
      request: { model: "gpt-5.6-unknown", messages: [{ role: "user", content: "Test unknown" }] },
      response: { usage: { input_tokens: 100000, output_tokens: 10000 } },
    }]));
    expect(buildMetrics(session).cost).toBeNull();
    var stats = await renderStatsText(session);
    expect(stats).toContain("pricing evidence incomplete");
    expect(stats).toContain("Pricing unavailable");
    expect(stats).not.toContain("$0.00");
  });

  it("keeps Copilot CLI shutdown totals consistent across metadata, Cost, Stats, Review, and Compare", async function () {
    var text = loadFixture("test-copilot.jsonl");
    var session = parseSession(text);
    var expected = rawCopilotShutdownUsage(text);

    expect(session.metadata.format).toBe("copilot-cli");
    expectSurfacesAgree(session, expected);
    expect(buildCostAnalysis(session.events, session.metadata).totals.cost).toBe(session.metadata.totalCost);
    var statsText = await renderStatsText(session);
    expect(statsText).toContain("8,200");
    expect(statsText).toContain("420");
    expect(statsText).toContain("1,200 cache read");
    expect(statsText).toContain("800 cache write");
  });

  it("keeps multi-agent Copilot CLI shutdown totals consistent", function () {
    var text = loadFixture("test-multiagent.jsonl");
    var session = parseSession(text);
    var expected = rawCopilotShutdownUsage(text);

    expect(session.metadata.format).toBe("copilot-cli");
    expectSurfacesAgree(session, expected);
  });

  it("keeps ATIF final_metrics totals consistent when step-level usage exists", function () {
    var text = loadFixture("atif-minimal.json");
    var session = parseSession(text);
    var expected = rawAtifFinalUsage(text);

    expect(session.metadata.format).toBe("atif");
    expectSurfacesAgree(session, expected);
  });

  it("keeps ATIF final_metrics totals visible in Cost even when step-level usage is absent", function () {
    var text = loadFixture("atif-tagged.json");
    var session = parseSession(text);
    var expected = rawAtifFinalUsage(text);

    expect(session.metadata.format).toBe("atif");
    expectSurfacesAgree(session, expected);
    expect(buildCostAnalysis(session.events, session.metadata).calls[0].isMetadataSummary).toBe(true);
  });

  it("keeps Copilot prompt export totals consistent", function () {
    var session = parseSession(promptFixture());
    var expected = { inputTokens: 2800, outputTokens: 360, cacheRead: 1100, cacheWrite: 70 };

    expect(session.metadata.format).toBe("copilot-prompts");
    expectSurfacesAgree(session, expected);
  });

  it("keeps VS Code chat token usage null when the source has no counters", function () {
    var session = parseSession(loadFixture("test-vscode-chat.json"));

    expect(session.metadata.format).toBe("vscode-chat");
    expect(session.metadata.tokenUsage).toBeNull();
    expect(buildCostAnalysis(session.events, session.metadata).hasCostData).toBe(false);
    expect(buildMetrics({ events: session.events, turns: session.turns, metadata: session.metadata, total: session.metadata.duration }).inputTokens).toBeNull();
  });
});
