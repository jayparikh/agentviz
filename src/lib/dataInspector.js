function getValueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function serializeInspectorValue(value) {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (
    typeof value === "number"
    || typeof value === "boolean"
    || value === null
  ) {
    return JSON.stringify(value, null, 2);
  }

  return JSON.stringify(value, null, 2);
}

export function summarizeInspectorValue(value) {
  var type = getValueType(value);
  var countLabel = null;
  var keysPreview = [];

  if (type === "array") {
    countLabel = value.length + " item" + (value.length === 1 ? "" : "s");
  } else if (type === "object") {
    keysPreview = Object.keys(value);
    countLabel = keysPreview.length + " key" + (keysPreview.length === 1 ? "" : "s");
  } else if (type === "string") {
    type = "text";
  }

  return {
    typeLabel: type,
    countLabel: countLabel,
    keysPreview: keysPreview.slice(0, 6),
  };
}

export function getInspectorDisplay(value, options) {
  var settings = options || {};
  var maxChars = settings.maxChars == null ? 20000 : settings.maxChars;
  var maxLines = settings.maxLines == null ? 20 : settings.maxLines;
  var expanded = settings.expanded === true;
  var text = serializeInspectorValue(value);
  var safeText = text.length > maxChars ? text.slice(0, maxChars) : text;
  var fullLines = safeText.split("\n");
  var visibleText = expanded || fullLines.length <= maxLines
    ? safeText
    : fullLines.slice(0, maxLines).join("\n");
  var summary = summarizeInspectorValue(value);

  return {
    fullText: text,
    safeText: safeText,
    visibleText: visibleText,
    charCount: text.length,
    lineCount: text ? text.split("\n").length : 0,
    truncatedByChars: text.length > maxChars,
    truncatedByLines: !expanded && fullLines.length > maxLines,
    typeLabel: summary.typeLabel,
    countLabel: summary.countLabel,
    keysPreview: summary.keysPreview,
  };
}
