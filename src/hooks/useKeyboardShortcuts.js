import { useEffect, useRef } from "react";

export function isEditableTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return target.tagName === "INPUT"
    || target.tagName === "TEXTAREA"
    || target.tagName === "SELECT";
}

export function handleKeyboardShortcut(e, options) {
  if (!options || e.defaultPrevented || e.altKey || options.showShortcuts || options.showQA) return false;
  if (isEditableTarget(e.target)) return false;
  if (e.target && e.target.closest && e.target.closest('[role="dialog"], [role="menu"]')) return false;

  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key && e.key.toLowerCase() === "k") {
    if (!options.hasSession || options.isLive || !options.onToggleQA) return false;
    e.preventDefault();
    options.onToggleQA();
    return true;
  }

  if ((e.metaKey || e.ctrlKey) && e.key && e.key.toLowerCase() === "k") {
    e.preventDefault();
    options.onTogglePalette();
    return true;
  }

  if (e.metaKey || e.ctrlKey || options.showPalette) return false;

  if (/^[1-7]$/.test(e.key) && options.onNavigateShortcut) {
    e.preventDefault();
    options.onNavigateShortcut(e.key);
    return true;
  }
  if (e.key === "/") {
    var focused = options.onFocusSearch && options.onFocusSearch();
    if (focused) e.preventDefault();
    return Boolean(focused);
  }
  if (e.key === "?") {
    e.preventDefault();
    options.onToggleShortcuts();
    return true;
  }

  if (!options.hasSession) return false;
  if (e.target && e.target.closest && e.target.closest('button, a, [role="tree"], [role="slider"], [role="separator"], [role="listbox"], [data-keyboard-navigation]')) return false;

  if (e.key === "e" || e.key === "E") {
    e.preventDefault();
    options.onJumpToError(e.shiftKey || e.key === "E" ? "prev" : "next");
    return true;
  }
  if (!options.transportAvailable || options.isLive) return false;
  if (e.code === "Space" || e.key === " ") {
    e.preventDefault();
    options.onPlayPause();
    return true;
  }
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    options.onSeek(options.time + (e.key === "ArrowRight" ? 2 : -2));
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
