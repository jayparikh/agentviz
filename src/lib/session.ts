import type { EventEntry, NormalizedEvent, SessionTurn, TimeMap } from "./sessionTypes";

export function getSessionTotal(events: NormalizedEvent[] | null | undefined): number {
  if (!events || events.length === 0) return 0;

  let maxTime = 0;
  for (let i = 0; i < events.length; i += 1) {
    const eventEnd = events[i].t + events[i].duration;
    if (eventEnd > maxTime) maxTime = eventEnd;
  }

  return maxTime;
}

export function buildFilteredEventEntries(
  events: NormalizedEvent[] | null | undefined,
  hiddenTracks: Record<string, boolean | undefined>,
): EventEntry[] {
  if (!events) return [];

  const entries: EventEntry[] = [];
  for (let i = 0; i < events.length; i += 1) {
    if (!hiddenTracks[events[i].track]) {
      entries.push({ index: i, event: events[i] });
    }
  }

  return entries;
}

export function buildTurnStartMap(turns: SessionTurn[]): Record<number, SessionTurn> {
  const map: Record<number, SessionTurn> = {};

  for (let i = 0; i < turns.length; i += 1) {
    if (turns[i].eventIndices.length > 0) {
      map[turns[i].eventIndices[0]] = turns[i];
    }
  }

  return map;
}

function createIdentityTimeMap(sessionTotal: number): TimeMap {
  return {
    toPosition(time) {
      return sessionTotal > 0 ? Math.max(0, Math.min(1, time / sessionTotal)) : 0;
    },
    toTime(position) {
      return position * sessionTotal;
    },
    displayTotal: sessionTotal,
    hasCompression: false,
  };
}

type TimeBreakpoint = [number, number];

function findSegment(breakpoints: TimeBreakpoint[], value: number, field: 0 | 1): number {
  let low = 0;
  let high = breakpoints.length - 1;

  while (low < high - 1) {
    const mid = (low + high) >> 1;
    if (breakpoints[mid][field] <= value) low = mid;
    else high = mid;
  }

  return low;
}

/**
 * Compresses unusually large idle gaps for display-only timelines.
 *
 * The algorithm keeps playback in real time and only remaps visual positions.
 * It finds the median inter-event gap, treats anything far above that baseline
 * as idle time, and replaces those long spans with a bounded display size.
 * This preserves ordering while keeping sparse sessions readable.
 */
export function buildTimeMap(events: NormalizedEvent[] | null | undefined): TimeMap {
  const sessionTotal = getSessionTotal(events);

  if (!events || events.length === 0 || sessionTotal <= 0) {
    return createIdentityTimeMap(sessionTotal);
  }

  const rawTimes = [0];
  for (let i = 0; i < events.length; i += 1) rawTimes.push(events[i].t);
  rawTimes.push(sessionTotal);
  rawTimes.sort(function (a, b) { return a - b; });

  const unique = [rawTimes[0]];
  for (let i = 1; i < rawTimes.length; i += 1) {
    if (rawTimes[i] > unique[unique.length - 1]) unique.push(rawTimes[i]);
  }

  if (unique.length <= 2) return createIdentityTimeMap(sessionTotal);

  const gaps: number[] = [];
  for (let i = 1; i < unique.length; i += 1) {
    gaps.push(unique[i] - unique[i - 1]);
  }

  const sorted = gaps.slice().sort(function (a, b) { return a - b; });
  const median = sorted[Math.floor(sorted.length / 2)];
  const maxGap = sorted[sorted.length - 1];
  const threshold = Math.max(60, median * 10);

  if (maxGap <= threshold) return createIdentityTimeMap(sessionTotal);

  const compressedSize = Math.max(5, Math.min(30, median * 3));
  const breakpoints: TimeBreakpoint[] = [[unique[0], 0]];
  let displayTime = 0;

  for (let i = 1; i < unique.length; i += 1) {
    const gap = unique[i] - unique[i - 1];
    displayTime += gap > threshold ? compressedSize : gap;
    breakpoints.push([unique[i], displayTime]);
  }

  const displayTotal = displayTime;

  return {
    toPosition(time) {
      if (displayTotal <= 0) return 0;
      if (time <= breakpoints[0][0]) return 0;
      if (time >= breakpoints[breakpoints.length - 1][0]) return 1;

      const low = findSegment(breakpoints, time, 0);
      const high = low + 1;
      const realLen = breakpoints[high][0] - breakpoints[low][0];
      const frac = realLen > 0 ? (time - breakpoints[low][0]) / realLen : 0;
      const displayValue = breakpoints[low][1] + frac * (breakpoints[high][1] - breakpoints[low][1]);
      return Math.max(0, Math.min(1, displayValue / displayTotal));
    },
    toTime(position) {
      const target = position * displayTotal;
      if (target <= 0) return 0;
      if (target >= displayTotal) return sessionTotal;

      const low = findSegment(breakpoints, target, 1);
      const high = low + 1;
      const displayLen = breakpoints[high][1] - breakpoints[low][1];
      const frac = displayLen > 0 ? (target - breakpoints[low][1]) / displayLen : 0;
      return breakpoints[low][0] + frac * (breakpoints[high][0] - breakpoints[low][0]);
    },
    displayTotal,
    hasCompression: true,
  };
}
