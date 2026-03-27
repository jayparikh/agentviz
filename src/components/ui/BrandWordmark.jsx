import { theme } from "../../lib/theme.js";

export default function BrandWordmark({ onClick, title, style }) {
  var baseStyle = Object.assign({
    fontSize: theme.fontSize.lg,
    fontWeight: 600,
    fontFamily: theme.font.ui,
    letterSpacing: "-0.5px",
    color: theme.text.primary,
  }, style);

  if (onClick) {
    return (
      <button
        type="button"
        className="av-btn"
        onClick={onClick}
        title={title}
        style={Object.assign({}, baseStyle, {
          padding: "2px 4px",
          borderRadius: theme.radius.sm,
          background: "transparent",
          border: "none",
        })}
      >
        AGENTVIZ<span style={{ color: theme.accent.light }}>.</span>
      </button>
    );
  }

  return (
    <span style={baseStyle}>
      AGENTVIZ<span style={{ color: theme.accent.light }}>.</span>
    </span>
  );
}
