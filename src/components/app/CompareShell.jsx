import { theme } from "../../lib/theme.js";
import CompareView from "../CompareView.jsx";
import BrandWordmark from "../ui/BrandWordmark.jsx";
import ExportStatusButton from "../ui/ExportStatusButton.jsx";
import ShellFrame from "../ui/ShellFrame.jsx";
import ToolbarButton from "../ui/ToolbarButton.jsx";

export default function CompareShell({
  sessionA,
  sessionB,
  onExitCompare,
  onExportComparison,
  exportState,
  exportError,
  onOpenSessionA,
  onOpenSessionB,
}) {
  return (
    <ShellFrame>
      <div style={{
        padding: "8px 16px", display: "flex", alignItems: "center", gap: 10,
        borderBottom: "1px solid " + theme.border.default, flexShrink: 0,
      }}>
        <BrandWordmark />
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
          <ExportStatusButton
            state={exportState}
            error={exportError}
            onClick={onExportComparison}
            padding="2px 10px"
          />
          <ToolbarButton onClick={onExitCompare} style={{ padding: "2px 12px" }}>
            Exit comparison
          </ToolbarButton>
        </div>
      </div>

      <div style={{ flex: 1, padding: "12px 20px 16px", minHeight: 0, overflow: "hidden" }}>
        <CompareView
          sessionA={sessionA}
          sessionB={sessionB}
          onOpenSessionA={onOpenSessionA}
          onOpenSessionB={onOpenSessionB}
        />
      </div>
    </ShellFrame>
  );
}
