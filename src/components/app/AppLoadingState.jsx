import { theme } from "../../lib/theme.js";

export default function AppLoadingState() {
  return (
    <div style={{
      width: "100%",
      height: "100vh",
      background: theme.bg.base,
      color: theme.text.primary,
      fontFamily: theme.font.ui,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 20,
    }}>
      <div style={{
        width: 40,
        height: 40,
        border: "3px solid " + theme.border.default,
        borderTopColor: theme.accent.primary,
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }} />
      <div style={{ fontSize: theme.fontSize.md, color: theme.text.muted, letterSpacing: 1 }}>
        Parsing session...
      </div>
    </div>
  );
}
