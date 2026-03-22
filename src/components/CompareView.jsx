import { useState, useMemo } from "react";
import { theme, alpha } from "../lib/theme.js";
import { estimateCost, formatCost } from "../lib/pricing.js";

function formatDuration(secs) {
  if (!secs) return "--";
  var m = Math.floor(secs / 60);
  var s = Math.round(secs % 60);
  return m > 0 ? m + "m " + (s < 10 ? "0" : "") + s + "s" : s + "s";
}

function fmt(n) {
  if (n == null || n === 0) return "--";
  return n.toLocaleString();
}

function getFilesTouched(events) {
  var paths = new Set();
  if (!events) return 0;
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (ev.track === "tool_call" && ev.toolInput) {
      var p = ev.toolInput.path || ev.toolInput.file_path || ev.toolInput.filepath;
      if (p && typeof p === "string") paths.add(p);
    }
  }
  return paths.size;
}

function getToolCounts(events) {
  var counts = {};
  if (!events) return counts;
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (ev.track === "tool_call" && ev.toolName) {
      counts[ev.toolName] = (counts[ev.toolName] || 0) + 1;
    }
  }
  return counts;
}

function buildMetrics(session) {
  var meta = session.metadata || {};
  var tu = meta.tokenUsage || {};
  return {
    model: meta.primaryModel || null,
    duration: session.total || 0,
    cost: estimateCost(tu, meta.primaryModel),
    inputTokens: tu.inputTokens || 0,
    outputTokens: tu.outputTokens || 0,
    cacheRead: tu.cacheRead || 0,
    cacheWrite: tu.cacheWrite || 0,
    toolCalls: meta.totalToolCalls || 0,
    errors: meta.errorCount || 0,
    turns: meta.totalTurns || 0,
    filesTouched: getFilesTouched(session.events),
    toolCounts: getToolCounts(session.events),
  };
}

// Delta badge: pct change of A relative to B.
// lowerIsBetter=true  -> negative pct is green (A wins)
// lowerIsBetter=null  -> always grey (neutral)
function DeltaBadge({ a, b, lowerIsBetter }) {
  if (!a && !b) return <span style={{ color: theme.text.ghost }}>--</span>;
  if (!b) return <span style={{ color: theme.text.ghost }}>--</span>;
  var pct = Math.round(((a - b) / b) * 100);
  var sign = pct > 0 ? "+" : "";
  var color = theme.text.muted;
  if (lowerIsBetter === true) {
    if (pct < 0) color = theme.semantic.success;
    else if (pct > 0) color = theme.semantic.error;
  }
  return (
    <span style={{ fontFamily: theme.font.mono, fontSize: theme.fontSize.base, color }}>
      {sign}{pct}%
    </span>
  );
}

var COL = { label: "180px", val: "1fr", delta: "80px" };

function Row({ label, valA, valB, a, b, lowerIsBetter, indent }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: COL.label + " " + COL.val + " " + COL.val + " " + COL.delta,
      alignItems: "center",
      padding: "9px " + (indent ? "10px 9px 26px" : "10px"),
      borderBottom: "1px solid " + theme.border.subtle,
    }}>
      <span style={{
        fontSize: theme.fontSize.base,
        color: indent ? theme.text.dim : theme.text.muted,
        fontFamily: theme.font.ui,
        paddingLeft: indent ? 12 : 0,
      }}>
        {label}
      </span>
      <span style={{ fontSize: theme.fontSize.base, color: theme.text.primary, fontFamily: theme.font.mono }}>
        {valA}
      </span>
      <span style={{ fontSize: theme.fontSize.base, color: theme.text.primary, fontFamily: theme.font.mono }}>
        {valB}
      </span>
      <DeltaBadge a={a} b={b} lowerIsBetter={lowerIsBetter} />
    </div>
  );
}

