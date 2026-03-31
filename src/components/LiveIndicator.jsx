import { theme, alpha } from "../lib/theme.js";

/**
 * Pulsing green "LIVE" badge shown when streaming from the CLI server.
 */
export default function LiveIndicator() {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 4,
      padding: "2px 8px",
      borderRadius: theme.radius.md,
      background: alpha(theme.semantic.success, 0.08),
      border: "1px solid " + alpha(theme.semantic.success, 0.3),
    }}>
      <div style={{
        width: 6,
        height: 6,
        borderRadius: theme.radius.full,
        background: theme.semantic.success,
        animation: "pulse 1.4s ease-in-out infinite",
        flexShrink: 0,
      }} />
      <span style={{
        fontSize: theme.fontSize.xs,
        fontFamily: theme.font.mono,
        color: theme.semantic.success,
        letterSpacing: 1,
      }}>
        LIVE
      </span>
    </div>
  );
}
