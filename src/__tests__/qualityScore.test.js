import { describe, expect, it } from "vitest";
import {
  computeQualityScore,
  scoreToGrade,
  gradeColor,
  formatScoreTooltip,
} from "../lib/qualityScore.js";
import { theme } from "../lib/theme.js";

describe("qualityScore", function () {
  describe("computeQualityScore", function () {
    it("returns a score between 0 and 1", function () {
      var result = computeQualityScore(
        { totalEvents: 100, totalTurns: 10, totalToolCalls: 50, errorCount: 2, uniqueToolCount: 8 },
        { efficiency: 0.7 },
      );
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    it("gives A grade for a perfect session", function () {
      var result = computeQualityScore(
        { totalEvents: 200, totalTurns: 10, totalToolCalls: 80, errorCount: 0, uniqueToolCount: 12 },
        { efficiency: 0.95 },
      );
      expect(result.grade).toBe("A");
      expect(result.score).toBeGreaterThanOrEqual(0.9);
    });

    it("gives D or F for high error rate", function () {
      var result = computeQualityScore(
        { totalEvents: 10, totalTurns: 2, totalToolCalls: 5, errorCount: 5, uniqueToolCount: 2 },
        { efficiency: 0.3 },
      );
      expect(["D", "F"]).toContain(result.grade);
    });

    it("handles missing stats gracefully", function () {
      var result = computeQualityScore(null, null);
      expect(result).toBeDefined();
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.grade).toBeDefined();
      expect(result.components).toBeDefined();
    });

    it("handles undefined inputs without crashing", function () {
      expect(function () { computeQualityScore(undefined, undefined); }).not.toThrow();
      expect(function () { computeQualityScore({}, {}); }).not.toThrow();
      expect(function () { computeQualityScore({}, undefined); }).not.toThrow();
      expect(function () { computeQualityScore(undefined, {}); }).not.toThrow();
    });

    it("handles empty stats object", function () {
      var result = computeQualityScore({}, {});
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });

    it("returns all five component scores", function () {
      var result = computeQualityScore(
        { totalEvents: 50, totalTurns: 5, totalToolCalls: 20, errorCount: 1, uniqueToolCount: 5 },
        { efficiency: 0.6 },
      );
      expect(result.components.errorRate).toBeDefined();
      expect(result.components.autonomy).toBeDefined();
      expect(result.components.toolDiversity).toBeDefined();
      expect(result.components.completion).toBeDefined();
      expect(result.components.efficiency).toBeDefined();
    });
  });

  describe("scoreToGrade", function () {
    it("returns A for score >= 0.9", function () {
      expect(scoreToGrade(0.9)).toBe("A");
      expect(scoreToGrade(1.0)).toBe("A");
      expect(scoreToGrade(0.95)).toBe("A");
    });

    it("returns B for score >= 0.8", function () {
      expect(scoreToGrade(0.8)).toBe("B");
      expect(scoreToGrade(0.89)).toBe("B");
    });

    it("returns C for score >= 0.65", function () {
      expect(scoreToGrade(0.65)).toBe("C");
      expect(scoreToGrade(0.79)).toBe("C");
    });

    it("returns D for score >= 0.5", function () {
      expect(scoreToGrade(0.5)).toBe("D");
      expect(scoreToGrade(0.64)).toBe("D");
    });

    it("returns F for score < 0.5", function () {
      expect(scoreToGrade(0.49)).toBe("F");
      expect(scoreToGrade(0.0)).toBe("F");
    });
  });

  describe("gradeColor", function () {
    it("returns success color for A and B", function () {
      expect(gradeColor("A")).toBe(theme.semantic.success);
      expect(gradeColor("B")).toBe(theme.semantic.success);
    });

    it("returns warning color for C", function () {
      expect(gradeColor("C")).toBe(theme.semantic.warning);
    });

    it("returns error color for D and F", function () {
      expect(gradeColor("D")).toBe(theme.semantic.error);
      expect(gradeColor("F")).toBe(theme.semantic.error);
    });
  });

  describe("formatScoreTooltip", function () {
    it("formats tooltip with grade and percentages", function () {
      var result = computeQualityScore(
        { totalEvents: 100, totalTurns: 5, totalToolCalls: 30, errorCount: 0, uniqueToolCount: 8 },
        { efficiency: 0.8 },
      );
      var tooltip = formatScoreTooltip(result);
      expect(tooltip).toContain("Quality:");
      expect(tooltip).toContain(result.grade);
      expect(tooltip).toContain("Errors:");
      expect(tooltip).toContain("Autonomy:");
      expect(tooltip).toContain("Tool diversity:");
      expect(tooltip).toContain("Completion:");
      expect(tooltip).toContain("Efficiency:");
    });

    it("returns empty string for null input", function () {
      expect(formatScoreTooltip(null)).toBe("");
      expect(formatScoreTooltip(undefined)).toBe("");
    });
  });

  describe("tool diversity scoring edge cases", function () {
    it("returns 0.5 for zero tool calls", function () {
      var result = computeQualityScore(
        { totalEvents: 10, totalTurns: 2, totalToolCalls: 0, errorCount: 0 },
        { efficiency: 0.8 },
      );
      expect(result.components.toolDiversity).toBe(0.5);
    });

    it("handles sessions with only 1 unique tool", function () {
      var result = computeQualityScore(
        { totalEvents: 100, totalTurns: 5, totalToolCalls: 100, errorCount: 0, uniqueToolCount: 1 },
        { efficiency: 0.8 },
      );
      // ratio = 1/50 = 0.02 which is below 0.05, so score is 0.3
      expect(result.components.toolDiversity).toBe(0.3);
    });

    it("handles sessions with many unique tools", function () {
      var result = computeQualityScore(
        { totalEvents: 10, totalTurns: 2, totalToolCalls: 5, errorCount: 0, uniqueToolCount: 5 },
        { efficiency: 0.8 },
      );
      // ratio = 5/5 = 1.0 which is > 0.5, so score is 0.7
      expect(result.components.toolDiversity).toBe(0.7);
    });
  });

  describe("score clamping", function () {
    it("never produces component scores outside 0-1", function () {
      var extremes = [
        { totalEvents: 1, totalTurns: 0, totalToolCalls: 0, errorCount: 100 },
        { totalEvents: 1000, totalTurns: 100, totalToolCalls: 5000, errorCount: 0, uniqueToolCount: 50 },
      ];
      extremes.forEach(function (stats) {
        var result = computeQualityScore(stats, { efficiency: 1.5 });
        Object.keys(result.components).forEach(function (key) {
          expect(result.components[key]).toBeGreaterThanOrEqual(0);
          expect(result.components[key]).toBeLessThanOrEqual(1);
        });
      });
    });
  });
});
