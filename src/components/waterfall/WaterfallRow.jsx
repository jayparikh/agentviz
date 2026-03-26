import { alpha, theme } from "../../lib/theme.js";
import Icon from "../Icon.jsx";
import { formatDuration } from "../../lib/formatTime.js";
import { getToolColor } from "../../lib/waterfall";
import { WATERFALL_INDENT_PX, WATERFALL_LABEL_WIDTH, WATERFALL_MIN_BAR_WIDTH_PX } from "./constants.js";

export default function WaterfallRow({
  item,
  layoutItem,
  currentTime,
  totalTime,
  timeMap,
  selectedIdx,
  hoveredIdx,
  itemIndexMap,
  onSelect,
  onMouseEnter,
  onMouseLeave,
}) {
  var ev = item.event;
  var idx = itemIndexMap.get(item);
  var isSelected = selectedIdx === idx;
  var isHovered = hoveredIdx === idx;
  var isActive = currentTime >= ev.t && currentTime <= ev.t + ev.duration;
  var barColor = ev.isError ? theme.semantic.error : getToolColor(ev.toolName);
  var indent = item.depth * WATERFALL_INDENT_PX;
  var barLeft = timeMap ? timeMap.toPosition(ev.t) * 100 : (totalTime > 0 ? (ev.t / totalTime) * 100 : 0);
  var barWidth = timeMap
    ? Math.max(0.3, (timeMap.toPosition(ev.t + ev.duration) - timeMap.toPosition(ev.t)) * 100)
    : (totalTime > 0 ? (ev.duration / totalTime) * 100 : 0);

  return (
    <div
      key={item.originalIndex}
      role="button"
      tabIndex={0}
      onClick={function () { onSelect(isSelected ? null : idx); }}
      onMouseEnter={function () { onMouseEnter(idx); }}
      onMouseLeave={onMouseLeave}
      style={{
        position: "absolute",
        top: layoutItem.top,
        left: 0,
        right: 0,
        height: layoutItem.height,
        display: "flex",
        alignItems: "center",
        cursor: "pointer",
        background: isSelected
          ? alpha(barColor, 0.08)
          : isHovered
            ? theme.bg.hover
            : "transparent",
        borderLeft: isSelected ? "2px solid " + barColor : "2px solid transparent",
        transition: "background " + theme.transition.fast,
      }}
    >
      <div style={{
        width: WATERFALL_LABEL_WIDTH,
        flexShrink: 0,
        paddingLeft: theme.space.md + indent,
        paddingRight: theme.space.sm,
        display: "flex",
        alignItems: "center",
        gap: theme.space.sm,
        overflow: "hidden",
        borderRight: "1px solid " + theme.border.subtle,
      }}>
        <div style={{
          width: 6,
          height: 6,
          borderRadius: theme.radius.full,
          background: barColor,
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: theme.fontSize.sm,
          color: ev.isError ? theme.semantic.errorText : theme.text.secondary,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontWeight: isSelected ? 600 : 400,
        }}>
          {ev.toolName || "tool"}
        </span>
      </div>

      <div style={{
        flex: 1,
        position: "relative",
        height: "100%",
      }}>
        <div style={{
          position: "absolute",
          left: barLeft + "%",
          width: "max(" + WATERFALL_MIN_BAR_WIDTH_PX + "px, " + barWidth + "%)",
          top: 4,
          bottom: 4,
          borderRadius: theme.radius.sm,
          background: alpha(barColor, 0.5),
          border: "1px solid " + (isActive || isSelected
            ? barColor
            : alpha(barColor, 0.3)),
          boxShadow: "none",
          display: "flex",
          alignItems: "center",
          padding: "0 4px",
          overflow: "hidden",
          transition: "border-color " + theme.transition.fast + ", box-shadow " + theme.transition.fast,
        }}>
          {ev.isError && (
            <span style={{ fontSize: theme.fontSize.xs, marginRight: 2, color: theme.semantic.error, display: "inline-flex", alignItems: "center" }}><Icon name="alert-circle" size={10} /></span>
          )}
          <span style={{
            fontSize: theme.fontSize.xs,
            color: theme.text.primary,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            opacity: 0.85,
          }}>
            {formatDuration(ev.duration)}
          </span>
        </div>
      </div>
    </div>
  );
}
