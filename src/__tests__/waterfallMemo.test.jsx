import { describe, it, expect } from "vitest";
import WaterfallRow from "../components/waterfall/WaterfallRow.jsx";
import WaterfallChart from "../components/waterfall/WaterfallChart.jsx";
import TimeAxis from "../components/waterfall/TimeAxis.jsx";
import WaterfallInspector from "../components/waterfall/WaterfallInspector.jsx";

describe("Waterfall components are memoized", function () {
  it("WaterfallRow is wrapped with React.memo", function () {
    expect(WaterfallRow.$$typeof).toBe(Symbol.for("react.memo"));
  });
  it("WaterfallChart is wrapped with React.memo", function () {
    expect(WaterfallChart.$$typeof).toBe(Symbol.for("react.memo"));
  });
  it("TimeAxis is wrapped with React.memo", function () {
    expect(TimeAxis.$$typeof).toBe(Symbol.for("react.memo"));
  });
  it("WaterfallInspector is wrapped with React.memo", function () {
    expect(WaterfallInspector.$$typeof).toBe(Symbol.for("react.memo"));
  });
});
