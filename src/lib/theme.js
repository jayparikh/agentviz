/**
 * AgentViz Design Tokens
 *
 * Neutral dark palette. Single accent color. Color means something.
 * Inspired by Linear, Raycast, Vercel -- tools that feel quiet and fast.
 */

export const theme = {
  // ── Backgrounds ──
  // Warm neutral grays, no blue tint
  bg: {
    base: "#111113",
    surface: "#18181b",
    raised: "#222225",
    overlay: "rgba(0, 0, 0, 0.6)",
    hover: "#262629",
    active: "#2c2c30",
  },

  // ── Borders ──
  // Depth through thin lines, not shadows
  border: {
    subtle: "#222225",
    default: "#2c2c30",
    strong: "#3a3a3f",
    focus: "#5e6ad2",
  },

  // ── Text ──
  // Clear hierarchy, no lavender tint
  text: {
    primary: "#ededef",
    secondary: "#8b8b92",
    muted: "#5c5c63",
    dim: "#45454b",
    ghost: "#333338",
  },

  // ── Accent ──
  // One color. Used for: selection, focus, primary actions.
  accent: {
    primary: "#5e6ad2",
    hover: "#727ee0",
    muted: "#5e6ad220",
  },

  // ── Semantic ──
  semantic: {
    success: "#3fad78",
    warning: "#c4a240",
    error: "#d14d4d",
    errorBg: "#d14d4d15",
    errorBorder: "#d14d4d30",
    errorText: "#d48080",
    info: "#5e6ad2",
  },

  // ── Agent colors ──
  // Subtle. The content matters, not who said it.
  agent: {
    user: "#8b8b92",
    assistant: "#5e6ad2",
    system: "#c4a240",
  },

  // ── Track colors ──
  // Muted, balanced luminance so no track dominates
  track: {
    reasoning: "#7b8794",
    tool_call: "#c4a240",
    context: "#7b7ec8",
    output: "#3fad78",
  },

  // ── Typography ──
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

  // ── Spacing ──
  // 4px grid
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

  // ── Radii ──
  radius: {
    sm: 4,
    md: 6,
    lg: 8,
    xl: 10,
    xxl: 12,
    full: 9999,
  },

  // ── Shadows ──
  // Minimal. No glows.
  shadow: {
    sm: "0 1px 2px rgba(0,0,0,0.3)",
    md: "0 4px 12px rgba(0,0,0,0.25)",
    lg: "0 12px 32px rgba(0,0,0,0.35)",
    inset: "inset 0 1px 2px rgba(0,0,0,0.2)",
  },

  // ── Focus ──
  focus: {
    ring: "0 0 0 2px #5e6ad2",
  },

  // ── Animation ──
  // Snappy, ease-out only. No decorative motion.
  transition: {
    fast: "80ms ease-out",
    base: "150ms ease-out",
    smooth: "200ms ease-out",
    slow: "300ms ease-out",
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

// ── Track metadata ──
export const TRACK_TYPES = {
  reasoning: { label: "Reasoning", color: theme.track.reasoning, icon: "reasoning" },
  tool_call: { label: "Tool Calls", color: theme.track.tool_call, icon: "tool_call" },
  context: { label: "Context", color: theme.track.context, icon: "context" },
  output: { label: "Output", color: theme.track.output, icon: "output" },
};

export const AGENT_COLORS = theme.agent;

// ── Opacity helper ──
export function alpha(hex, opacity) {
  if (hex.startsWith("rgba")) return hex;
  var h = hex.replace("#", "");
  var r = parseInt(h.substring(0, 2), 16);
  var g = parseInt(h.substring(2, 4), 16);
  var b = parseInt(h.substring(4, 6), 16);
  return "rgba(" + r + "," + g + "," + b + "," + opacity + ")";
}
