import { theme } from "../../lib/theme.js";

export default function KeyboardHint({ children, style }) {
  return (
    <kbd style={Object.assign({
      background: theme.bg.raised,
      border: "1px solid " + theme.border.default,
      borderRadius: theme.radius.sm,
      padding: "1px 6px",
      fontSize: theme.fontSize.xs,
      color: theme.text.secondary,
      fontFamily: theme.font.mono,
    }, style)}>
      {children}
    </kbd>
  );
}
