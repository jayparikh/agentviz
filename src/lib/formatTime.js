// Shared time/duration formatting helpers used across views.

// Formats a duration in seconds as a human-readable short string.
// Used in Waterfall bars and inspector panels.
export function formatDuration(seconds) {
  if (seconds == null || seconds === 0) return "--";
  if (seconds < 0.01) return "<10ms";
  if (seconds < 1) return (seconds * 1000).toFixed(0) + "ms";
  if (seconds < 60) return seconds.toFixed(1) + "s";
  return (seconds / 60).toFixed(1) + "m";
}

// Formats a time offset in seconds as a clock-style string (m:ss or Xs).
// Used in timeline axes and time labels.
export function formatTime(seconds) {
  if (seconds == null) return "--";
  if (seconds < 60) return seconds.toFixed(1) + "s";
  var m = Math.floor(seconds / 60);
  var s = (seconds % 60).toFixed(0);
  return m + ":" + (s < 10 ? "0" : "") + s;
}

// Formats a duration in seconds as "Xm Ys" for summary stats panels.
export function formatDurationLong(secs) {
  if (!secs) return "--";
  var m = Math.floor(secs / 60);
  var s = Math.round(secs % 60);
  return m > 0 ? m + "m " + (s < 10 ? "0" : "") + s + "s" : s + "s";
}
