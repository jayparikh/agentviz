/**
 * AGENTVIZ Design Tokens
 *
 * Mode-aware palette with dark, light, and system preferences.
 * Inspired by Linear, Raycast, Vercel -- tools that feel quiet and fast.
 */

var THEME_STORAGE_KEY = "agentviz:theme-mode";
var THEME_STORAGE_CLEARED_KEY = "agentviz:theme-mode-cleared";

var SHARED_THEME = {
  font: {
    mono: "'JetBrains Mono', monospace",
    ui: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
  fontSize: {
    xs: 10,
    sm: 11,
    base: 12,
    md: 13,
    lg: 15,
    xl: 18,
    xxl: 24,
    hero: 32,
  },
  space: {
    xs: 2,
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    xxl: 24,
    xxxl: 32,
    huge: 40,
    giant: 56,
  },
  radius: {
    sm: 4,
    md: 6,
    lg: 8,
    xl: 10,
    xxl: 12,
    full: 9999,
  },
  transition: {
    fast: "80ms ease-out",
    base: "150ms ease-out",
    smooth: "200ms ease-out",
    slow: "300ms ease-out",
  },
  z: {
    base: 1,
    active: 2,
    playhead: 3,
    tooltip: 10,
    overlay: 50,
    modal: 100,
  },
  focus: {
    ring: "0 0 0 2px #6475e8",
  },
};

var DARK_THEME = {
  bg: {
    base: "#000000",
    surface: "#0f0f16",
    raised: "#1a1a24",
    overlay: "rgba(0, 0, 0, 0.7)",
    hover: "#20202e",
    active: "#26263a",
  },
  border: {
    subtle: "#1a1a24",
    default: "#232333",
    strong: "#2e2e42",
    focus: "#6475e8",
  },
  text: {
    primary: "#f0f0f2",
    secondary: "#a1a1a8",
    muted: "#717178",
    dim: "#585860",
    ghost: "#454548",
  },
  accent: {
    primary: "#6475e8",
    hover: "#7585f0",
    muted: "#6475e820",
  },
  semantic: {
    success: "#10d97a",
    warning: "#d14d4d",
    error: "#ef4444",
    errorBg: "#ef444415",
    errorBorder: "#ef444430",
    errorText: "#f87171",
    info: "#6475e8",
  },
  agent: {
    user: "#8b8b99",
    assistant: "#6475e8",
    system: "#a78bfa",
  },
  track: {
    reasoning: "#94a3b8",
    tool_call: "#3b9eff",
    context: "#a78bfa",
    output: "#10d97a",
  },
  shadow: {
    sm: "0 1px 2px rgba(0,0,0,0.3)",
    md: "0 4px 12px rgba(0,0,0,0.25)",
    lg: "0 12px 32px rgba(0,0,0,0.35)",
    inset: "inset 0 1px 2px rgba(0,0,0,0.2)",
  },
};

var LIGHT_THEME = {
  bg: {
    base: "#f6f7fb",
    surface: "#ffffff",
    raised: "#eef1f7",
    overlay: "rgba(17, 24, 39, 0.48)",
    hover: "#e5e9f2",
    active: "#d8deea",
  },
  border: {
    subtle: "#e4e8f0",
    default: "#d8deea",
    strong: "#c2cad8",
    focus: "#6475e8",
  },
  text: {
    primary: "#141824",
    secondary: "#4f5669",
    muted: "#70788d",
    dim: "#8a90a2",
    ghost: "#b0b6c8",
  },
  accent: {
    primary: "#6475e8",
    hover: "#5467e6",
    muted: "#6475e818",
  },
  semantic: {
    success: "#0ea86b",
    warning: "#b45309",
    error: "#d32f2f",
    errorBg: "#d32f2f14",
    errorBorder: "#d32f2f2a",
    errorText: "#c53030",
    info: "#6475e8",
  },
  agent: {
    user: "#70788d",
    assistant: "#6475e8",
    system: "#8b5cf6",
  },
  track: {
    reasoning: "#64748b",
    tool_call: "#2563eb",
    context: "#8b5cf6",
    output: "#0ea86b",
  },
  shadow: {
    sm: "0 1px 2px rgba(17,24,39,0.08)",
    md: "0 4px 12px rgba(17,24,39,0.08)",
    lg: "0 12px 32px rgba(17,24,39,0.10)",
    inset: "inset 0 1px 2px rgba(17,24,39,0.06)",
  },
};

var themePreference = "dark";
var systemThemePreference = "dark";

function clearStoredThemePreference() {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(THEME_STORAGE_CLEARED_KEY) === "1") return;
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    window.localStorage.setItem(THEME_STORAGE_CLEARED_KEY, "1");
  } catch (error) {
    // Ignore storage access failures during bootstrap.
  }
}

