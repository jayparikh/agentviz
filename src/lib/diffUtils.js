import { theme, alpha } from "../lib/theme.js";

/**
 * Diff utility functions for detecting and computing diffs
 * from file-editing tool calls (str_replace_editor, edit, create).
 */

// Tool names that represent file edits
var EDIT_TOOL_NAMES = [
  "str_replace_editor",
  "edit",
  "file_editor",
  "write",
  "str_replace_based_edit_tool",
];

var CREATE_TOOL_NAMES = [
  "create",
];

/**
 * Check if an event is a file-editing tool call with old_str/new_str.
 */
export function isFileEditEvent(event) {
  if (!event || event.track !== "tool_call") return false;
  var input = event.toolInput;
  if (!input) return false;

  // Check by tool name
  var name = (event.toolName || "").toLowerCase();
  var isEditTool = false;
  for (var i = 0; i < EDIT_TOOL_NAMES.length; i++) {
    if (name === EDIT_TOOL_NAMES[i] || name.indexOf(EDIT_TOOL_NAMES[i]) !== -1) {
      isEditTool = true;
      break;
    }
  }

  // Must have old_str and new_str in input
  if (isEditTool && input.old_str !== undefined && input.new_str !== undefined) {
    return true;
  }

  // Also detect by command field
  if (input.command === "str_replace" && input.old_str !== undefined && input.new_str !== undefined) {
    return true;
  }

  return false;
}

/**
 * Check if an event is a file-create tool call.
 */
export function isFileCreateEvent(event) {
  if (!event || event.track !== "tool_call") return false;
  var input = event.toolInput;
  if (!input) return false;

  var name = (event.toolName || "").toLowerCase();

  // Explicit create tool
  for (var i = 0; i < CREATE_TOOL_NAMES.length; i++) {
    if (name === CREATE_TOOL_NAMES[i]) return true;
  }

  // str_replace_editor with command=create
  if (input.command === "create" && input.file_text !== undefined) {
    return true;
  }

  // Any tool with file_text and path but no old_str
  if (input.file_text !== undefined && input.path && input.old_str === undefined) {
    return true;
  }

  return false;
}

/**
 * Check if an event has any diff-viewable content.
 */
export function isDiffViewable(event) {
  return isFileEditEvent(event) || isFileCreateEvent(event);
}

/**
 * Extract diff data from an event.
 * Returns { filePath, type, oldStr, newStr } or null.
 */
export function extractDiffData(event) {
  if (!event || !event.toolInput) return null;
  var input = event.toolInput;

  if (isFileEditEvent(event)) {
    return {
      filePath: input.path || "unknown",
      type: "edit",
      oldStr: input.old_str || "",
      newStr: input.new_str || "",
    };
  }

  if (isFileCreateEvent(event)) {
    return {
      filePath: input.path || input.file_path || "unknown",
      type: "create",
      oldStr: "",
      newStr: input.file_text || "",
    };
  }

  return null;
}

/**
 * Compute a unified diff between two strings.
 * Returns an array of hunks, each with line entries.
 *
 * Uses a simple LCS-based line diff (Myers-like O(ND) algorithm).
 */
export function computeDiff(oldStr, newStr) {
  var oldLines = oldStr ? oldStr.split("\n") : [];
  var newLines = newStr ? newStr.split("\n") : [];

  // Strip trailing empty line caused by a trailing newline (each independently)
  if (oldLines.length > 0 && oldLines[oldLines.length - 1] === "") oldLines.pop();
  if (newLines.length > 0 && newLines[newLines.length - 1] === "") newLines.pop();

  var ops = myersDiff(oldLines, newLines);
  return buildHunks(ops, oldLines, newLines, 3);
}

/**
 * Myers diff algorithm (simplified).
 * Returns an array of operations: { type: "equal"|"delete"|"insert", oldIdx, newIdx }
 */
