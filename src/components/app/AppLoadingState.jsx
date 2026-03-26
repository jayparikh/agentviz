import { theme } from "../../lib/theme.js";
import ShellFrame from "../ui/ShellFrame.jsx";

export default function AppLoadingState() {
  return (
    <ShellFrame
      fontFamily={theme.font.ui}
      style={{
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
      }}
    >
      <div style={{
        width: 40,
        height: 40,
        border: "3px solid " + theme.border.default,
        borderTopColor: theme.accent.primary,
        borderRadius: theme.radius.full,
        animation: "spin 0.8s linear infinite",
      }} />
      <div style={{ fontSize: theme.fontSize.md, color: theme.text.muted, letterSpacing: 1 }}>
        Parsing session...
      </div>
    </ShellFrame>
  );
}
