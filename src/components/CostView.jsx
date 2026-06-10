import { useMemo } from "react";
import { theme, alpha } from "../lib/theme.js";
import { buildCostAnalysis, formatTokens } from "../lib/costAnalysis.js";
import { formatCost, formatCostValue, isAiCreditsUnit } from "../lib/pricing.js";

var SUMMARY_GRID_5_COLUMNS = "1.15fr repeat(4, minmax(150px, 0.6fr))";
var MAIN_GRID_3_COLUMNS = "minmax(310px, 0.9fr) minmax(360px, 1fr) minmax(360px, 1fr)";

function panelStyle() {
  return {
    background: theme.bg.surface,
    border: "1px solid " + theme.border.default,
    borderRadius: theme.radius.xl,
    overflow: "hidden",
    minWidth: 0,
  };
}

function labelStyle() {
  return {
    fontSize: theme.fontSize.xs,
    color: theme.text.dim,
    textTransform: "uppercase",
    letterSpacing: "0.14em",
    fontWeight: 700,
  };
}

function SummaryCard({ label, value, sub, color, valueSize }) {
  return (
    <div style={Object.assign({}, panelStyle(), { padding: theme.space.lg + "px " + theme.space.xl + "px" })}>
      <div style={labelStyle()}>{label}</div>
      <div style={{ fontSize: valueSize || theme.fontSize.xxl, color: color || theme.text.primary, fontWeight: 800, marginTop: theme.space.md, whiteSpace: "nowrap" }}>{value}</div>
      {sub && <div style={{ color: theme.text.muted, fontSize: theme.fontSize.sm, marginTop: theme.space.sm, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
    </div>
  );
}

function Panel({ label, title, aside, children }) {
  return (
    <div style={Object.assign({}, panelStyle(), { display: "flex", flexDirection: "column", minHeight: 0 })}>
      <div style={{ height: 48, borderBottom: "1px solid " + theme.border.default, padding: theme.space.md + "px " + theme.space.lg + "px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: theme.space.lg, flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={labelStyle()}>{label}</div>
          <div style={{ color: theme.text.primary, fontSize: theme.fontSize.base, fontWeight: 800, marginTop: theme.space.xs, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        </div>
        {aside && <div style={{ color: theme.text.muted, fontSize: theme.fontSize.xs, flexShrink: 0 }}>{aside}</div>}
      </div>
      {children}
    </div>
  );
}

function maxCallValue(calls, pick) {
  return Math.max(1, ...calls.map(pick));
}

function BarSegments({ segments, max, height }) {
  var total = segments.reduce(function (sum, segment) { return sum + Math.max(0, segment.value || 0); }, 0);
  var width = Math.max(4, Math.min(100, (total / Math.max(max, 1)) * 100));
  return (
      <div style={{ height: height || 32, border: "1px solid " + theme.border.default, borderRadius: theme.radius.lg, background: theme.bg.base, overflow: "hidden", display: "flex", width: width + "%", minWidth: theme.space.md }}>
      {segments.map(function (segment) {
        var pct = total > 0 ? (Math.max(0, segment.value || 0) / total) * 100 : 0;
        if (pct <= 0) return null;
        return <div key={segment.key} title={segment.label + ": " + formatTokens(segment.value)} style={{ width: pct + "%", background: segment.color, minWidth: pct > 0 ? 2 : 0 }} />;
      })}
    </div>
  );
}

function Legend({ items }) {
  return (
    <div style={{ padding: theme.space.md + "px " + theme.space.lg + "px 0", color: theme.text.muted, fontSize: theme.fontSize.xs, display: "flex", gap: theme.space.lg, flexWrap: "wrap" }}>
      {items.map(function (item) {
        return <span key={item.label}><span style={{ display: "inline-block", width: theme.space.md, height: theme.space.md, borderRadius: "50%", background: item.color, marginRight: theme.space.sm }} />{item.label}</span>;
      })}
    </div>
  );
}

function CallRow({ call, miss }) {
  var tokenParts = [
    formatTokens(call.freshInputTokens) + " fresh",
    formatTokens(call.cachedInputTokens) + " cached",
  ];
  if ((call.cacheWriteTokens || 0) > 0) tokenParts.push(formatTokens(call.cacheWriteTokens) + " write");
  tokenParts.push(formatTokens(call.outputTokens) + " out");

  return (
    <div style={{
      border: "1px solid " + (miss ? alpha(theme.semantic.warning, 0.55) : theme.border.default),
      background: miss ? "linear-gradient(90deg," + alpha(theme.semantic.warning, 0.10) + "," + theme.bg.surface + " 32%)" : theme.bg.surface,
      borderRadius: theme.radius.lg,
      padding: theme.space.lg,
      display: "grid",
      gridTemplateColumns: "32px 1fr",
      gap: theme.space.md,
      minHeight: 80,
    }}>
      <div style={{ width: 28, height: 28, borderRadius: theme.radius.lg, background: theme.bg.raised, color: theme.text.secondary, display: "grid", placeItems: "center", fontFamily: theme.font.mono, fontSize: theme.fontSize.sm }}>{String(call.index + 1).padStart(2, "0")}</div>
      <div style={{ minWidth: 0 }}>
        <div title={call.title} style={{ color: theme.text.primary, fontSize: theme.fontSize.sm, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{call.title}</div>
        <div style={{ display: "flex", gap: theme.space.sm, flexWrap: "wrap", marginTop: theme.space.md }}>
          <Chip>{call.model}</Chip>
          <Chip>{formatTokens(call.contextBreakdown.total || call.tokenUsage.inputTokens)} ctx</Chip>
          {miss && <Chip warning>cache miss</Chip>}
          <Chip>{formatCostValue(call.cost, call.costUnit)}</Chip>
        </div>
        <div style={{ color: theme.text.muted, fontSize: theme.fontSize.sm, marginTop: theme.space.md, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {tokenParts.join(" · ")}
        </div>
      </div>
    </div>
  );
}

function Chip({ children, warning }) {
  var color = warning ? theme.semantic.warning : theme.text.secondary;
  return <span style={{ fontSize: theme.fontSize.xs, color, border: "1px solid " + (warning ? alpha(theme.semantic.warning, 0.5) : theme.border.default), background: warning ? alpha(theme.semantic.warning, 0.10) : theme.bg.raised, padding: theme.space.xs + "px " + theme.space.md + "px", borderRadius: theme.radius.full, fontFamily: theme.font.mono }}>{children}</span>;
}

function CostBars({ calls, cacheMisses }) {
  var max = maxCallValue(calls, function (call) { return call.freshInputTokens + call.cachedInputTokens + call.cacheWriteTokens; });
  var missByIndex = new Map(cacheMisses.map(function (miss) { return [miss.callIndex, miss]; }));
  var costUnit = calls[0] && calls[0].costUnit;
  var usesCredits = isAiCreditsUnit(costUnit);
  return (
    <Panel label={usesCredits ? "Cumulative AI Credits" : "Cumulative cost"} title={usesCredits ? "Reported AI Credit usage" : "Billed input/output by call"} aside={<span style={{ color: theme.text.primary, fontSize: theme.fontSize.xs, fontFamily: theme.font.mono, border: "1px solid " + alpha(theme.accent.primary, 0.5), background: alpha(theme.accent.primary, 0.12), borderRadius: theme.radius.md, padding: theme.space.sm + "px " + theme.space.md + "px" }}>{usesCredits ? "CREDITS" : "$ BILLED"}</span>}>
      <Legend items={[{ label: "fresh", color: theme.accent.primary }, { label: "cached", color: theme.semantic.success }, { label: "cache write", color: theme.track.context }]} />
      <div style={{ padding: theme.space.lg, overflow: "auto" }}>
        {calls.map(function (call) {
          return (
            <div key={call.index} style={{ minHeight: 72 }}>
              <div style={{ display: "grid", gridTemplateColumns: "56px 1fr 72px", gap: theme.space.md, alignItems: "center", height: theme.space.giant }}>
                <div style={{ color: theme.text.secondary, fontFamily: theme.font.mono, fontSize: theme.fontSize.sm }}>#{String(call.index + 1).padStart(2, "0")}</div>
                <BarSegments max={max} segments={[{ key: "fresh", label: "Fresh input", value: call.freshInputTokens, color: theme.accent.primary }, { key: "cached", label: "Cached input", value: call.cachedInputTokens, color: theme.semantic.success }, { key: "write", label: "Cache write", value: call.cacheWriteTokens, color: theme.track.context }]} />
                <div style={{ textAlign: "right", color: theme.text.primary, fontFamily: theme.font.mono, fontSize: theme.fontSize.sm }}>{formatCostValue(call.cumulativeCost, call.costUnit)}</div>
              </div>
              {missByIndex.has(call.index) && <CacheMissAnnotation miss={missByIndex.get(call.index)} />}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function CacheMissAnnotation({ miss }) {
  var changes = [];
  if (miss && miss.toolDiff) {
    if (miss.toolDiff.added && miss.toolDiff.added.length) changes.push("added " + miss.toolDiff.added.slice(0, 3).join(", "));
    if (miss.toolDiff.removed && miss.toolDiff.removed.length) changes.push("removed " + miss.toolDiff.removed.slice(0, 3).join(", "));
  }
  var fromTokens = formatTokens(miss.previousFreshInputTokens);
  var toTokens = formatTokens(miss.freshInputTokens);
  var toolText = changes.length ? " Tool diff: " + changes.join("; ") + "." : "";
  var message = "Unexpected cache miss on call #" + (miss.callIndex + 1) + ". Fresh input jumped from " + fromTokens + " to " + toTokens + "." + toolText;
  return (
    <div aria-label={message} style={{ border: "1px solid " + alpha(theme.semantic.warning, 0.45), background: alpha(theme.semantic.warning, 0.08), borderRadius: theme.radius.lg, padding: theme.space.md + "px " + theme.space.lg + "px", color: theme.semantic.warning, fontSize: theme.fontSize.sm, fontWeight: 700, lineHeight: 1.35 }}>
      <span>Unexpected cache miss on call #{miss.callIndex + 1}.</span>{" "}
      <span>Fresh input jumped from {fromTokens} to {toTokens}.</span>
      {toolText && <span>{toolText}</span>}
    </div>
  );
}

function ContextBars({ calls }) {
  var max = maxCallValue(calls, function (call) { return call.contextBreakdown.total || call.tokenUsage.inputTokens || 0; });
  return (
    <Panel label="Context window" title="What is filling the prompt" aside="tokens">
      <Legend items={[{ label: "system/tools", color: theme.track.context }, { label: "history", color: theme.accent.primary }, { label: "results", color: theme.semantic.success }, { label: "user", color: theme.agent.user }]} />
      <div style={{ padding: theme.space.lg, overflow: "auto" }}>
        {calls.map(function (call) {
          var b = call.contextBreakdown;
          return (
            <div key={call.index} style={{ display: "grid", gridTemplateColumns: "56px 1fr 48px", gap: theme.space.md, alignItems: "center", minHeight: 80 }}>
              <div style={{ color: theme.text.secondary, fontFamily: theme.font.mono, fontSize: theme.fontSize.sm }}>{formatTokens(b.total || call.tokenUsage.inputTokens)}</div>
              <BarSegments max={max} segments={[{ key: "system", label: "System", value: b.system, color: theme.track.context }, { key: "tools", label: "Tools", value: b.tools, color: theme.track.tool_call }, { key: "history", label: "History", value: b.history, color: theme.accent.primary }, { key: "results", label: "Tool results", value: b.toolResults, color: theme.semantic.success }, { key: "user", label: "User", value: b.user, color: theme.agent.user }]} />
              <div style={{ textAlign: "right", color: theme.text.primary, fontFamily: theme.font.mono, fontSize: theme.fontSize.sm }}>#{String(call.index + 1).padStart(2, "0")}</div>
            </div>
          );
        })}
        <div style={{ border: "1px solid " + theme.border.default, background: theme.bg.surface, borderRadius: theme.radius.lg, padding: theme.space.lg, marginTop: theme.space.sm }}>
          <div style={labelStyle()}>Context growth</div>
          <div style={{ color: theme.text.muted, fontSize: theme.fontSize.sm, marginTop: theme.space.md }}>Use cache-miss warnings to spot tool schema or prompt changes that force cache misses.</div>
        </div>
      </div>
    </Panel>
  );
}

export default function CostView({ events, metadata }) {
  var analysis = useMemo(function () {
    return buildCostAnalysis(events || [], metadata || {});
  }, [events, metadata]);

  if (!analysis.hasCostData) {
    return (
      <div style={{ padding: theme.space.huge, color: theme.text.dim, fontSize: theme.fontSize.md, textAlign: "center" }}>
        <div style={{ fontSize: theme.fontSize.xl, color: theme.text.primary, fontWeight: 800, marginBottom: 8 }}>No token cost data found</div>
        <div>Load a Copilot prompt export or any session with token usage to inspect spend and context buildup.</div>
      </div>
    );
  }

  var calls = analysis.calls;
  var totals = analysis.totals;
  var cachePercent = totals.cacheHitRate ? Math.round(totals.cacheHitRate * 100) : 0;
  var usesCredits = isAiCreditsUnit(totals.costUnit);
  var missByIndex = new Set(analysis.cacheMisses.map(function (miss) { return miss.callIndex; }));

  return (
    <div style={{ padding: theme.space.xl, display: "flex", flexDirection: "column", gap: theme.space.lg, minHeight: 0, height: "100%", overflow: "hidden", fontFamily: theme.font.mono, fontSize: theme.fontSize.base }}>
      <div style={{ display: "grid", gridTemplateColumns: SUMMARY_GRID_5_COLUMNS, gap: theme.space.lg }}>
        <SummaryCard label="Cost view" value="Token spend & context buildup" valueSize={theme.fontSize.lg} sub="Full context, net-new tokens, and billed API usage." />
        <SummaryCard
          label={usesCredits ? "AI Credits" : "Total spend"}
          value={formatCostValue(totals.cost, totals.costUnit)}
          sub={[
            cachePercent + "% cached input",
            usesCredits && totals.estimatedUsdCost > 0 ? "token estimate " + formatCost(totals.estimatedUsdCost) : null,
          ].filter(Boolean).join(" · ")}
        />
        <SummaryCard label="Input tokens" value={formatTokens(totals.inputTokens)} sub={[
          formatTokens(totals.freshInputTokens) + " fresh",
          formatTokens(totals.cacheRead) + " cached",
          totals.cacheWrite > 0 ? formatTokens(totals.cacheWrite) + " write" : null,
        ].filter(Boolean).join(" · ")} />
        <SummaryCard label="Peak context" value={formatTokens(totals.peakContext)} sub="tools + history dominate context" />
        <SummaryCard label="Cache misses" value={analysis.cacheMisses.length} sub="unexpected fresh-token spikes" color={analysis.cacheMisses.length ? theme.semantic.warning : theme.text.primary} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: MAIN_GRID_3_COLUMNS, gap: theme.space.lg, minHeight: 0, flex: 1 }}>
        <Panel label="Prompt & steps" title="Calls in session order" aside="session order">
          <div style={{ padding: theme.space.md, overflow: "auto", display: "flex", flexDirection: "column", gap: theme.space.md }}>
            {calls.map(function (call) { return <CallRow key={call.index} call={call} miss={missByIndex.has(call.index)} />; })}
          </div>
        </Panel>
        <CostBars calls={calls} cacheMisses={analysis.cacheMisses} />
        <ContextBars calls={calls} />
      </div>
    </div>
  );
}
