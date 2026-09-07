// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import ResizablePanel, { clampPanelSplit } from "../components/ResizablePanel";
import TracksView from "../components/TracksView";
import { setDensityPreference, theme } from "../lib/theme";
import { buildTrackMarks } from "../lib/tracksLayout";
vi.mock("../lib/tracksLayout", async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, buildTrackMarks: vi.fn(actual.buildTrackMarks) };
});

let root, host;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setDensityPreference("normal");
  vi.restoreAllMocks();
});

it("clamps impossible pane minimums and invalid saved values", () => {
  expect(clampPanelSplit(0.9, 200, 200)).toBe(0.5);
  expect(clampPanelSplit(NaN, 1000, 200)).toBe(0.7);
  expect(clampPanelSplit(-10, 1000, 200)).toBeCloseTo(200 / 990);
});

it("cleans pointer styles when a dragged separator unmounts", async () => {
  document.body.style.cursor = "crosshair";
  document.body.style.userSelect = "text";
  await act(async () => root.render(<ResizablePanel><div>Evidence</div><div>Inspector</div></ResizablePanel>));
  const separator = host.querySelector('[role="separator"]');
  await act(async () => {
    const event = new MouseEvent("pointerdown", { bubbles: true, button: 0 });
    Object.defineProperty(event, "pointerId", { value: 1 });
    separator.dispatchEvent(event);
  });
  expect(document.body.style.userSelect).toBe("none");
  await act(async () => root.render(null));
  expect(document.body.style.cursor).toBe("crosshair");
  expect(document.body.style.userSelect).toBe("text");
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

it("does not rebuild static Tracks geometry on playback or evidence selection", async () => {
  const entries = Array.from({ length: 10000 }, (_, index) => ({
    index, event: { t: index, duration: 1, track: "output", agent: "assistant", text: "Event " + index },
  }));
  const render = time => <TracksView currentTime={time} eventEntries={entries} totalTime={10000} />;
  await act(async () => root.render(render(0)));
  expect(buildTrackMarks).toHaveBeenCalledTimes(1);
  for (let i = 1; i <= 10; i++) await act(async () => root.render(render(i)));
  await act(async () => host.querySelector("[data-track-mark]").click());
  expect(buildTrackMarks).toHaveBeenCalledTimes(1);
  expect(host.querySelectorAll("[data-track-mark]").length).toBeLessThanOrEqual(200);
});

it("changes only reading density tokens", () => {
  setDensityPreference("normal");
  expect(theme.reading.fontSize).toBe(12);
  setDensityPreference("comfortable");
  expect(theme.reading).toEqual({ fontSize: 14, rowPadding: 12, controlMin: 32 });
  expect(theme.fontSize.base).toBe(12);
});
