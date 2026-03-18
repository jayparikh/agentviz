/**
 * AgentViz Design Tokens - "Midnight Circuit" theme
 *
 * Every color, spacing, and visual constant lives here.
 * Components reference tokens, never raw hex values.
 */

export const theme = {
  // ── Core palette ──
  bg: {
    base: "#0a0f1e",
    surface: "#0f172a",
    raised: "#1e293b",
    overlay: "#151e2e",
    hover: "#1e293b",
  },

  // ── Borders ──
  border: {
    subtle: "#111827",
    default: "#1e293b",
    strong: "#334155",
  },

  // ── Text ──
  text: {
    primary: "#e2e8f0",
    secondary: "#94a3b8",
    muted: "#64748b",
    dim: "#475569",
    ghost: "#334155",
  },

  // ── Accent colors ──
  accent: {
    cyan: "#22d3ee",
    amber: "#f59e0b",
    purple: "#a78bfa",
    green: "#34d399",
    blue: "#60a5fa",
    red: "#ef4444",
    redMuted: "#fca5a5",
  },

  // ── Agent colors ──
  agent: {
    user: "#60a5fa",
    assistant: "#a78bfa",
    system: "#6b7280",
  },

  // ── Track colors ──
  track: {
    reasoning: "#22d3ee",
    tool_call: "#f59e0b",
    context: "#a78bfa",
    output: "#34d399",
  },

  // ── Semantic ──
  error: "#ef4444",
  errorBg: "#ef444420",
  errorBorder: "#ef444440",
  errorText: "#fca5a5",
  success: "#34d399",
  warning: "#f59e0b",
  info: "#22d3ee",

  // ── Typography ──
  font: "'JetBrains Mono', monospace",
  fontSize: {
    xs: 9,
    sm: 10,
    base: 11,
    md: 12,
    lg: 13,
    xl: 15,
    xxl: 20,
    hero: 36,
  },

  // ── Spacing ──
  space: {
    xs: 2,
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    xxl: 20,
    xxxl: 24,
    huge: 32,
    giant: 48,
  },

  // ── Radii ──
  radius: {
    sm: 3,
    md: 4,
    lg: 6,
    xl: 8,
    xxl: 12,
  },

  // ── Shadows ──
  shadow: {
    glow: function (color) { return "0 0 8px " + color; },
    glowSm: function (color) { return "0 0 4px " + color; },
    glowLg: function (color) { return "0 0 12px " + color; },
    drop: "0 8px 32px rgba(0,0,0,0.5)",
    dropSm: "0 4px 16px rgba(0,0,0,0.3)",
  },

  // ── Animation ──
  transition: {
    fast: "0.1s ease",
    base: "0.15s ease",
    smooth: "0.2s ease",
    slow: "0.3s ease-out",
    spring: "0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
  },

  // ── Z-index layers ──
  z: {
    base: 1,
    active: 2,
    playhead: 3,
    tooltip: 10,
    overlay: 50,
    modal: 100,
  },
};

// ── Track metadata (merged with theme) ──
export const TRACK_TYPES = {
  reasoning: { label: "Reasoning", color: theme.track.reasoning, icon: "\u25C6" },
  tool_call: { label: "Tool Calls", color: theme.track.tool_call, icon: "\u25B6" },
  context: { label: "Context", color: theme.track.context, icon: "\u25CE" },
  output: { label: "Output", color: theme.track.output, icon: "\u25CF" },
};

export const AGENT_COLORS = theme.agent;

// ── Hex opacity helper ──
export function alpha(hex, opacity) {
  var a = Math.round(opacity * 255).toString(16).padStart(2, "0");
  return hex + a;
}
