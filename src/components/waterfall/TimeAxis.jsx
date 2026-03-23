import { theme } from "../../lib/theme.js";
import { formatTime } from "../../lib/formatTime.js";
import { getWaterfallLeft, WATERFALL_TIME_AXIS_HEIGHT } from "./constants.js";

export default function TimeAxis({ totalTime, timeMap }) {
  if (totalTime <= 0) return null;

  var displayTotal = timeMap && timeMap.hasCompression ? timeMap.displayTotal : totalTime;
  var rawInterval = displayTotal / 8;
  var niceIntervals = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  var interval = niceIntervals[0];

  for (var i = 0; i < niceIntervals.length; i++) {
    if (niceIntervals[i] >= rawInterval) {
      interval = niceIntervals[i];
      break;
    }
  }

  var ticks = [];
  for (var t = 0; t <= displayTotal; t += interval) {
    ticks.push(t);
  }

  return (
    <div style={{
      height: WATERFALL_TIME_AXIS_HEIGHT,
      position: "relative",
      borderBottom: "1px solid " + theme.border.default,
      flexShrink: 0,
    }}>
      {ticks.map(function (tick) {
        var frac = displayTotal > 0 ? tick / displayTotal : 0;
        var realTime = timeMap && timeMap.hasCompression ? timeMap.toTime(frac) : tick;
        return (
          <div key={tick} style={{
            position: "absolute",
            left: getWaterfallLeft(frac),
            top: 0,
            bottom: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}>
            <div style={{
              width: 1,
              flex: 1,
              background: theme.border.subtle,
            }} />
            <span style={{
              fontSize: theme.fontSize.xs,
              color: theme.text.dim,
              padding: "0 2px",
              whiteSpace: "nowrap",
            }}>
              {formatTime(realTime)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
