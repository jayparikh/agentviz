import { theme } from "../lib/theme.js";
import { gradeColor } from "../lib/qualityScore.js";

export default function QualityBadge({ grade, score, style }) {
  if (!grade) return null;

  var color = gradeColor(grade);

  return (
    <span
      title={"Quality: " + grade + " (" + Math.round((score || 0) * 100) + "%)"}
      style={Object.assign({
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 18,
        borderRadius: theme.radius.sm,
        fontSize: theme.fontSize.xs,
        fontFamily: theme.font.mono,
        fontWeight: 600,
        color: color,
        background: color + "18",
        border: "1px solid " + color + "30",
        flexShrink: 0,
        lineHeight: 1,
      }, style || {})}
    >
      {grade}
    </span>
  );
}
