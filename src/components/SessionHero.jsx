import { theme, TRACK_TYPES, alpha } from "../lib/theme.js";

/**
 * SessionHero - Beautiful summary card shown after loading a session.
 * Displays key metrics with a mini activity sparkline.
 */
export default function SessionHero({ metadata, events, totalTime, timeMap, onDive }) {
  // Build mini sparkline data (30 bins)
  var bins = 30;
  var sparkData = new Array(bins).fill(0);
  if (events && totalTime > 0) {
    for (var i = 0; i < events.length; i++) {
      var pos = timeMap ? timeMap.toPosition(events[i].t) : events[i].t / totalTime;
      var bin = Math.min(bins - 1, Math.floor(pos * bins));
      sparkData[bin] += events[i].intensity || 0.5;
    }
  }
  var maxBin = Math.max.apply(null, sparkData) || 1;

  function formatDuration(s) {
    if (s < 60) return s.toFixed(0) + "s";
    if (s < 3600) return Math.floor(s / 60) + "m " + (Math.floor(s) % 60) + "s";
    return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
  }

  var modelShort = metadata.primaryModel
    ? metadata.primaryModel.split("-").slice(0, 3).join("-")
    : "unknown";

  var stats = [
    { label: "Events", value: metadata.totalEvents, color: theme.text.primary },
    { label: "Turns", value: metadata.totalTurns, color: theme.accent.cyan },
    { label: "Tool Calls", value: metadata.totalToolCalls, color: theme.accent.amber },
    { label: "Duration", value: formatDuration(totalTime), color: theme.accent.purple },
  ];

  if (metadata.errorCount > 0) {
    stats.push({ label: "Errors", value: metadata.errorCount, color: theme.error });
  }

  if (metadata.tokenUsage) {
    var total = metadata.tokenUsage.inputTokens + metadata.tokenUsage.outputTokens;
    stats.push({ label: "Tokens", value: total > 1000 ? (total / 1000).toFixed(1) + "k" : total, color: theme.accent.green });
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100%", gap: 28,
      animation: "fadeIn 0.4s ease",
    }}>
      {/* Format + Model badges */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {metadata.format && (
          <div style={{
            fontSize: theme.fontSize.sm, color: theme.accent.cyan,
            background: alpha(theme.accent.cyan, 0.1),
            border: "1px solid " + alpha(theme.accent.cyan, 0.25),
            padding: "4px 14px", borderRadius: 20, letterSpacing: 1,
          }}>
            {metadata.format === "copilot-cli" ? "Copilot CLI" : metadata.format === "claude-code" ? "Claude Code" : metadata.format}
          </div>
        )}
        <div style={{
          fontSize: theme.fontSize.sm, color: theme.accent.purple,
          background: alpha(theme.accent.purple, 0.1),
          border: "1px solid " + alpha(theme.accent.purple, 0.25),
          padding: "4px 14px", borderRadius: 20, letterSpacing: 1,
        }}>
          {modelShort}
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "center" }}>
        {stats.map(function (s) {
          return (
            <div key={s.label} style={{
              background: theme.bg.surface, borderRadius: theme.radius.xl,
              border: "1px solid " + theme.border.default,
              padding: "16px 24px", textAlign: "center", minWidth: 100,
            }}>
              <div style={{
                fontSize: 28, fontWeight: 700, color: s.color,
                fontFamily: theme.font, lineHeight: 1,
              }}>
                {s.value}
              </div>
              <div style={{ fontSize: theme.fontSize.sm, color: theme.text.dim, marginTop: 6, letterSpacing: 1 }}>
                {s.label.toUpperCase()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sparkline */}
      <div style={{
        display: "flex", alignItems: "flex-end", gap: 2,
        height: 40, padding: "0 20px",
      }}>
        {sparkData.map(function (val, i) {
          var h = Math.max(2, (val / maxBin) * 36);
          var progress = i / bins;
          // Color gradient from cyan to purple across the session
          var color = progress < 0.5
            ? theme.accent.cyan
            : theme.accent.purple;
          return (
            <div key={i} style={{
              width: 8, height: h, borderRadius: 2,
              background: color, opacity: 0.4 + (val / maxBin) * 0.6,
              transition: "height 0.3s ease",
            }} />
          );
        })}
      </div>

      {/* Dive in button */}
      <button onClick={onDive} style={{
        background: "transparent",
        border: "1px solid " + theme.accent.cyan,
        color: theme.accent.cyan, padding: "12px 32px", borderRadius: theme.radius.xl,
        cursor: "pointer", fontSize: theme.fontSize.md, fontFamily: theme.font,
        letterSpacing: 2, fontWeight: 600,
        transition: "all " + theme.transition.smooth,
        boxShadow: theme.shadow.glowSm(alpha(theme.accent.cyan, 0.3)),
      }}
        onMouseEnter={function (e) {
          e.target.style.background = alpha(theme.accent.cyan, 0.1);
          e.target.style.boxShadow = theme.shadow.glow(alpha(theme.accent.cyan, 0.4));
        }}
        onMouseLeave={function (e) {
          e.target.style.background = "transparent";
          e.target.style.boxShadow = theme.shadow.glowSm(alpha(theme.accent.cyan, 0.3));
        }}
      >
        {"\u25B6"} DIVE IN
      </button>

      {/* Keyboard hint */}
      <div style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost }}>
        Press Space or Enter to start
      </div>

      {/* Inject keyframe */}
      <style>{"\
        @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }\
      "}</style>
    </div>
  );
}
