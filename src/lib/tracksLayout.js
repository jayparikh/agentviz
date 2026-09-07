export function buildTrackMarks(entries, totalTime, timeMap, maxMarks = 200) {
  const position = t => timeMap ? timeMap.toPosition(t) : totalTime > 0 ? t / totalTime : 0;
  const buckets = new Map();
  const dense = entries.length > maxMarks;
  for (const entry of entries) {
    const left = Math.max(0, Math.min(1, position(entry.event.t)));
    // Pixel collisions need grouping even in short parallel sessions.
    const key = Math.min(maxMarks - 1, Math.floor(left * maxMarks));
    let mark = buckets.get(key);
    if (!mark) {
      mark = { key, left: dense ? key / maxMarks : Math.min(left, 0.997), width: 0, entries: [], isError: false };
      buckets.set(key, mark);
    }
    mark.entries.push(entry);
    mark.isError ||= entry.event.isError;
    const right = Math.max(mark.left + mark.width, Math.min(1, position(entry.event.t + entry.event.duration)));
    if (!dense) mark.left = Math.min(mark.left, left);
    mark.width = Math.min(1 - mark.left, dense ? 1 / maxMarks : Math.max(0.003, right - mark.left));
  }
  return Array.from(buckets.values());
}
