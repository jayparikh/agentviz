export var LANDING_FORMAT_OPTIONS = [
  { id: "all", label: "All clients" },
  { id: "claude-code", label: "Claude Code" },
  { id: "copilot-cli", label: "Copilot CLI" },
  { id: "vscode-chat", label: "VS Code" },
];

export var LANDING_SORT_LABELS = {
  "needs-review": "Needs review",
  "most-recent": "Most recent",
  "most-expensive": "Most expensive",
  "most-active": "Most active",
};

export var LANDING_SORT_OPTIONS = [
  { id: "needs-review", label: LANDING_SORT_LABELS["needs-review"] },
  { id: "most-recent", label: LANDING_SORT_LABELS["most-recent"] },
  { id: "most-expensive", label: LANDING_SORT_LABELS["most-expensive"] },
  { id: "most-active", label: LANDING_SORT_LABELS["most-active"] },
];
var LOW_SIGNAL_DISCOVERED_BYTES = 16 * 1024;

export function formatLandingClientLabel(entry) {
  var format = typeof entry === "string" ? entry : (entry && entry.format);
  var isInsiders = typeof entry === "object" && entry && entry.isInsiders;
  if (format === "claude-code") return "Claude Code";
  if (format === "copilot-cli") return "Copilot CLI";
  if (format === "vscode-chat") return isInsiders ? "VS Code Insiders" : "VS Code";
  if (!format) return "Unknown client";
  return String(format);
}

function normalizeLandingText(value) {
  return String(value || "").trim();
}

function looksLikeSessionFilename(value) {
  return /\.(jsonl?|txt)$/i.test(normalizeLandingText(value));
}

function normalizeLandingTitleKey(value) {
  return normalizeLandingText(value)
    .toLowerCase()
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ");
}

export function getLandingEntryDisplayTitle(entry) {
  var primaryPrompt = normalizeLandingText(entry && entry.primaryPrompt);
  if (primaryPrompt) return primaryPrompt;

  var file = normalizeLandingText(entry && entry.file);
  if (file && !looksLikeSessionFilename(file)) return file;

  var project = normalizeLandingText(entry && entry.project);
  if (project) return project;

  var repository = normalizeLandingText(entry && entry.repository);
  if (repository) return repository;

  var filename = normalizeLandingText(entry && entry.filename);
  if (filename) return filename;

  if (file) return file;
  return "Untitled";
}

export function getLandingEntrySecondaryText(entry, title) {
  var normalizedTitle = normalizeLandingText(title);
  var candidates = [
    normalizeLandingText(entry && entry.file),
    normalizeLandingText(entry && entry.project),
    normalizeLandingText(entry && entry.repository),
    normalizeLandingText(entry && entry.filename),
  ];

  for (var index = 0; index < candidates.length; index += 1) {
    var candidate = candidates[index];
    if (!candidate || candidate === normalizedTitle) continue;
    return candidate;
  }

  return "";
}

export function filterLandingEntriesByQuery(entries, query) {
  var normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return entries || [];
  return (entries || []).filter(function (entry) {
    return getLandingEntryDisplayTitle(entry).toLowerCase().includes(normalizedQuery)
      || (entry.file || "").toLowerCase().includes(normalizedQuery)
      || (entry.filename || "").toLowerCase().includes(normalizedQuery)
      || (entry.project || "").toLowerCase().includes(normalizedQuery)
      || (entry.primaryPrompt || "").toLowerCase().includes(normalizedQuery)
      || (entry.repository || "").toLowerCase().includes(normalizedQuery);
  });
}

export function getLandingEntryTimestamp(entry) {
  return String(entry && (entry.updatedAt || entry.importedAt) || "");
}

export function isLowSignalDiscoveredEntry(entry) {
  if (!entry || !entry.isDiscovered) return false;
  var titleKey = normalizeLandingTitleKey(getLandingEntryDisplayTitle(entry));
  if (titleKey === "session metadata") return true;
  return Number(entry.size || 0) > 0 && Number(entry.size || 0) <= LOW_SIGNAL_DISCOVERED_BYTES;
}

export function isLandingSearchShortcut(event) {
  var tagName = event && event.target && event.target.tagName;
  return event.key === "/"
    && !event.metaKey
    && !event.ctrlKey
    && tagName !== "INPUT"
    && tagName !== "TEXTAREA";
}

export function settleLandingRefresh(result, onSettled) {
  if (result && typeof result.then === "function") {
    result.finally(onSettled);
    return;
  }
  onSettled();
}

export function sortLandingEntries(entries, sortMode) {
  return (entries || []).slice().sort(function (left, right) {
    if (sortMode === "most-recent") {
      return getLandingEntryTimestamp(right).localeCompare(getLandingEntryTimestamp(left));
    }

    if (sortMode === "most-expensive") {
      return (right.totalCost || 0) - (left.totalCost || 0);
    }

    if (sortMode === "most-active") {
      return (right.totalEvents || 0) - (left.totalEvents || 0);
    }

    return (right.reviewScore || 0) - (left.reviewScore || 0)
      || getLandingEntryTimestamp(right).localeCompare(getLandingEntryTimestamp(left));
  });
}

export function sortLandingEntriesByDate(entries) {
  return sortLandingEntries(entries, "most-recent");
}

export function sortDiscoveredLandingEntries(entries) {
  return (entries || []).slice().sort(function (left, right) {
    var leftLowSignal = isLowSignalDiscoveredEntry(left);
    var rightLowSignal = isLowSignalDiscoveredEntry(right);
    if (leftLowSignal !== rightLowSignal) return leftLowSignal ? 1 : -1;
    return getLandingEntryTimestamp(right).localeCompare(getLandingEntryTimestamp(left));
  });
}
