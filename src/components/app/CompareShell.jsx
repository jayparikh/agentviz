import { alpha, theme } from "../../lib/theme.js";
import CompareView from "../CompareView.jsx";
import Icon from "../Icon.jsx";

export default function CompareShell({
  sessionA,
  sessionB,
  onExitCompare,
  onExportComparison,
  exportState,
  exportError,
}) {
  return (
    <div style={{
      width: "100%", height: "100vh", background: theme.bg.base,
      color: theme.text.primary, fontFamily: theme.font.mono,
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div style={{
        padding: "8px 16px", display: "flex", alignItems: "center", gap: 10,
        borderBottom: "1px solid " + theme.border.default, flexShrink: 0,
      }}>
        <span style={{
          fontSize: theme.fontSize.lg, fontWeight: 600, fontFamily: theme.font.ui,
          letterSpacing: "-0.5px", color: theme.text.primary,
        }}>
          AGENTVIZ<span style={{ color: theme.accent.primary }}>.</span>
        </span>
        <div style={{ height: 16, width: 1, background: theme.border.default }} />
        <span style={{ fontSize: theme.fontSize.base, color: theme.accent.primary, fontFamily: theme.font.mono,
          maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sessionA.file}
        </span>
        <span style={{ fontSize: theme.fontSize.base, color: theme.text.ghost, fontFamily: theme.font.ui }}>vs</span>
        <span style={{ fontSize: theme.fontSize.base, color: "#a78bfa", fontFamily: theme.font.mono,
          maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sessionB.file}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {exportError && (
            <span style={{ fontSize: theme.fontSize.xs, color: theme.semantic.error, maxWidth: 240, fontFamily: theme.font.ui }}>
              {exportError}
            </span>
          )}
          <button
            className="av-btn"
            onClick={onExportComparison}
            disabled={exportState === "loading"}
            title={exportState === "error" ? exportError : "Export as self-contained HTML"}
            style={{
              background: exportState === "done" ? alpha(theme.semantic.success, 0.1)
                : exportState === "error" ? alpha(theme.semantic.error, 0.1)
                : "transparent",
              border: "1px solid " + (
                exportState === "done" ? theme.semantic.success
                : exportState === "error" ? theme.semantic.error
                : theme.border.default
              ),
              color: exportState === "done" ? theme.semantic.success
                : exportState === "error" ? theme.semantic.error
                : theme.text.muted,
              borderRadius: theme.radius.md,
              padding: "2px 10px", fontSize: theme.fontSize.sm, fontFamily: theme.font.ui,
              display: "flex", alignItems: "center", gap: 4,
              opacity: exportState === "loading" ? 0.6 : 1,
              cursor: exportState === "loading" ? "default" : "pointer",
            }}
          >
            <Icon name="download" size={12} />
            {exportState === "loading" ? "Exporting..."
              : exportState === "done" ? "Exported!"
              : exportState === "error" ? "Failed"
              : "Export"}
          </button>
          <button
            className="av-btn"
            onClick={onExitCompare}
            style={{
              background: "transparent", border: "1px solid " + theme.border.default,
              borderRadius: theme.radius.md, color: theme.text.muted,
              padding: "2px 12px", fontSize: theme.fontSize.sm, fontFamily: theme.font.ui,
            }}
          >
            Exit comparison
          </button>
        </div>
      </div>

      <div style={{ flex: 1, padding: "12px 20px 16px", minHeight: 0, overflow: "hidden" }}>
        <CompareView
          sessionA={sessionA}
          sessionB={sessionB}
        />
      </div>
    </div>
  );
}
