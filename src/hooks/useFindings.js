import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FINDINGS_CHANGED, FINDINGS_PREFIX, anchorId, buildEventAnchors, createFinding,
  findingsError, findingsSessionId, fingerprint, matchesAnchor, readFindings,
  saveFindings, validateFindingsPayload,
} from "../lib/findings";

function emptyState() {
  return { sessionId: null, storageId: null, items: [], baseline: [], drafts: {}, error: null, dirty: false, embedded: false };
}

export default function useFindings(events) {
  var [state, setState] = useState(emptyState);
  var current = useRef(state);
  var anchors = useMemo(function () { return buildEventAnchors(events || []); }, [events]);
  function update(next) { current.current = next; setState(next); }

  var open = useCallback(function (metadata, text, embedded, standalone) {
    var sessionId = findingsSessionId(metadata, text);
    var next = Object.assign(emptyState(), { sessionId: sessionId, storageId: sessionId });
    if (standalone) {
      // Each export owns its local edits. Never read the normal session's notes
      // into a received export, even when it has the same explicit session ID.
      try {
        var payload = embedded === undefined
          ? { version: 1, sessionId: sessionId, snapshot: fingerprint(text), items: [], drafts: [] }
          : validateFindingsPayload(embedded, sessionId, text);
        next.storageId = "export:" + fingerprint(JSON.stringify(payload));
        next.items = payload.items;
        next.drafts = Object.fromEntries((payload.drafts || []).map(function (item) { return [item.id, item]; }));
        next.embedded = true;
        var local = readFindings(next.storageId);
        // The payload is authoritative unless there are edits for this exact
        // export, stored in its own namespace.
        next.baseline = local.items;
        if (local.exists) { next.items = local.items; next.embedded = false; }
        next.error = local.error;
      } catch (error) {
        next.storageId = null;
        next.error = findingsError(error);
      }
    } else {
      var saved = readFindings(sessionId);
      next.items = saved.items || [];
      next.baseline = saved.items;
      next.error = saved.error;
      if (embedded !== undefined) {
        try {
          var transferred = validateFindingsPayload(embedded, sessionId, text);
          next.items = transferred.items;
          next.drafts = Object.fromEntries(transferred.drafts.map(function (item) { return [item.id, item]; }));
          next.dirty = JSON.stringify(next.items) !== JSON.stringify(next.baseline);
        } catch (error) { next.error = findingsError(error); }
      }
    }
    update(next);
  }, []);

  var close = useCallback(function () { update(emptyState()); }, []);
  var persist = useCallback(function (items, drafts) {
    var previous = current.current;
    var saved = previous.storageId
      ? saveFindings(previous.storageId, items, previous.baseline)
      : { items: null, error: previous.error || { kind: "access", message: "Findings cannot be saved for this session. Download findings to keep them." } };
    update(Object.assign({}, previous, {
      items: saved.items || items, baseline: saved.items || previous.baseline,
      drafts: drafts || previous.drafts, dirty: Boolean(saved.error), error: saved.error, embedded: false,
    }));
    if (!saved.error) window.dispatchEvent(new CustomEvent(FINDINGS_CHANGED, { detail: previous.storageId }));
    return !saved.error;
  }, []);
  var retry = useCallback(function () {
    var previous = current.current;
    var saved = persist(previous.items);
    if (saved) {
      var notes = new Map(current.current.items.map(function (item) { return [item.id, item.note]; }));
      var drafts = Object.fromEntries(Object.entries(current.current.drafts).filter(function (entry) {
        return notes.get(entry[0]) !== entry[1].note;
      }));
      update(Object.assign({}, current.current, { drafts: drafts }));
    }
    return saved;
  }, [persist]);
  var reload = useCallback(function () {
    var previous = current.current;
    if (!previous.storageId) return;
    var saved = readFindings(previous.storageId);
    if (saved.error) update(Object.assign({}, previous, { error: saved.error }));
    else update(Object.assign({}, previous, { items: saved.items, baseline: saved.items, drafts: {}, error: null, dirty: false, embedded: false }));
  }, []);

  useEffect(function () {
    function changed(event) {
      var previous = current.current;
      if (!previous.storageId || (event.type === FINDINGS_CHANGED ? event.detail !== previous.storageId
        : event.key && event.key !== FINDINGS_PREFIX + previous.storageId)) return;
      if (previous.dirty || previous.embedded || Object.keys(previous.drafts).length) return;
      var saved = readFindings(previous.storageId);
      update(Object.assign({}, previous, { items: saved.items || previous.items, baseline: saved.items || previous.baseline, error: saved.error }));
    }
    window.addEventListener("storage", changed);
    window.addEventListener(FINDINGS_CHANGED, changed);
    return function () {
      window.removeEventListener("storage", changed);
      window.removeEventListener(FINDINGS_CHANGED, changed);
    };
  }, []);

  function setDraft(entry, note) {
    var anchor = anchors[entry.index];
    if (!anchor) return;
    var item = createFinding(anchor, entry.event, note);
    update(Object.assign({}, current.current, { drafts: Object.assign({}, current.current.drafts, { [item.id]: item }) }));
  }
  function cancelDraft(id) {
    var drafts = Object.assign({}, current.current.drafts);
    delete drafts[id];
    update(Object.assign({}, current.current, { drafts: drafts }));
  }
  function save(entry, note) {
    var anchor = anchors[entry.index];
    if (!anchor) return;
    var item = createFinding(anchor, entry.event, note);
    if (persist(current.current.items.filter(function (existing) { return existing.id !== item.id; }).concat(item))) cancelDraft(item.id);
  }
  function remove(id) {
    var drafts = Object.assign({}, current.current.drafts);
    delete drafts[id];
    persist(current.current.items.filter(function (item) { return item.id !== id; }), drafts);
  }
  function payload(text) {
    var previous = current.current;
    return { version: 1, sessionId: previous.sessionId, snapshot: fingerprint(text),
      items: previous.items, drafts: Object.values(previous.drafts) };
  }
  function restore(value, text) {
    var restored = validateFindingsPayload(value, current.current.sessionId, text);
    return persist(restored.items, Object.fromEntries(restored.drafts.map(function (item) { return [item.id, item]; })));
  }
  var byId = useMemo(function () { return new Map(state.items.map(function (item) { return [item.id, item]; })); }, [state.items]);
  var entries = useMemo(function () {
    return state.items.map(function (item) { return Object.assign({}, item, { available: matchesAnchor(item.anchor, anchors) }); });
  }, [state.items, anchors]);
  return Object.assign({}, state, {
    open: open, close: close, retry: retry, reload: reload, save: save, remove: remove,
    setDraft: setDraft, cancelDraft: cancelDraft, payload: payload, restore: restore, entries: entries,
    forEntry: function (entry) {
      var anchor = anchors[entry.index];
      var id = anchor && anchorId(anchor);
      return { id: id, item: byId.get(id), draft: state.drafts[id] };
    },
    draftEntries: Object.values(state.drafts).map(function (item) {
      return Object.assign({}, item, { available: matchesAnchor(item.anchor, anchors) });
    }),
  });
}
