/**
 * Type declarations for theme.js design tokens.
 * Provides autocomplete and type safety for TS consumers without
 * renaming theme.js (which 40+ JS files import by extension).
 */

export type TrackType = "reasoning" | "tool_call" | "context" | "output" | "agent";

export interface TrackTypeInfo {
  label: string;
  color: string;
  icon: string;
}

export interface Theme {
  bg: {
    base: string;
    surface: string;
    raised: string;
    overlay: string;
    hover: string;
    active: string;
  };
  border: {
    subtle: string;
    default: string;
    strong: string;
    focus: string;
  };
  text: {
    primary: string;
    secondary: string;
    muted: string;
    dim: string;
    ghost: string;
  };
  accent: {
    primary: string;
    hover: string;
    muted: string;
  };
  semantic: {
    success: string;
    warning: string;
    error: string;
    errorBg: string;
    errorBorder: string;
    errorText: string;
    info: string;
  };
  track: Record<TrackType, string>;
  agent: {
    user: string;
    assistant: string;
    system: string;
  };
  agentType: {
    explore: string;
    task: string;
    "general-purpose": string;
    "code-review": string;
    "configure-copilot": string;
    default: string;
  };
  font: {
    mono: string;
    ui: string;
  };
  fontSize: {
    xs: number;
    sm: number;
    base: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
    hero: number;
  };
  space: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
    xxxl: number;
    huge: number;
    giant: number;
  };
  radius: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
    full: number;
  };
  shadow: {
    sm: string;
    md: string;
    lg: string;
    inset: string;
  };
  focus: { ring: string };
  transition: {
    fast: string;
    base: string;
    smooth: string;
    slow: string;
  };
  z: {
    base: number;
    active: number;
    playhead: number;
    tooltip: number;
    overlay: number;
    modal: number;
  };
}

export declare const theme: Theme;
export declare const TRACK_TYPES: Record<TrackType, TrackTypeInfo>;
export declare const AGENT_COLORS: Theme["agent"];
export declare function alpha(hex: string, opacity: number): string;
