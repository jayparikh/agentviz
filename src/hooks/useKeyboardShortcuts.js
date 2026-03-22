import { useEffect, useRef } from "react";

function isEditableTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return target.tagName === "INPUT"
    || target.tagName === "TEXTAREA"
    || target.tagName === "SELECT";
}

// Uses a ref to always read the latest options without re-registering the
// keydown listener. This avoids re-attaching on every playback tick.
export default function useKeyboardShortcuts(options) {
  var optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(function () {
    function handler(e) {
      var o = optionsRef.current;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        o.onTogglePalette();
        return;
      }

      if (o.showHero && (e.code === "Space" || e.code === "Enter")) {
        e.preventDefault();
        o.onDismissHero();
        return;
      }

      if (!o.hasSession || o.showPalette || isEditableTarget(e.target)) return;

      if (e.code === "Space") {
        e.preventDefault();
        o.onPlayPause();
        return;
      }

      if (e.code === "ArrowRight") {
        e.preventDefault();
        o.onSeek(o.time + 2);
        return;
      }

      if (e.code === "ArrowLeft") {
        e.preventDefault();
        o.onSeek(o.time - 2);
        return;
      }

      if (e.key === "1") o.onSetView("replay");
      if (e.key === "2") o.onSetView("tracks");
      if (e.key === "3") o.onSetView("waterfall");
      if (e.key === "4") o.onSetView("stats");

      if (e.key === "e") {
        e.preventDefault();
        o.onJumpToError("next");
      }

      if (e.key === "E") {
        e.preventDefault();
        o.onJumpToError("prev");
      }

      if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        o.onFocusSearch();
      }

      if (e.key === "?") {
        e.preventDefault();
        o.onToggleShortcuts();
      }
    }

    window.addEventListener("keydown", handler);
    return function () {
      window.removeEventListener("keydown", handler);
    };
  }, []);
}
