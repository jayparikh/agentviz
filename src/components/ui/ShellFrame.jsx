import { theme } from "../../lib/theme.js";

export default function ShellFrame({ children, fontFamily, style }) {
  return (
    <div
      style={Object.assign({
        width: "100%",
        height: "100vh",
        background: theme.bg.base,
        color: theme.text.primary,
        fontFamily: fontFamily || theme.font.mono,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }, style)}
    >
      {children}
    </div>
  );
}
