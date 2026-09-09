import { describe, expect, it, vi } from "vitest";
import { handleKeyboardShortcut, isEditableTarget } from "../hooks/useKeyboardShortcuts.js";

function createOptions(overrides) {
  return Object.assign({
    hasSession: true,
    transportAvailable: true,
    showPalette: false,
    time: 5,
    onTogglePalette: vi.fn(),
    onPlayPause: vi.fn(),
    onSeek: vi.fn(),
    onNavigateShortcut: vi.fn(),
    onJumpToError: vi.fn(),
    onFocusSearch: vi.fn(),
    onToggleShortcuts: vi.fn(),
  }, overrides);
}

function createEvent(overrides) {
  return Object.assign({
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    target: null,
    prevented: false,
    preventDefault: function () {
      this.prevented = true;
    },
  }, overrides);
}

describe("useKeyboardShortcuts helpers", function () {
  it("recognizes editable targets", function () {
    expect(isEditableTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV" })).toBe(false);
  });

  it("opens the palette from ctrl/cmd+k", function () {
    var options = createOptions();
    var event = createEvent({ key: "k", ctrlKey: true });

    var handled = handleKeyboardShortcut(event, options);

    expect(handled).toBe(true);
    expect(event.prevented).toBe(true);
    expect(options.onTogglePalette).toHaveBeenCalledTimes(1);
  });

  it("does not play when no session is loaded", function () {
    var options = createOptions({ hasSession: false });
    var event = createEvent({ key: " ", code: "Space" });

    var handled = handleKeyboardShortcut(event, options);

    expect(handled).toBe(false);
    expect(options.onPlayPause).not.toHaveBeenCalled();
  });

  it("ignores session shortcuts while the palette is open or the target is editable", function () {
    var paletteOptions = createOptions({ showPalette: true });
    var paletteEvent = createEvent({ key: "/", code: "Slash" });

    expect(handleKeyboardShortcut(paletteEvent, paletteOptions)).toBe(false);
    expect(paletteOptions.onFocusSearch).not.toHaveBeenCalled();

    var inputOptions = createOptions();
    var inputEvent = createEvent({ key: "/", code: "Slash", target: { tagName: "INPUT" } });

    expect(handleKeyboardShortcut(inputEvent, inputOptions)).toBe(false);
    expect(inputOptions.onFocusSearch).not.toHaveBeenCalled();
  });

  it("focuses workflow search only when a search surface is available", function () {
    var options = createOptions({ onFocusSearch: vi.fn(function () { return true; }) });
    var event = createEvent({ key: "/", target: { tagName: "DIV" } });
    expect(handleKeyboardShortcut(event, options)).toBe(true);
    expect(event.prevented).toBe(true);
    expect(options.onFocusSearch).toHaveBeenCalledOnce();
    options.onFocusSearch.mockReturnValue(false);
    expect(handleKeyboardShortcut(createEvent({ key: "/" }), options)).toBe(false);
    expect(handleKeyboardShortcut(createEvent({ key: "/", altKey: true }), options)).toBe(false);
  });

  it("routes navigation and view shortcuts to the expected callbacks", function () {
    var options = createOptions({ time: 10 });

    expect(handleKeyboardShortcut(createEvent({ key: "ArrowRight", code: "ArrowRight" }), options)).toBe(true);
    expect(options.onSeek).toHaveBeenCalledWith(12);

    expect(handleKeyboardShortcut(createEvent({ key: "2" }), options)).toBe(true);
    expect(options.onNavigateShortcut).toHaveBeenCalledWith("2");

    expect(handleKeyboardShortcut(createEvent({ key: "4" }), options)).toBe(true);
    expect(options.onNavigateShortcut).toHaveBeenCalledWith("4");

    expect(handleKeyboardShortcut(createEvent({ key: "5" }), options)).toBe(true);
    expect(options.onNavigateShortcut).toHaveBeenCalledWith("5");

    expect(handleKeyboardShortcut(createEvent({ key: "6" }), options)).toBe(true);
    expect(options.onNavigateShortcut).toHaveBeenCalledWith("6");

    expect(handleKeyboardShortcut(createEvent({ key: "7" }), options)).toBe(true);
    expect(options.onNavigateShortcut).toHaveBeenCalledWith("7");

    expect(handleKeyboardShortcut(createEvent({ key: "E" }), options)).toBe(true);
    expect(options.onJumpToError).toHaveBeenCalledWith("prev");
  });

  it("prioritizes Q&A modifiers and preserves browser, native, tree, lane and dialog keys", function () {
    var options = createOptions({ onToggleQA: vi.fn() });
    expect(handleKeyboardShortcut(createEvent({ key: "K", ctrlKey: true, shiftKey: true }), options)).toBe(true);
    expect(options.onToggleQA).toHaveBeenCalledTimes(1);
    expect(options.onTogglePalette).not.toHaveBeenCalled();
    for (var key of ["1", "7", "ArrowRight", "e", "/"]) {
      expect(handleKeyboardShortcut(createEvent({ key: key, ctrlKey: true }), options)).toBe(false);
    }
    expect(handleKeyboardShortcut(createEvent({ key: " ", code: "Space", target: { closest: function () { return {}; } } }), options)).toBe(false);
    expect(handleKeyboardShortcut(createEvent({ key: "ArrowRight", defaultPrevented: true }), options)).toBe(false);
    expect(handleKeyboardShortcut(createEvent({ key: " ", code: "Space" }), createOptions({ isLive: true }))).toBe(false);
    expect(handleKeyboardShortcut(createEvent({ key: " ", code: "Space" }), createOptions({ transportAvailable: false }))).toBe(false);
  });

  it("leaves additional Alt modifiers on command shortcuts to the browser", function () {
    var options = createOptions({ onToggleQA: vi.fn() });
    for (var shiftKey of [false, true]) {
      var event = createEvent({ key: "k", ctrlKey: true, altKey: true, shiftKey: shiftKey });
      expect(handleKeyboardShortcut(event, options)).toBe(false);
      expect(event.prevented).toBe(false);
    }
    expect(options.onTogglePalette).not.toHaveBeenCalled();
    expect(options.onToggleQA).not.toHaveBeenCalled();
  });
});
