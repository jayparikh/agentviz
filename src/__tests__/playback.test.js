import { describe, it, expect } from "vitest";
import { tickPlayback } from "../hooks/usePlayback.js";

describe("tickPlayback", function () {
  it("advances time by 0.1 * speed when before total", function () {
    var result = tickPlayback(5, 100, 1, false);
    expect(result.nextTime).toBeCloseTo(5.1);
    expect(result.stop).toBe(false);
  });

  it("stops at total in non-live mode when time reaches the end", function () {
    var result = tickPlayback(100, 100, 1, false);
    expect(result.nextTime).toBe(100);
    expect(result.stop).toBe(true);
  });

  it("does not stop in live mode when time reaches the current total", function () {
    var result = tickPlayback(100, 100, 1, true);
    expect(result.nextTime).toBe(100);
    expect(result.stop).toBe(false);
  });

  it("resumes advancing in live mode when total grows past current time", function () {
    // Simulate: was at end (time=100, total=100), then total grows to 150
    var atEnd = tickPlayback(100, 100, 1, true);
    expect(atEnd.stop).toBe(false);
    // Next tick with expanded total
    var resumed = tickPlayback(atEnd.nextTime, 150, 1, true);
    expect(resumed.nextTime).toBeCloseTo(100.1);
    expect(resumed.stop).toBe(false);
  });

  it("respects speed multiplier", function () {
    var result = tickPlayback(0, 100, 2, false);
    expect(result.nextTime).toBeCloseTo(0.2);
  });

  it("clamps to total when prev exceeds it", function () {
    var result = tickPlayback(105, 100, 1, false);
    expect(result.nextTime).toBe(100);
    expect(result.stop).toBe(true);
  });
});
