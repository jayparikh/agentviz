import { useRef, useMemo } from "react";
import { theme, TRACK_TYPES } from "../lib/theme.js";
import Icon from "./Icon.jsx";
import ToolbarSelect from "./ui/ToolbarSelect.jsx";
import { PLAYBACK_SPEEDS } from "../lib/playbackUtils.js";
import useReducedMotion from "../hooks/useReducedMotion.js";

var TIMELINE_BINS = 200;

function getTimelineEventColor(ev) {
  var info = TRACK_TYPES[ev.track];
  if (ev.isError) return theme.semantic.error;
  if (ev.track === "agent" && ev.agentName) return theme.agentType[ev.agentName] || theme.agentType.default;
  return info ? info.color : theme.text.muted;
}

export function buildTimelineBins(eventEntries, totalTime, timeMap, matchSet) {
  var bins = [];
  for (var b = 0; b < TIMELINE_BINS; b++) {
    bins.push({ intensity: 0, isError: false, isMatch: false, color: null, count: 0 });
  }

  for (var i = 0; i < eventEntries.length; i++) {
    var ev = eventEntries[i].event;
    var startPos = timeMap ? timeMap.toPosition(ev.t) : (totalTime > 0 ? ev.t / totalTime : 0);
    var endPos = timeMap ? timeMap.toPosition(ev.t + ev.duration) : (totalTime > 0 ? (ev.t + ev.duration) / totalTime : startPos);
    var startBin = Math.min(TIMELINE_BINS - 1, Math.max(0, Math.floor(startPos * TIMELINE_BINS)));
    var endBin = Math.min(TIMELINE_BINS - 1, Math.max(startBin, Math.floor(endPos * TIMELINE_BINS)));
    var color = getTimelineEventColor(ev);

    for (var bin = startBin; bin <= endBin; bin++) {
      bins[bin].count++;
      bins[bin].intensity = Math.max(bins[bin].intensity, ev.intensity || 0.3);
      if (ev.isError) bins[bin].isError = true;
      if (matchSet && matchSet.has(eventEntries[i].index)) bins[bin].isMatch = true;
      if (!bins[bin].color) bins[bin].color = color;
    }
  }

  return bins;
}

