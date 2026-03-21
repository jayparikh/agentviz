import { useRef, useMemo } from "react";
import { theme, TRACK_TYPES } from "../lib/theme.js";

export default function Timeline({ currentTime, totalTime, timeMap, onSeek, isPlaying, onPlayPause, eventEntries, turns, matchSet }) {
  var barRef = useRef(null);

  function handleClick(e) {
    var rect = barRef.current.getBoundingClientRect();
    var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(timeMap ? timeMap.toTime(pct) : pct * totalTime);
  }

  var pct = timeMap ? timeMap.toPosition(currentTime) * 100 : (totalTime > 0 ? (currentTime / totalTime) * 100 : 0);

  var counts = useMemo(function () {
    var nextCounts = {};
    for (var i = 0; i < eventEntries.length; i++) {
      var track = eventEntries[i].event.track;
      nextCounts[track] = (nextCounts[track] || 0) + 1;
    }
    return nextCounts;
  }, [eventEntries]);

  return (
    <div style={{ padding: "0 0 8px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <button
          onClick={onPlayPause}
          style={{
            background: "none",
            border: "1px solid " + theme.border.strong,
            borderRadius: theme.radius.lg,
            color: theme.text.primary,
            cursor: "pointer",
            padding: "4px 12px",
            fontSize: theme.fontSize.lg,
            fontFamily: theme.font,
            letterSpacing: 1,
          }}
        >
          {isPlaying ? "\u275A\u275A" : "\u25B6"}
        </button>
        <span style={{ fontFamily: theme.font, fontSize: theme.fontSize.md, color: theme.text.secondary, letterSpacing: 1 }}>
          {currentTime.toFixed(1)}s / {totalTime.toFixed(1)}s
        </span>
        {turns && turns.length > 0 && (function () {
          var currentTurn = null;
          for (var i = 0; i < turns.length; i++) {
            if (currentTime >= turns[i].startTime && currentTime <= turns[i].endTime) {
              currentTurn = turns[i];
              break;
            }
          }
          if (!currentTurn && turns.length > 0) currentTurn = turns[turns.length - 1];
          if (!currentTurn) return null;
          return (
            <span style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, display: "flex", alignItems: "center", gap: 4 }}>
              Turn {currentTurn.index + 1}/{turns.length}
              {currentTurn.hasError && <span style={{ color: theme.error }}>{"\u25CF"}</span>}
            </span>
          );
        })()}
        <div style={{ flex: 1 }} />
        {Object.keys(counts).map(function (track) {
          var info = TRACK_TYPES[track];
          if (!info) return null;
          return (
            <span key={track} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: theme.fontSize.base, color: theme.text.muted }}>
              <span style={{ color: info.color }}>{info.icon}</span>
              {counts[track]}
            </span>
          );
        })}
      </div>
      <div
        ref={barRef}
        onClick={handleClick}
        style={{
          height: 28,
          background: theme.bg.surface,
          borderRadius: theme.radius.md,
          position: "relative",
          cursor: "crosshair",
          border: "1px solid " + theme.border.default,
          overflow: "hidden",
        }}
      >
        {turns && turns.map(function (turn, i) {
          if (i === 0) return null;
          var left = timeMap ? timeMap.toPosition(turn.startTime) * 100 : (totalTime > 0 ? (turn.startTime / totalTime) * 100 : 0);
          return (
            <div key={"turn-" + i} style={{
              position: "absolute",
              left: left + "%",
              top: 0,
              bottom: 0,
              width: 1,
              background: theme.border.strong,
              zIndex: 1,
              opacity: 0.6,
            }} />
          );
        })}
        {eventEntries.map(function (entry) {
          var ev = entry.event;
          var left = timeMap ? timeMap.toPosition(ev.t) * 100 : (totalTime > 0 ? (ev.t / totalTime) * 100 : 0);
          var width = Math.max(0.3, timeMap ? (timeMap.toPosition(ev.t + ev.duration) - timeMap.toPosition(ev.t)) * 100 : (totalTime > 0 ? (ev.duration / totalTime) * 100 : 1));
          var info = TRACK_TYPES[ev.track];
          var color = ev.isError ? theme.error : (info ? info.color : theme.text.muted);
          var isMatch = matchSet && matchSet.has(entry.index);
          return (
            <div key={entry.index} style={{
              position: "absolute",
              left: left + "%",
              width: width + "%",
              top: 2,
              bottom: 2,
              background: color,
              opacity: isMatch ? 0.9 : (ev.isError ? 0.7 : ev.intensity * 0.4),
              borderRadius: 2,
              boxShadow: isMatch ? "0 0 4px " + theme.accent.cyan : (ev.isError ? "0 0 4px " + theme.error : "none"),
            }} />
          );
        })}
        <div style={{
          position: "absolute",
          left: pct + "%",
          top: 0,
          bottom: 0,
          width: 2,
          background: theme.accent.cyan,
          boxShadow: "0 0 8px " + theme.accent.cyan,
          transition: "left 0.08s linear",
          zIndex: 2,
        }} />
      </div>
    </div>
  );
}