function normalizeThemePreference(mode) {
  return mode === "light" || mode === "dark" ? mode : "system";
}

function normalizeResolvedMode(mode) {
  return mode === "light" ? "light" : "dark";
}

function readStoredThemePreference() {
  if (typeof window === "undefined") return themePreference;
  try {
    var raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return themePreference;

    try {
      return normalizeThemePreference(JSON.parse(raw));
    } catch (parseError) {
      return normalizeThemePreference(raw);
    }
  } catch (error) {
    return themePreference;
  }
}

function readSystemThemePreference() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return systemThemePreference;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function resolveThemeMode(mode, systemMode) {
  var preference = normalizeThemePreference(typeof mode === "undefined" ? themePreference : mode);
  var resolvedSystemMode = normalizeResolvedMode(typeof systemMode === "undefined" ? systemThemePreference : systemMode);
  return preference === "system" ? resolvedSystemMode : preference;
}

function getThemeTokens(mode, systemMode) {
  return resolveThemeMode(mode, systemMode) === "light"
    ? Object.assign({}, SHARED_THEME, LIGHT_THEME)
    : Object.assign({}, SHARED_THEME, DARK_THEME);
}

export function setThemePreference(mode) {
  themePreference = normalizeThemePreference(mode);
}

export function getThemePreference() {
  return themePreference;
}

export function setSystemThemePreference(mode) {
  systemThemePreference = normalizeResolvedMode(mode);
}

export function getSystemThemePreference() {
  return systemThemePreference;
}

export function getResolvedThemeMode(mode, systemMode) {
  return resolveThemeMode(mode, systemMode);
}

export function getThemeTokensForMode(mode, systemMode) {
  return getThemeTokens(mode, systemMode);
}

export const THEME_MODES = [
  { id: "system", label: "System", icon: "monitor" },
  { id: "light", label: "Light", icon: "sun" },
  { id: "dark", label: "Dark", icon: "moon" },
];

function defineThemeSection(target, key) {
  Object.defineProperty(target, key, {
    enumerable: true,
    get: function () {
      return getThemeTokens()[key];
    },
  });
}

export var theme = {};
defineThemeSection(theme, "bg");
defineThemeSection(theme, "border");
defineThemeSection(theme, "text");
defineThemeSection(theme, "accent");
defineThemeSection(theme, "semantic");
defineThemeSection(theme, "agent");
defineThemeSection(theme, "track");
defineThemeSection(theme, "shadow");
theme.font = SHARED_THEME.font;
theme.fontSize = SHARED_THEME.fontSize;
theme.space = SHARED_THEME.space;
theme.radius = SHARED_THEME.radius;
theme.focus = SHARED_THEME.focus;
theme.transition = SHARED_THEME.transition;
theme.z = SHARED_THEME.z;
Object.defineProperty(theme, "mode", {
  enumerable: true,
  get: function () {
    return resolveThemeMode();
  },
});

function createDynamicColorMap(keys) {
  var result = {};
  keys.forEach(function (key) {
    Object.defineProperty(result, key, {
      enumerable: true,
      get: function () {
        return getThemeTokens().agent[key];
      },
    });
  });
  return result;
}

export const AGENT_COLORS = createDynamicColorMap(["user", "assistant", "system"]);

function createTrackInfo(key, label, icon) {
  var result = { label: label, icon: icon };
  Object.defineProperty(result, "color", {
    enumerable: true,
    get: function () {
      return getThemeTokens().track[key];
    },
  });
  return result;
}

export const TRACK_TYPES = {
  reasoning: createTrackInfo("reasoning", "Reasoning", "reasoning"),
  tool_call: createTrackInfo("tool_call", "Tool Calls", "tool_call"),
  context: createTrackInfo("context", "Context", "context"),
  output: createTrackInfo("output", "Output", "output"),
};

// ── Opacity helper ──
export function alpha(hex, opacity) {
  if (hex.startsWith("rgba")) return hex;
  var h = hex.replace("#", "");
  var r = parseInt(h.substring(0, 2), 16);
  var g = parseInt(h.substring(2, 4), 16);
  var b = parseInt(h.substring(4, 6), 16);
  return "rgba(" + r + "," + g + "," + b + "," + opacity + ")";
}

clearStoredThemePreference();
setThemePreference(readStoredThemePreference());
setSystemThemePreference(readSystemThemePreference());
