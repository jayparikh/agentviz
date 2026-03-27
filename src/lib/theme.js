/**
 * AGENTVIZ Design Tokens
 *
 * Microsoft Foundry NextGen Design System - refined neutral dark theme
 * with minimal purple accents for primary actions only.
 *
 * CRITICAL: Purple (#8251EE) is ONLY for primary buttons, active indicators,
 * links, and focus rings. Everything else uses neutral dark greys.
 */

export const theme = {
  // ── Backgrounds ──
  // Neutral dark greys (NOT purple-tinted)
  bg: {
    base: "#0A0A0A",      // Page background - near black
    sidebar: "#0D0D0D",   // Sidebar and top bar
    surface: "#141414",   // Cards, panels, dialogs
    raised: "#1C1C1C",    // Elevated surfaces, table rows
    elevated: "#242424",  // Dropdowns, popovers
    overlay: "rgba(0, 0, 0, 0.7)",
    hover: "#2A2A2A",     // Hover states
    active: "#333333",    // Pressed/active backgrounds
  },

  // ── Borders ──
  // Subtle dark grey lines
  border: {
    subtle: "#1F1F1F",    // Very subtle dividers
    default: "#2A2A2A",   // Standard borders
    strong: "#333333",    // Emphasized borders
    focus: "#8251EE",     // Focus rings - purple
  },

  // ── Text ──
  // White and greys (NOT lavender/purple-tinted)
  text: {
    primary: "#FFFFFF",   // Main body text - pure white
    secondary: "#A1A1A1", // Secondary text, labels
    muted: "#6B6B6B",     // Placeholder, disabled hints
    dim: "#4A4A4A",       // Disabled text
    ghost: "#333333",     // Very subtle text
    link: "#A37EF5",      // Links - light purple
  },

  // ── Accent (Brand Purple) ──
  // Use sparingly! Only for primary actions and active indicators.
  accent: {
    primary: "#8251EE",   // Primary buttons, active indicators
    hover: "#9366F5",     // Hover on purple elements
    light: "#A37EF5",     // Links, active sidebar icons
    muted: "rgba(130, 81, 238, 0.2)", // Focus shadows, selection hints
    cta: "#E91E8C",       // Magenta for sliders, critical CTAs
  },

  // ── Semantic ──
  semantic: {
    success: "#10B981",
    successBg: "rgba(16, 185, 129, 0.15)",
    warning: "#F59E0B",
    warningBg: "rgba(245, 158, 11, 0.15)",
    error: "#EF4444",
    errorBg: "rgba(239, 68, 68, 0.15)",
    errorBorder: "rgba(239, 68, 68, 0.3)",
    errorText: "#EF4444",
    info: "#3B82F6",
  },

  // ── Agent colors ──
  // Subtle neutral tones - content matters, not who said it
  agent: {
    user: "#A1A1A1",      // Grey for user
    assistant: "#8251EE", // Purple for assistant (active indicator)
    system: "#6B6B6B",    // Muted grey for system
  },

  // ── Track colors ──
  // Balanced, distinct colors for data visualization
  track: {
    reasoning: "#A1A1A1", // Neutral grey
    tool_call: "#3B82F6", // Blue (info color)
    context: "#8251EE",   // Purple (brand)
    output: "#10B981",    // Green (success)
  },

  // ── Typography ──
  font: {
    mono: "'JetBrains Mono', monospace",
    ui: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  fontSize: {
    xs: 12,   // Captions, timestamps
    sm: 13,   // Table headers, labels
    base: 14, // Body text
    md: 16,   // Subheadings
    lg: 20,   // Section headings
    xl: 24,   // Page titles
    xxl: 28,
    hero: 32,
  },

  // ── Spacing ──
  // 4px grid
  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
    xxxl: 40,
    huge: 48,
    giant: 56,
  },

  // ── Radii ──
  radius: {
    sm: 4,    // Small elements, tags
    md: 6,    // Buttons, inputs
    lg: 8,    // Cards, panels
    xl: 12,   // Modals, large cards
    xxl: 16,
    full: 9999, // Pills, avatars
  },

  // ── Shadows ──
  shadow: {
    sm: "0 1px 2px rgba(0,0,0,0.3)",
    md: "0 4px 12px rgba(0,0,0,0.4)",
    lg: "0 8px 24px rgba(0,0,0,0.5)",
    focus: "0 0 0 2px rgba(130, 81, 238, 0.25)",
    inset: "inset 0 1px 2px rgba(0,0,0,0.2)",
  },

  // ── Focus ──
  focus: {
    ring: "0 0 0 2px #8251EE",
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
