import { theme } from "../../lib/theme.js";
import { getWaterfallLeft } from "./constants.js";
import TimeAxis from "./TimeAxis.jsx";
import WaterfallRow from "./WaterfallRow.jsx";

export default function WaterfallChart({
  scrollRef,
  onScroll,
  layout,
  visibleItems,
  itemIndexMap,
  selectedIdx,
  hoveredIdx,
  onSelect,
  onMouseEnter,
  onMouseLeave,
  currentTime,
  totalTime,
  timeMap,
  turns,
}) {
  var playPct = timeMap ? timeMap.toPosition(currentTime) * 100 : (totalTime > 0 ? (currentTime / totalTime) * 100 : 0);

  return (
    <div style={{
      height: "100%",
      display: "flex",
      flexDirection: "column",
      background: theme.bg.base,
      borderRadius: theme.radius.lg,
      border: "1px solid " + theme.border.default,
      overflow: "hidden",
    }}>
      <TimeAxis
        totalTime={totalTime}
        timeMap={timeMap}
      />

      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{
          flex: 1,
          overflow: "auto",
          position: "relative",
        }}
      >
        <div style={{
          height: layout.totalHeight,
          position: "relative",
          minHeight: "100%",
        }}>
          {turns && turns.map(function (turn, ti) {
            if (ti === 0) return null;
            var left = timeMap ? timeMap.toPosition(turn.startTime) * 100 : (totalTime > 0 ? (turn.startTime / totalTime) * 100 : 0);
            return (
              <div key={"tb-" + ti} style={{
                position: "absolute",
                left: getWaterfallLeft(left / 100),
                top: 0,
                bottom: 0,
                width: 1,
                background: theme.border.subtle,
                zIndex: 0,
                pointerEvents: "none",
              }} />
            );
          })}

          <div style={{
            position: "absolute",
            left: getWaterfallLeft(playPct / 100),
            top: 0,
            bottom: 0,
            width: 2,
            background: theme.accent.primary,
            boxShadow: "none",
            zIndex: theme.z.playhead,
            transition: "left 0.08s linear",
            pointerEvents: "none",
          }} />

          {visibleItems.map(function (layoutItem) {
            return (
              <WaterfallRow
                key={layoutItem.item.originalIndex}
                item={layoutItem.item}
                layoutItem={layoutItem}
                currentTime={currentTime}
                totalTime={totalTime}
                timeMap={timeMap}
                selectedIdx={selectedIdx}
                hoveredIdx={hoveredIdx}
                itemIndexMap={itemIndexMap}
                onSelect={onSelect}
                onMouseEnter={onMouseEnter}
                onMouseLeave={onMouseLeave}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
