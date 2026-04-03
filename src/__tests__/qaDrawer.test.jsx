/**
 * Tests for QADrawer component.
 */

// @vitest-environment jsdom

import { act } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import QADrawer from "../components/QADrawer.jsx";
import useQA from "../hooks/useQA.js";

var SESSION_DATA = {
  events: [
    { t: 0, agent: "assistant", track: "tool_call", text: "bash", toolName: "bash", turnIndex: 0 },
    { t: 1, agent: "assistant", track: "tool_call", text: "edit", toolName: "edit", turnIndex: 0 },
    { t: 2, agent: "assistant", track: "tool_call", text: "bash", toolName: "bash", turnIndex: 1, isError: true },
  ],
  turns: [
    { index: 0, startTime: 0, endTime: 2, eventIndices: [0, 1], userMessage: "Fix the bug", toolCount: 2, hasError: false },
    { index: 1, startTime: 2, endTime: 5, eventIndices: [2], userMessage: "Try again", toolCount: 1, hasError: true },
  ],
  metadata: {
    totalEvents: 3,
    totalTurns: 2,
    totalToolCalls: 3,
    errorCount: 1,
    duration: 5,
    models: ["claude-code"],
    primaryModel: "claude-code",
    tokenUsage: { input: 1000, output: 500 },
  },
  autonomyMetrics: null,
};

var container;
var root;

// Wrapper that provides useQA state to QADrawer
function QADrawerWithState(props) {
  var qa = useQA(props.sessionData);
  return <QADrawer {...props} qa={qa} />;
}

function mount(jsx) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(function () { root.render(jsx); });
}

afterEach(function () {
  if (root) act(function () { root.unmount(); });
  if (container) container.remove();
  root = null;
  container = null;
});

describe("QADrawer", function () {
  it("renders nothing when closed", function () {
    mount(
      <QADrawerWithState open={false} onClose={vi.fn()} sessionData={SESSION_DATA} onSeek={vi.fn()} turns={SESSION_DATA.turns} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders drawer when open", function () {
    mount(
      <QADrawerWithState open={true} onClose={vi.fn()} sessionData={SESSION_DATA} onSeek={vi.fn()} turns={SESSION_DATA.turns} />
    );
    var dialog = document.querySelector("[role='dialog']");
    expect(dialog).toBeTruthy();
    var input = document.querySelector("[aria-label='Ask about this session']");
    expect(input).toBeTruthy();
  });

  it("shows empty state with quick insights", function () {
    mount(
      <QADrawerWithState open={true} onClose={vi.fn()} sessionData={SESSION_DATA} onSeek={vi.fn()} turns={SESSION_DATA.turns} />
    );
    expect(document.body.textContent).toContain("Ask anything about this session");
    expect(document.body.textContent).toContain("Quick insights");
    expect(document.body.textContent).toContain("Summary");
    expect(document.body.textContent).toContain("Tools");
    expect(document.body.textContent).toContain("Errors");
  });

  it("submits a question on insight click and shows instant answer", function () {
    mount(
      <QADrawerWithState open={true} onClose={vi.fn()} sessionData={SESSION_DATA} onSeek={vi.fn()} turns={SESSION_DATA.turns} />
    );
    // Find and click the "Tools" insight button
    var buttons = Array.from(document.querySelectorAll("button"));
    var toolBtn = buttons.find(function (b) { return b.textContent.trim() === "Tools"; });
    expect(toolBtn).toBeTruthy();
    act(function () { toolBtn.click(); });
    // Should show an answer containing tool names
    expect(document.body.textContent).toContain("bash");
  });

  it("submits a question on form submit", function () {
    mount(
      <QADrawerWithState open={true} onClose={vi.fn()} sessionData={SESSION_DATA} onSeek={vi.fn()} turns={SESSION_DATA.turns} />
    );
    var input = document.querySelector("[aria-label='Ask about this session']");
    act(function () {
      var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      nativeInputValueSetter.call(input, "how many turns?");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(function () {
      input.closest("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(document.body.textContent).toContain("2 turns");
  });

  it("calls onClose when close button is clicked", function () {
    var onClose = vi.fn();
    mount(
      <QADrawerWithState open={true} onClose={onClose} sessionData={SESSION_DATA} onSeek={vi.fn()} turns={SESSION_DATA.turns} />
    );
    var allButtons = document.querySelectorAll("button");
    var closeBtn = null;
    allButtons.forEach(function (b) {
      if (b.getAttribute("aria-label") === "Close Q&A drawer") closeBtn = b;
    });
    expect(closeBtn).toBeTruthy();
    act(function () { closeBtn.click(); });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on Escape key", function () {
    var onClose = vi.fn();
    mount(
      <QADrawerWithState open={true} onClose={onClose} sessionData={SESSION_DATA} onSeek={vi.fn()} turns={SESSION_DATA.turns} />
    );
    act(function () {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows clear button after asking a question", function () {
    mount(
      <QADrawerWithState open={true} onClose={vi.fn()} sessionData={SESSION_DATA} onSeek={vi.fn()} turns={SESSION_DATA.turns} />
    );
    // No clear button initially
    expect(document.querySelector("[aria-label='Clear conversation']")).toBeNull();

    // Ask a question via insight
    var buttons = Array.from(document.querySelectorAll("button"));
    var summaryBtn = buttons.find(function (b) { return b.textContent.trim() === "Summary"; });
    act(function () { summaryBtn.click(); });

    // Clear button should appear
    expect(document.querySelector("[aria-label='Clear conversation']")).toBeTruthy();
  });

  it("shows quick answer badge for instant answers", function () {
    mount(
      <QADrawerWithState open={true} onClose={vi.fn()} sessionData={SESSION_DATA} onSeek={vi.fn()} turns={SESSION_DATA.turns} />
    );
    var buttons = Array.from(document.querySelectorAll("button"));
    var toolBtn = buttons.find(function (b) { return b.textContent.trim() === "Tools"; });
    act(function () { toolBtn.click(); });
    expect(document.body.textContent).toContain("quick answer");
  });
});
