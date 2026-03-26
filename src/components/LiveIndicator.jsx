import { theme } from "../lib/theme.js";

/**
 * Pulsing green "LIVE" badge shown when streaming from the CLI server.
 */
export default function LiveIndicator() {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 5,
      padding: "2px 8px",
      borderRadius: theme.radius.md,
      background: "rgba(52, 211, 153, 0.08)",
      border: "1px solid rgba(52, 211, 153, 0.3)",
    }}>
      <div style={{
        width: 6,
        height: 6,
        borderRadius: theme.radius.full,
        background: "#34d399",
        animation: "pulse 1.4s ease-in-out infinite",
        flexShrink: 0,
      }} />
      <span style={{
        fontSize: theme.fontSize.xs,
        fontFamily: theme.font.ui,
        color: "#34d399",
        letterSpacing: 1,
      }}>
        LIVE
      </span>
    </div>
  );
}
