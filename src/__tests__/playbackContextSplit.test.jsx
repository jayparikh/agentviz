import { describe, it, expect } from "vitest";
import {
  PlaybackProvider,
  usePlaybackContext,
  usePlaybackTime,
  useFilterContext,
  useSearchContext,
} from "../contexts/PlaybackContext.jsx";

describe("PlaybackContext split", function () {
  it("exports PlaybackProvider", function () {
    expect(typeof PlaybackProvider).toBe("function");
  });

  it("exports usePlaybackContext (backward compatible)", function () {
    expect(typeof usePlaybackContext).toBe("function");
  });

  it("exports usePlaybackTime", function () {
    expect(typeof usePlaybackTime).toBe("function");
  });

  it("exports useFilterContext", function () {
    expect(typeof useFilterContext).toBe("function");
  });

  it("exports useSearchContext", function () {
    expect(typeof useSearchContext).toBe("function");
  });

  it("granular hooks throw outside provider", function () {
    // Calling hooks outside React render throws (either our guard or React's own error)
    expect(function () { usePlaybackTime(); }).toThrow();
    expect(function () { useFilterContext(); }).toThrow();
    expect(function () { useSearchContext(); }).toThrow();
    expect(function () { usePlaybackContext(); }).toThrow();
  });
});