function myersDiff(oldLines, newLines) {
  var N = oldLines.length;
  var M = newLines.length;

  if (N === 0 && M === 0) return [];

  // Fast path: all insertions
  if (N === 0) {
    var ops = [];
    for (var j = 0; j < M; j++) {
      ops.push({ type: "insert", newIdx: j });
    }
    return ops;
  }

  // Fast path: all deletions
  if (M === 0) {
    var ops = [];
    for (var i = 0; i < N; i++) {
      ops.push({ type: "delete", oldIdx: i });
    }
    return ops;
  }

  var MAX = N + M;
  // v[k] stores the furthest reaching x on diagonal k
  // Use offset so negative indices work: v[k + MAX]
  var size = 2 * MAX + 1;
  var v = new Array(size);
  for (var i = 0; i < size; i++) v[i] = 0;

  var trace = [];

  outer:
  for (var d = 0; d <= MAX; d++) {
    var vCopy = v.slice();
    trace.push(vCopy);

    for (var k = -d; k <= d; k += 2) {
      var kIdx = k + MAX;

      var x;
      if (k === -d || (k !== d && v[kIdx - 1] < v[kIdx + 1])) {
        x = v[kIdx + 1];
      } else {
        x = v[kIdx - 1] + 1;
      }

      var y = x - k;

      // Follow diagonal (matching lines)
      while (x < N && y < M && oldLines[x] === newLines[y]) {
        x++;
        y++;
      }

      v[kIdx] = x;

      if (x >= N && y >= M) {
        break outer;
      }
    }
  }

  // Backtrack to recover the edit script
  var operations = [];
  var x = N;
  var y = M;

  for (var d = trace.length - 1; d > 0; d--) {
    var V = trace[d]; // v at start of step d = v after step d-1
    var k = x - y;
    var kIdx = k + MAX;

    var prevK;
    if (k === -d || (k !== d && V[kIdx - 1] < V[kIdx + 1])) {
      prevK = k + 1; // came from above (insertion)
    } else {
      prevK = k - 1; // came from left (deletion)
    }

    var prevX = V[prevK + MAX];
    var prevY = prevX - prevK;

    // Diagonal (equal) moves from entry point to current (x, y)
    while (x > prevX + (prevK > k ? 1 : 0) && y > prevY + (prevK < k ? 1 : 0)) {
      x--;
      y--;
      operations.push({ type: "equal", oldIdx: x, newIdx: y });
    }

    // The non-diagonal move
    if (prevK > k) {
      // Down move = insertion (y advanced)
      operations.push({ type: "insert", newIdx: prevY });
    } else {
      // Right move = deletion (x advanced)
      operations.push({ type: "delete", oldIdx: prevX });
    }

    x = prevX;
    y = prevY;
  }

  // Handle initial diagonal at d=0
  while (x > 0 && y > 0) {
    x--;
    y--;
    operations.push({ type: "equal", oldIdx: x, newIdx: y });
  }

  operations.reverse();
  return operations;
}

/**
 * Build unified diff hunks from operations.
 * context = number of context lines around changes.
 */
function buildHunks(ops, oldLines, newLines, context) {
  if (ops.length === 0) return [];

  // Find ranges of changes
  var changes = [];
  for (var i = 0; i < ops.length; i++) {
    if (ops[i].type !== "equal") {
      changes.push(i);
    }
  }

  if (changes.length === 0) {
    // No changes
    return [];
  }

  // Group changes into hunks with context
  var hunks = [];
  var hunkStart = null;
  var hunkEnd = null;

  for (var c = 0; c < changes.length; c++) {
    var idx = changes[c];
    var rangeStart = Math.max(0, idx - context);
    var rangeEnd = Math.min(ops.length - 1, idx + context);

    if (hunkStart === null) {
      hunkStart = rangeStart;
      hunkEnd = rangeEnd;
    } else if (rangeStart <= hunkEnd + 1) {
      // Overlapping or adjacent, merge
      hunkEnd = Math.max(hunkEnd, rangeEnd);
    } else {
      // New hunk
      hunks.push(buildOneHunk(ops, oldLines, newLines, hunkStart, hunkEnd));
      hunkStart = rangeStart;
      hunkEnd = rangeEnd;
    }
  }

  if (hunkStart !== null) {
    hunks.push(buildOneHunk(ops, oldLines, newLines, hunkStart, hunkEnd));
  }

  return hunks;
}

function buildOneHunk(ops, oldLines, newLines, start, end) {
  var lines = [];
  var oldStart = null;
  var newStart = null;
  var oldCount = 0;
  var newCount = 0;

  for (var i = start; i <= end; i++) {
    var op = ops[i];
    if (op.type === "equal") {
      if (oldStart === null) oldStart = op.oldIdx;
      if (newStart === null) newStart = op.newIdx;
      lines.push({ type: "context", text: oldLines[op.oldIdx], oldNum: op.oldIdx + 1, newNum: op.newIdx + 1 });
      oldCount++;
      newCount++;
    } else if (op.type === "delete") {
      if (oldStart === null) oldStart = op.oldIdx;
      if (newStart === null) {
        // Find the next equal or insert to get newStart
        for (var j = i + 1; j <= end; j++) {
          if (ops[j].type === "equal") { newStart = ops[j].newIdx; break; }
          if (ops[j].type === "insert") { newStart = ops[j].newIdx; break; }
        }
        if (newStart === null) newStart = newLines.length > 0 ? newLines.length : 0;
      }
      lines.push({ type: "delete", text: oldLines[op.oldIdx], oldNum: op.oldIdx + 1, newNum: null });
      oldCount++;
    } else if (op.type === "insert") {
      if (newStart === null) newStart = op.newIdx;
      if (oldStart === null) {
        for (var j = i + 1; j <= end; j++) {
          if (ops[j].type === "equal") { oldStart = ops[j].oldIdx; break; }
          if (ops[j].type === "delete") { oldStart = ops[j].oldIdx; break; }
        }
        if (oldStart === null) oldStart = oldLines.length > 0 ? oldLines.length : 0;
      }
      lines.push({ type: "insert", text: newLines[op.newIdx], oldNum: null, newNum: op.newIdx + 1 });
      newCount++;
    }
  }

  return {
    oldStart: (oldStart || 0) + 1,
    oldCount: oldCount,
    newStart: (newStart || 0) + 1,
    newCount: newCount,
    lines: lines,
  };
}
