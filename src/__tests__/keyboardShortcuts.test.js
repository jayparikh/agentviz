import { describe, expect, it, vi } from "vitest";
import { handleKeyboardShortcut, isEditableTarget } from "../hooks/useKeyboardShortcuts.js";

function createOptions(overrides) {
  return Object.assign({
    hasSession: true,
    showHero: false,
    showPalette: false,
    time: 5,
    onTogglePalette: vi.fn(),
    onDismissHero: vi.fn(),
    onPlayPause: vi.fn(),
    onSeek: vi.fn(),
    onSetView: vi.fn(),
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

  it("dismisses the hero before normal playback shortcuts", function () {
    var options = createOptions({ hasSession: false, showHero: true });
    var event = createEvent({ key: " ", code: "Space" });

    var handled = handleKeyboardShortcut(event, options);

    expect(handled).toBe(true);
    expect(options.onDismissHero).toHaveBeenCalledTimes(1);
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

  it("routes navigation and view shortcuts to the expected callbacks", function () {
    var options = createOptions({ time: 10 });

    expect(handleKeyboardShortcut(createEvent({ key: "ArrowRight", code: "ArrowRight" }), options)).toBe(true);
    expect(options.onSeek).toHaveBeenCalledWith(12);

    expect(handleKeyboardShortcut(createEvent({ key: "2" }), options)).toBe(true);
    expect(options.onSetView).toHaveBeenCalledWith("tracks");

    expect(handleKeyboardShortcut(createEvent({ key: "E" }), options)).toBe(true);
    expect(options.onJumpToError).toHaveBeenCalledWith("prev");
  });
});