export default function Timeline({ currentTime, totalTime, timeMap, onSeek, isPlaying, onPlayPause, isLive, eventEntries, turns, matchSet, speed, onSetSpeed }) {
  var barRef = useRef(null);
  var reducedMotion = useReducedMotion();

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

  var currentTurn = useMemo(function () {
    if (!turns || turns.length === 0) return null;
    var lo = 0, hi = turns.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (currentTime < turns[mid].startTime) hi = mid - 1;
      else if (currentTime > turns[mid].endTime) lo = mid + 1;
      else return turns[mid];
    }
    return turns[turns.length - 1];
  }, [currentTime, turns]);

  var themeMode = theme.mode;

  // Memoize bin calculation -- depends only on event data, not currentTime,
  // so it avoids re-running O(events) work on each playback tick.
  var bins = useMemo(function () {
    if (eventEntries.length <= TIMELINE_BINS) return null;
    return buildTimelineBins(eventEntries, totalTime, timeMap, matchSet);
  }, [eventEntries, totalTime, timeMap, matchSet, themeMode]);

  return (
    <div style={{ paddingBottom: theme.space.md }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 6 }}>
        {!isLive && (
          <button
            onClick={onPlayPause}
            aria-label={isPlaying ? "Pause playback" : "Play playback"}
            style={{
              background: "none",
              border: "1px solid " + theme.border.strong,
              borderRadius: theme.radius.lg,
              color: theme.text.primary,
              cursor: "pointer",
              padding: "4px 12px",
              fontSize: theme.fontSize.lg,
              fontFamily: theme.font.mono,
              letterSpacing: 1,
            }}
          >
            {isPlaying ? <Icon name="pause" size={14} /> : <Icon name="play" size={14} />}
          </button>
        )}
        {!isLive && onSetSpeed && (
          <ToolbarSelect ariaLabel="Playback speed" value={speed} placement="top" menuWidth={120}
            onChange={function (value) { onSetSpeed(Number(value)); }}
            options={PLAYBACK_SPEEDS.map(function (value) { return { id: value, label: value + "x" }; })} />
        )}
        <span style={{ fontFamily: theme.font.mono, fontSize: theme.fontSize.md, color: theme.text.secondary, letterSpacing: 1 }}>
          {isLive ? totalTime.toFixed(1) + "s" : currentTime.toFixed(1) + "s / " + totalTime.toFixed(1) + "s"}
        </span>
        {currentTurn && (
            <span style={{ fontSize: theme.fontSize.xs, color: theme.text.dim, display: "flex", alignItems: "center", gap: 4 }}>
              Turn {currentTurn.index + 1}/{turns.length}
              {currentTurn.hasError && <span style={{ color: theme.semantic.error }}><Icon name="alert-circle" size={11} /></span>}
            </span>
          )}
        <div style={{ flex: 1 }} />
        {Object.keys(counts).map(function (track) {
          var info = TRACK_TYPES[track];
          if (!info) return null;
          return (
            <span key={track} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: theme.fontSize.base, color: theme.text.muted }}>
              <span style={{ color: info.color }}><Icon name={track} size={12} /></span>
              {counts[track]}
            </span>
          );
        })}
      </div>
      <div
        ref={barRef}
        onClick={handleClick}
        role="slider"
        tabIndex={0}
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={totalTime}
        aria-valuenow={currentTime}
        aria-valuetext={currentTime.toFixed(1) + " seconds of " + totalTime.toFixed(1)}
        onKeyDown={function (event) {
          if (event.metaKey || event.ctrlKey || event.altKey) return;
          var position = timeMap ? timeMap.toPosition(currentTime) : (totalTime ? currentTime / totalTime : 0);
          if (event.key === "Home") position = 0;
          else if (event.key === "End") position = 1;
          else if (event.key === "ArrowRight" || event.key === "ArrowUp") position += 0.01;
          else if (event.key === "ArrowLeft" || event.key === "ArrowDown") position -= 0.01;
          else return;
          event.preventDefault();
          event.stopPropagation();
          position = Math.max(0, Math.min(1, position));
          onSeek(timeMap ? timeMap.toTime(position) : position * totalTime);
        }}
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
              zIndex: theme.z.base,
              opacity: 0.6,
            }} />
          );
        })}
        {bins ? (function () {
          var result = [];
          for (var j = 0; j < TIMELINE_BINS; j++) {
            if (bins[j].count === 0) continue;
            var binData = bins[j];
            var left = (j / TIMELINE_BINS) * 100;
            var width = Math.max(0.3, 100 / TIMELINE_BINS);
            var color = binData.isError ? theme.semantic.error : (binData.color || theme.text.muted);
            result.push(
              <div key={"bin-" + j} style={{
                position: "absolute",
                left: left + "%",
                width: width + "%",
                top: 2,
                bottom: 2,
                background: color,
                opacity: binData.isMatch ? 0.9 : (binData.isError ? 0.7 : Math.max(0.5, binData.intensity * 0.8)),
                borderRadius: theme.radius.sm,
                boxShadow: "none",
              }} />
            );
          }
          return result;
        })() : eventEntries.map(function (entry) {
          var ev = entry.event;
          var left = timeMap ? timeMap.toPosition(ev.t) * 100 : (totalTime > 0 ? (ev.t / totalTime) * 100 : 0);
          var width = Math.max(0.3, timeMap ? (timeMap.toPosition(ev.t + ev.duration) - timeMap.toPosition(ev.t)) * 100 : (totalTime > 0 ? (ev.duration / totalTime) * 100 : 1));
          var color = getTimelineEventColor(ev);
          var isMatch = matchSet && matchSet.has(entry.index);
          return (
            <div key={entry.index} style={{
              position: "absolute",
              left: left + "%",
              width: width + "%",
              top: 2,
              bottom: 2,
              background: color,
              opacity: isMatch ? 0.9 : (ev.isError ? 0.7 : Math.max(0.5, ev.intensity * 0.8)),
              borderRadius: theme.radius.sm,
              boxShadow: "none",
            }} />
          );
        })}
        <div style={{
          position: "absolute",
          left: pct + "%",
          top: 0,
          bottom: 0,
          width: 2,
          background: theme.accent.primary,
          boxShadow: "none",
          transition: reducedMotion ? "none" : "left 0.08s linear",
          zIndex: theme.z.active,
        }} />
      </div>
    </div>
  );
}
