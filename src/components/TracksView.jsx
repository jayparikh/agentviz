import { memo, useState, useMemo } from "react";
import { theme, TRACK_TYPES, alpha } from "../lib/theme.js";
import { buildTrackMarks } from "../lib/tracksLayout.js";
import Icon from "./Icon.jsx";

const Marks = memo(function Marks({ marks, info, onSelect }) {
  return marks.map(mark => {
    const event = mark.entries[0].event;
    const color = mark.isError ? theme.semantic.error : info.color;
    const label = mark.entries.length > 1 ? mark.entries.length + " events"
      : event.agentDisplayName || event.agentName || event.toolName || event.text.substring(0, 50);
    return <button key={mark.key} type="button" data-track-mark=""
      title={label + (mark.entries.length > 1 ? ": click to inspect individual events" : "")}
      onMouseEnter={() => onSelect(mark)} onClick={() => onSelect(mark)}
      style={{ position: "absolute", left: mark.left * 100 + "%", width: mark.width * 100 + "%",
        top: 4, bottom: 4, borderRadius: theme.radius.md, background: alpha(color, 0.4),
        border: "1px solid " + (mark.isError ? color : "transparent"), color: theme.text.primary,
        cursor: "pointer", padding: "0 3px", overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: "nowrap", fontFamily: "inherit", fontSize: theme.fontSize.xs }}>
      {label}
    </button>;
  });
});

const Boundaries = memo(function Boundaries({ turns, totalTime, timeMap }) {
  // At overview scale identical pixel columns carry no additional information.
  const columns = new Set((turns || []).slice(1).map(turn => Math.round((timeMap ? timeMap.toPosition(turn.startTime) : totalTime ? turn.startTime / totalTime : 0) * 200)));
  return Array.from(columns).map(column => <div key={column} style={{
    position: "absolute", left: column / 2 + "%", top: 0, bottom: 0, width: 1, background: theme.border.default,
  }} />);
});

export default function TracksView({ currentTime, eventEntries, totalTime, timeMap, turns }) {
  const [muted, setMuted] = useState({});
  const [solo, setSolo] = useState(null);
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState(null);
  const layout = useMemo(() => {
    const grouped = {};
    for (const entry of eventEntries) (grouped[entry.event.track] ||= []).push(entry);
    return Object.entries(TRACK_TYPES).filter(([key]) => grouped[key]?.length).map(([key, info]) => ({
      key, info, entries: grouped[key], marks: buildTrackMarks(grouped[key], totalTime, timeMap),
    }));
  }, [eventEntries, totalTime, timeMap]);
  const select = useMemo(() => mark => { setSelected(mark); setPage(0); setDetail(mark.entries[0]); }, []);
  const playPct = (timeMap ? timeMap.toPosition(currentTime) : totalTime ? currentTime / totalTime : 0) * 100;
  const buttonStyle = { background: "transparent", border: "1px solid " + theme.border.strong,
    color: theme.text.secondary, borderRadius: theme.radius.sm, padding: "4px 6px", cursor: "pointer", fontFamily: "inherit", fontSize: theme.fontSize.xs };
  return <div style={{ height: "100%", overflow: "auto", "--tracks-playhead": playPct + "%" }}>
    {layout.map(({ key, info, entries, marks }) => {
      const visible = solo ? solo === key : !muted[key];
      const active = marks.filter(mark => mark.entries.some(({ event }) => currentTime >= event.t && currentTime <= event.t + event.duration));
      return <div key={key} style={{ display: "flex", minHeight: 48, opacity: visible ? 1 : 0.15 }}>
        <div style={{ width: 220, flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "0 10px", borderRight: "1px solid " + theme.border.default }}>
          <Icon name={key} size={14} color={info.color} />
          <span style={{ fontSize: theme.fontSize.base, color: theme.text.secondary }}>{info.label}</span>
          <button type="button" aria-label={"Solo " + info.label + " track"} aria-pressed={solo === key}
            onClick={() => { setMuted({}); setSolo(solo === key ? null : key); }} style={{ ...buttonStyle, marginLeft: "auto", background: solo === key ? alpha(info.color, 0.25) : "transparent" }}>Solo</button>
          <button type="button" aria-label={(muted[key] ? "Unmute " : "Mute ") + info.label + " track"} aria-pressed={!!muted[key]}
            onClick={() => { setSolo(null); setMuted(previous => ({ ...previous, [key]: !previous[key] })); }} style={buttonStyle}>Mute</button>
          <span style={{ fontSize: theme.fontSize.xs, color: theme.text.dim }}>{entries.length}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0, position: "relative", background: theme.bg.base, borderBottom: "1px solid " + theme.border.subtle }}>
          <Boundaries turns={turns} totalTime={totalTime} timeMap={timeMap} />
          <Marks marks={marks} info={info} onSelect={select} />
          {active.map(mark => <div key={mark.key} aria-hidden="true" style={{ position: "absolute", pointerEvents: "none",
            left: mark.left * 100 + "%", width: mark.width * 100 + "%", top: 4, bottom: 4,
            border: "1px solid " + info.color, borderRadius: theme.radius.md }} />)}
          <div style={{ position: "absolute", left: "var(--tracks-playhead)", top: 0, bottom: 0, width: 1, background: theme.accent.primary, pointerEvents: "none" }} />
        </div>
      </div>;
    })}
    {selected && <section aria-label="Track evidence" style={{ padding: 16, borderTop: "1px solid " + theme.border.default, color: theme.text.primary }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <strong style={{ fontSize: theme.fontSize.base }}>{selected.entries.length === 1 ? "Event detail" : selected.entries.length + " events in this time range"}</strong>
        <button type="button" onClick={() => setSelected(null)} style={buttonStyle}>Close detail</button>
      </div>
      {selected.entries.length > 1 && <>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {selected.entries.slice(page * 50, page * 50 + 50).map(entry => <button key={entry.index} type="button"
            onClick={() => setDetail(entry)} aria-pressed={detail?.index === entry.index} style={buttonStyle}>
            #{entry.index + 1} · {entry.event.t.toFixed(1)}s · {entry.event.toolName || entry.event.track}
          </button>)}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} style={buttonStyle}>Previous events</button>
          <span>{page + 1} / {Math.ceil(selected.entries.length / 50)}</span>
          <button type="button" disabled={(page + 1) * 50 >= selected.entries.length} onClick={() => setPage(page + 1)} style={buttonStyle}>Next events</button>
        </div>
      </>}
      {detail && <div style={{ marginTop: 12, fontSize: theme.fontSize.base, lineHeight: 1.6, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
        <div style={{ color: theme.text.secondary }}>Event #{detail.index + 1} · {detail.event.t.toFixed(1)}s{detail.event.isError ? " · Error" : ""}</div>
        {detail.event.text}
      </div>}
    </section>}
  </div>;
}