function Scorecard({ mA, mB, fileA, fileB }) {
  var cacheAvailable = mA.cacheRead > 0 || mB.cacheRead > 0;

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      {/* Column headers */}
      <div style={{
        display: "grid",
        gridTemplateColumns: COL.label + " " + COL.val + " " + COL.val + " " + COL.delta,
        padding: "8px 10px 10px",
        borderBottom: "1px solid " + theme.border.strong,
        position: "sticky", top: 0,
        background: theme.bg.base,
        zIndex: 1,
      }}>
        <span />
        <span style={{
          fontSize: theme.fontSize.sm, color: theme.accent.primary,
          fontFamily: theme.font.mono, letterSpacing: 0.3,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          paddingRight: 12,
        }}>
          A: {fileA}
        </span>
        <span style={{
          fontSize: theme.fontSize.sm, color: "#a78bfa",
          fontFamily: theme.font.mono, letterSpacing: 0.3,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          paddingRight: 12,
        }}>
          B: {fileB}
        </span>
        <span style={{ fontSize: theme.fontSize.xs, color: theme.text.ghost, fontFamily: theme.font.ui }}>
          A vs B
        </span>
      </div>

      {/* Model */}
      <div style={{
        display: "grid",
        gridTemplateColumns: COL.label + " " + COL.val + " " + COL.val + " " + COL.delta,
        alignItems: "center",
        padding: "9px 10px",
        borderBottom: "1px solid " + theme.border.subtle,
      }}>
        <span style={{ fontSize: theme.fontSize.base, color: theme.text.muted, fontFamily: theme.font.ui }}>Model</span>
        <span style={{ fontSize: theme.fontSize.base, color: theme.text.secondary, fontFamily: theme.font.mono }}>
          {mA.model || "Unknown"}
        </span>
        <span style={{ fontSize: theme.fontSize.base, color: theme.text.secondary, fontFamily: theme.font.mono }}>
          {mB.model || "Unknown"}
        </span>
        <span />
      </div>

      <Row label="Duration"     valA={formatDuration(mA.duration)}    valB={formatDuration(mB.duration)}    a={mA.duration}    b={mB.duration}    lowerIsBetter={true} />
      <Row label="Effective cost" valA={formatCost(mA.cost)}          valB={formatCost(mB.cost)}            a={mA.cost}        b={mB.cost}        lowerIsBetter={true} />
      <Row label="Input tokens"  valA={fmt(mA.inputTokens)}           valB={fmt(mB.inputTokens)}            a={mA.inputTokens} b={mB.inputTokens} lowerIsBetter={null} />
      {cacheAvailable && (
        <Row label="Cache reads"  valA={mA.cacheRead ? fmt(mA.cacheRead) : "N/A"} valB={mB.cacheRead ? fmt(mB.cacheRead) : "N/A"} a={mA.cacheRead} b={mB.cacheRead} lowerIsBetter={null} indent />
      )}
      {cacheAvailable && (
        <Row label="Cache writes" valA={mA.cacheWrite ? fmt(mA.cacheWrite) : "N/A"} valB={mB.cacheWrite ? fmt(mB.cacheWrite) : "N/A"} a={mA.cacheWrite} b={mB.cacheWrite} lowerIsBetter={null} indent />
      )}
      <Row label="Output tokens" valA={fmt(mA.outputTokens)}          valB={fmt(mB.outputTokens)}           a={mA.outputTokens} b={mB.outputTokens} lowerIsBetter={null} />
      <Row label="Tool calls"    valA={fmt(mA.toolCalls)}              valB={fmt(mB.toolCalls)}              a={mA.toolCalls}   b={mB.toolCalls}   lowerIsBetter={null} />
      <Row label="Errors"        valA={fmt(mA.errors) === "--" ? "0" : fmt(mA.errors)} valB={fmt(mB.errors) === "--" ? "0" : fmt(mB.errors)} a={mA.errors} b={mB.errors} lowerIsBetter={true} />
      <Row label="Turns"         valA={fmt(mA.turns)}                  valB={fmt(mB.turns)}                  a={mA.turns}       b={mB.turns}       lowerIsBetter={null} />
      <Row label="Files touched" valA={fmt(mA.filesTouched)}           valB={fmt(mB.filesTouched)}           a={mA.filesTouched} b={mB.filesTouched} lowerIsBetter={null} />
    </div>
  );
}

var BAR_MAX_W = 180;

