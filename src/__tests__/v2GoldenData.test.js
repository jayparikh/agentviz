import { describe, expect, it } from "vitest";
import { buildAutonomyMetrics, getTopTools } from "../lib/autonomyMetrics.js";
import { buildCostAnalysis } from "../lib/costAnalysis.js";
import { buildCommandPaletteIndex, searchCommandPalette } from "../lib/commandPalette.js";
import { formatSessionCost } from "../lib/pricing.js";
import { buildReviewInsights, buildReviewSummary } from "../components/v2/ReviewHub.jsx";
import { getErrorEventIndexes, getToolNames, loadGoldenSession } from "./v2GoldenHelpers.js";

function expectClose(actual, expected) {
  expect(actual).toBeCloseTo(expected, 6);
}

describe("v2 golden data correctness", function () {
  it("parses the canonical Copilot CLI fixture into expected session metadata", function () {
    var data = loadGoldenSession();
    var session = data.session;
    var expected = data.expected;
    var metadata = session.metadata;

    expect(metadata.format).toBe(expected.metadata.format);
    expect(metadata.sessionId).toBe(expected.metadata.sessionId);
    expect(metadata.repository).toBe(expected.metadata.repository);
    expect(metadata.branch).toBe(expected.metadata.branch);
    expect(metadata.primaryModel).toBe(expected.metadata.primaryModel);
    expect(metadata.totalEvents).toBe(expected.metadata.totalEvents);
    expect(metadata.totalTurns).toBe(expected.metadata.totalTurns);
    expect(metadata.totalToolCalls).toBe(expected.metadata.totalToolCalls);
    expect(metadata.errorCount).toBe(expected.metadata.errorCount);
    expect(metadata.duration).toBe(expected.metadata.duration);
    expect(metadata.totalCost).toBe(expected.metadata.totalCost);
    expect(metadata.totalCostUnit).toBe(expected.metadata.totalCostUnit);
    expect(metadata.aiCredits).toBe(expected.metadata.aiCredits);
    expect(formatSessionCost(metadata)).toBe(expected.ui.costText);
    expect(metadata.codeChanges).toEqual(expected.metadata.codeChanges);
    expect(metadata.tokenUsage).toEqual(expected.metadata.tokenUsage);
  });

  it("pins normalized event and turn data used by v2 flows", function () {
    var data = loadGoldenSession();
    var session = data.session;
    var expected = data.expected;
    expect(session.events[0].text).toBe(expected.events.firstText);
    expect(getToolNames(session)).toEqual(expected.events.toolNames);
    expect(getErrorEventIndexes(session)).toEqual(expected.events.errorEventIndexes);
    expect(session.turns.map(function (turn) {
      return {
        index: turn.index,
        userMessage: turn.userMessage,
        toolCount: turn.toolCount,
        hasError: turn.hasError,
      };
    })).toEqual(expected.turns);
  });

  it("keeps review, autonomy, and cost summaries aligned with golden values", function () {
    var data = loadGoldenSession();
    var session = data.session;
    var expected = data.expected;
    var autonomy = buildAutonomyMetrics(session.events, session.turns, session.metadata);
    var review = buildReviewSummary(session, autonomy);
    var insights = buildReviewInsights(session, autonomy);
    var cost = buildCostAnalysis(session.events, session.metadata);

    expectClose(autonomy.productiveRuntime, expected.autonomy.productiveRuntime);
    expect(autonomy.babysittingTime).toBe(expected.autonomy.babysittingTime);
    expect(autonomy.idleTime).toBe(expected.autonomy.idleTime);
    expect(autonomy.interventionCount).toBe(expected.autonomy.interventionCount);
    expectClose(autonomy.autonomyEfficiency, expected.autonomy.autonomyEfficiency);
    expect(getTopTools(session.events, 3)).toEqual(expected.review.topTools);

    expect(review.score).toBe(expected.review.score);
    expect(review.label).toBe(expected.review.label);
    expect(review.totalEvents).toBe(expected.review.totalEvents);
    expect(review.totalTurns).toBe(expected.review.totalTurns);
    expect(review.totalToolCalls).toBe(expected.review.totalToolCalls);
    expect(review.errorCount).toBe(expected.review.errorCount);
    expect(review.duration).toBe(expected.review.duration);
    expect(review.cost).toBe(expected.review.cost);
    expectClose(review.autonomyEfficiency, expected.review.autonomyEfficiency);
    expect(review.interventions).toBe(expected.review.interventions);
    expect(review.topTools).toEqual(expected.review.topTools);
    expect(insights.map(function (insight) { return insight.id; })).toEqual(expected.review.insightIds);

    expect(cost.totals.inputTokens).toBe(expected.cost.inputTokens);
    expect(cost.totals.outputTokens).toBe(expected.cost.outputTokens);
    expect(cost.totals.cacheRead).toBe(expected.cost.cacheRead);
    expect(cost.totals.cacheWrite).toBe(expected.cost.cacheWrite);
    expect(cost.totals.freshInputTokens).toBe(expected.cost.freshInputTokens);
    expect(cost.totals.cost).toBe(expected.cost.cost);
    expectClose(cost.totals.cacheHitRate, expected.cost.cacheHitRate);
    expect(cost.totals.peakContext).toBe(expected.cost.peakContext);
    expect(cost.calls).toHaveLength(expected.cost.callCount);
  });

  it("keeps command palette v2 command data deterministic", function () {
    var data = loadGoldenSession();
    var session = data.session;
    var index = buildCommandPaletteIndex(session.events, session.turns, {
      includeLegacyViews: false,
      includeDefaultActions: false,
      extraItems: [
        {
          id: "v2-cost-analysis",
          type: "zone",
          label: "Go to cost analysis",
          iconName: "coins",
          zoneId: "analyze",
          searchText: "cost analysis tokens spend cache context analyze",
          priority: 46,
        },
      ],
    });

    expect(searchCommandPalette(index, "cost analysis")[0]).toMatchObject({
      id: "v2-cost-analysis",
      zoneId: "analyze",
    });
    expect(searchCommandPalette(index, "hello world")[0]).toMatchObject({
      type: "turn",
      seekTime: session.turns[0].startTime,
    });
  });
});
