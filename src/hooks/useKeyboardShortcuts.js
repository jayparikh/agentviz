import { useEffect, useRef } from "react";

export function isEditableTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return target.tagName === "INPUT"
    || target.tagName === "TEXTAREA"
    || target.tagName === "SELECT";
}

export function handleKeyboardShortcut(e, options) {
  if (!options) return false;

  if ((e.metaKey || e.ctrlKey) && e.key && e.key.toLowerCase() === "k") {
    e.preventDefault();
    options.onTogglePalette();
    return true;
  }

  if (options.showHero && (e.code === "Space" || e.code === "Enter")) {
    e.preventDefault();
    options.onDismissHero();
    return true;
  }

  if (!options.hasSession || options.showPalette || isEditableTarget(e.target)) return false;

  if (e.code === "Space") {
    e.preventDefault();
    options.onPlayPause();
    return true;
  }

  if (e.code === "ArrowRight") {
    e.preventDefault();
    options.onSeek(options.time + 2);
    return true;
  }

  if (e.code === "ArrowLeft") {
    e.preventDefault();
    options.onSeek(options.time - 2);
    return true;
  }

  if (e.key === "1") {
    options.onSetView("replay");
    return true;
  }
  if (e.key === "2") {
    options.onSetView("tracks");
    return true;
  }
  if (e.key === "3") {
    options.onSetView("waterfall");
    return true;
  }
  if (e.key === "4") {
    options.onSetView("stats");
    return true;
  }

  if (e.key === "e") {
    e.preventDefault();
    options.onJumpToError("next");
    return true;
  }

  if (e.key === "E") {
    e.preventDefault();
    options.onJumpToError("prev");
    return true;
  }

  if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    options.onFocusSearch();
    return true;
  }

  if (e.key === "?") {
    e.preventDefault();
    options.onToggleShortcuts();
    return true;
  }

  return false;
}

// Uses a ref to always read the latest options without re-registering the
// keydown listener. This avoids re-attaching on every playback tick.
export default function useKeyboardShortcuts(options) {
  var optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(function () {
    function handler(e) {
      handleKeyboardShortcut(e, optionsRef.current);
    }

    window.addEventListener("keydown", handler);
    return function () {
      window.removeEventListener("keydown", handler);
    };
  }, []);
}
