import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { theme } from "../lib/theme.js";
import {
  buildWaterfallItems,
  getWaterfallStats,
  buildWaterfallLayout,
  getWaterfallWindow,
} from "../lib/waterfall";
import ResizablePanel from "./ResizablePanel.jsx";
import WaterfallChart from "./waterfall/WaterfallChart.jsx";
import WaterfallInspector from "./waterfall/WaterfallInspector.jsx";
import { WATERFALL_OVERSCAN_PX } from "./waterfall/constants.js";

export default function WaterfallView({ currentTime, eventEntries, totalTime, timeMap, turns, targetEventIndex, targetRequest }) {
  var [selectedEventIndex, setSelectedEventIndex] = useState(null);
  var [hoveredIdx, setHoveredIdx] = useState(null);
  var scrollRef = useRef(null);
  var hoverTimerRef = useRef(null);
  var handledTargetRef = useRef(null);
  var [scrollTop, setScrollTop] = useState(0);
  var [viewportHeight, setViewportHeight] = useState(600);

  var allEvents = useMemo(function () {
    return eventEntries.map(function (entry) { return entry.event; });
  }, [eventEntries]);

  var items = useMemo(function () {
    return buildWaterfallItems(allEvents).map(function (item) {
      return Object.assign({}, item, { originalIndex: eventEntries[item.originalIndex].index });
    });
  }, [allEvents, eventEntries]);
  var selectedIdx = items.findIndex(function (item) { return item.originalIndex === selectedEventIndex; });

  var stats = useMemo(function () {
    return getWaterfallStats(items);
  }, [items]);

  var layout = useMemo(function () {
    return buildWaterfallLayout(items);
  }, [items]);

  var visibleItems = useMemo(function () {
    return getWaterfallWindow(layout.layoutItems, scrollTop, viewportHeight, WATERFALL_OVERSCAN_PX);
  }, [layout.layoutItems, scrollTop, viewportHeight]);

  useEffect(function () {
    if (targetEventIndex == null) return;
    if (handledTargetRef.current && handledTargetRef.current.index === targetEventIndex
      && handledTargetRef.current.request === targetRequest) return;
    var target = layout.layoutItems.find(function (item) { return item.item.originalIndex === targetEventIndex; });
    if (!target || !scrollRef.current) return;
    handledTargetRef.current = { index: targetEventIndex, request: targetRequest };
    setSelectedEventIndex(targetEventIndex);
    var offset = Math.max(0, target.top - 32);
    scrollRef.current.scrollTop = offset;
    setScrollTop(offset);
  }, [targetEventIndex, targetRequest, layout.layoutItems]);

  var selectedItem = useMemo(function () {
    if (selectedIdx === null || !items[selectedIdx]) return null;
    return items[selectedIdx];
  }, [selectedIdx, items]);

  var itemIndexMap = useMemo(function () {
    var map = new WeakMap();
    for (var i = 0; i < items.length; i++) {
      map.set(items[i], i);
    }
    return map;
  }, [items]);

  var handleScroll = useCallback(function () {
    if (scrollRef.current) {
      setScrollTop(scrollRef.current.scrollTop);
    }
  }, [items.length > 0]);

  var handleMouseEnter = useCallback(function (idx) {
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(function () {
      setHoveredIdx(idx);
    }, 30);
  }, []);

  var handleMouseLeave = useCallback(function () {
    clearTimeout(hoverTimerRef.current);
    setHoveredIdx(null);
  }, []);

  useEffect(function () {
    if (!scrollRef.current) return;
    var observer = new ResizeObserver(function (entries) {
      if (entries[0]) {
        setViewportHeight(entries[0].contentRect.height);
      }
    });
    observer.observe(scrollRef.current);
    return function () {
      observer.disconnect();
    };
  }, []);

  useEffect(function () {
    return function () {
      clearTimeout(hoverTimerRef.current);
    };
  }, []);

  if (items.length === 0) {
    return (
      <div style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: theme.text.dim,
        fontSize: theme.fontSize.md,
        fontStyle: "italic",
      }}>
        No tool calls to display
      </div>
    );
  }

  return (
    <ResizablePanel
      initialSplit={0.72}
      minPx={200}
      direction="horizontal"
      storageKey="agentviz:waterfall-panel-split"
    >
      <WaterfallChart
        scrollRef={scrollRef}
        onScroll={handleScroll}
        layout={layout}
        visibleItems={visibleItems}
        itemIndexMap={itemIndexMap}
        selectedIdx={selectedIdx}
        hoveredIdx={hoveredIdx}
        onSelect={function (index) { setSelectedEventIndex(index == null ? null : items[index].originalIndex); }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        currentTime={currentTime}
        totalTime={totalTime}
        timeMap={timeMap}
        turns={turns}
      />

      <WaterfallInspector
        selectedItem={selectedItem}
        stats={stats}
      />
    </ResizablePanel>
  );
}
