export function buildTrackMarks(entries, totalTime, timeMap, maxMarks = 200) {
  const position = t => timeMap ? timeMap.toPosition(t) : totalTime > 0 ? t / totalTime : 0;
  const buckets = new Map();
  const dense = entries.length > maxMarks;
  for (const entry of entries) {
    const left = Math.max(0, Math.min(1, position(entry.event.t)));
    const key = dense ? Math.min(maxMarks - 1, Math.floor(left * maxMarks)) : entry.index;
    let mark = buckets.get(key);
    if (!mark) {
      mark = { key, left: dense ? key / maxMarks : left, width: 0, entries: [], isError: false };
      buckets.set(key, mark);
    }
    mark.entries.push(entry);
    mark.isError ||= entry.event.isError;
    mark.width = Math.max(mark.width, dense ? 1 / maxMarks : Math.max(0.003, position(entry.event.t + entry.event.duration) - left));
  }
  return Array.from(buckets.values());
}
