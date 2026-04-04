import { describe, it, expect } from "vitest";
import { formatDuration, formatTime, formatDurationLong, truncateText } from "../lib/formatTime.js";

describe("formatDuration", function () {
  it("returns -- for zero or null", function () {
    expect(formatDuration(0)).toBe("--");
    expect(formatDuration(null)).toBe("--");
  });

  it("formats sub-10ms as <10ms", function () {
    expect(formatDuration(0.005)).toBe("<10ms");
  });

  it("formats milliseconds", function () {
    expect(formatDuration(0.5)).toBe("500ms");
  });

  it("formats seconds", function () {
    expect(formatDuration(30)).toBe("30.0s");
  });

  it("formats minutes", function () {
    expect(formatDuration(120)).toBe("2.0m");
  });
});

describe("formatTime", function () {
  it("returns -- for null", function () {
    expect(formatTime(null)).toBe("--");
  });

  it("formats sub-minute as seconds", function () {
    expect(formatTime(45)).toBe("45.0s");
  });

  it("formats minutes with leading zero seconds", function () {
    expect(formatTime(65)).toBe("1:05");
  });
});

describe("formatDurationLong", function () {
  it("returns -- for falsy", function () {
    expect(formatDurationLong(0)).toBe("--");
    expect(formatDurationLong(null)).toBe("--");
  });

  it("formats seconds only", function () {
    expect(formatDurationLong(45)).toBe("45s");
  });

  it("formats minutes and seconds", function () {
    expect(formatDurationLong(125)).toBe("2m 05s");
  });
});

describe("truncateText", function () {
  it("returns empty string for falsy input", function () {
    expect(truncateText(null, 10)).toBe("");
    expect(truncateText("", 10)).toBe("");
    expect(truncateText(undefined, 10)).toBe("");
  });

  it("returns text unchanged when within limit", function () {
    expect(truncateText("hello", 10)).toBe("hello");
    expect(truncateText("exact", 5)).toBe("exact");
  });

  it("truncates and appends ellipsis when over limit", function () {
    expect(truncateText("hello world", 5)).toBe("hello...");
  });

  it("handles single character limit", function () {
    expect(truncateText("abc", 1)).toBe("a...");
  });
});
