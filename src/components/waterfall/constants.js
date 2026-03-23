export var WATERFALL_OVERSCAN_PX = 400;
export var WATERFALL_INDENT_PX = 20;
export var WATERFALL_LABEL_WIDTH = 180;
export var WATERFALL_MIN_BAR_WIDTH_PX = 4;
export var WATERFALL_TIME_AXIS_HEIGHT = 28;

export function getWaterfallLeft(frac) {
  return "calc(" + WATERFALL_LABEL_WIDTH + "px + (100% - " + WATERFALL_LABEL_WIDTH + "px) * " + frac + ")";
}