function ToolsChart({ mA, mB, fileA, fileB }) {
  var rows = useMemo(function () {
    var all = new Set([
      ...Object.keys(mA.toolCounts),
      ...Object.keys(mB.toolCounts),
    ]);
    return Array.from(all)
      .map(function (name) {
        var a = mA.toolCounts[name] || 0;
        var b = mB.toolCounts[name] || 0;
        return { name, a, b, total: a + b };
      })
      .sort(function (x, y) { return y.total - x.total; });
  }, [mA.toolCounts, mB.toolCounts]);

  var maxCount = useMemo(function () {
    return rows.reduce(function (m, r) { return Math.max(m, r.a, r.b); }, 1);
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div style={{ padding: 32, color: theme.text.muted, fontSize: theme.fontSize.base, fontFamily: theme.font.ui }}>
        No tool calls found in either session.
      </div>
    );
  }

  return (
    <div style={{ overflowY: "auto", flex: 1, padding: "4px 0" }}>
      {/* Legend */}
      <div style={{ display: "flex", gap: 16, padding: "8px 10px 14px", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: theme.accent.primary }} />
          <span style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, fontFamily: theme.font.mono }}>
            A: {fileA}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: "#a78bfa" }} />
          <span style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, fontFamily: theme.font.mono }}>
            B: {fileB}
          </span>
        </div>
      </div>

      {rows.map(function (row) {
        var wA = Math.round((row.a / maxCount) * BAR_MAX_W);
        var wB = Math.round((row.b / maxCount) * BAR_MAX_W);
        return (
          <div key={row.name} style={{
            display: "grid",
            gridTemplateColumns: "140px 1fr",
            alignItems: "center",
            gap: 12,
            padding: "6px 10px",
            borderBottom: "1px solid " + theme.border.subtle,
          }}>
            <span style={{
              fontSize: theme.fontSize.base, color: theme.text.secondary,
              fontFamily: theme.font.mono, textAlign: "right",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {row.name}
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {/* Bar A */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{
                  width: wA || 2, height: 10, borderRadius: 2,
                  background: row.a > 0 ? theme.accent.primary : theme.border.default,
                  transition: "width 200ms ease-out",
                }} />
                <span style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, fontFamily: theme.font.mono }}>
                  {row.a || "--"}
                </span>
              </div>
              {/* Bar B */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{
                  width: wB || 2, height: 10, borderRadius: 2,
                  background: row.b > 0 ? "#a78bfa" : theme.border.default,
                  transition: "width 200ms ease-out",
                }} />
                <span style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, fontFamily: theme.font.mono }}>
                  {row.b || "--"}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

var TABS = [
  { id: "scorecard", label: "Scorecard" },
  { id: "tools", label: "Tools" },
];

export default function CompareView({ sessionA, sessionB }) {
  var [tab, setTab] = useState("scorecard");

  var mA = useMemo(function () { return buildMetrics(sessionA); }, [sessionA]);
  var mB = useMemo(function () { return buildMetrics(sessionB); }, [sessionB]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Sub-nav */}
      <div style={{
        display: "flex", gap: 2, flexShrink: 0,
        background: theme.bg.surface, borderRadius: theme.radius.lg,
        padding: 2, alignSelf: "flex-start", marginBottom: 12,
      }}>
        {TABS.map(function (t) {
          var active = tab === t.id;
          return (
            <button
              key={t.id}
              className="av-btn"
              onClick={function () { setTab(t.id); }}
              style={{
                background: active ? theme.bg.raised : "transparent",
                border: "none", borderRadius: theme.radius.md,
                color: active ? theme.accent.primary : theme.text.muted,
                padding: "4px 14px",
                fontSize: theme.fontSize.base,
                fontFamily: theme.font.ui,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={{
        flex: 1, minHeight: 0, overflow: "hidden",
        background: theme.bg.surface, borderRadius: theme.radius.lg,
        border: "1px solid " + theme.border.default,
        display: "flex", flexDirection: "column",
      }}>
        {tab === "scorecard" && <Scorecard mA={mA} mB={mB} fileA={sessionA.file} fileB={sessionB.file} />}
        {tab === "tools" && <ToolsChart mA={mA} mB={mB} fileA={sessionA.file} fileB={sessionB.file} />}
      </div>
    </div>
  );
}
