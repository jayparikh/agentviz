import { describe, it, expect } from "vitest";
import {
  theme,
  alpha,
  TRACK_TYPES,
  AGENT_COLORS,
  THEME_MODES,
  setThemePreference,
  getThemePreference,
  setSystemThemePreference,
  getSystemThemePreference,
  getResolvedThemeMode,
  getThemeTokensForMode,
  syncThemeState,
  readStoredThemePreference,
} from "../lib/theme.js";

describe("alpha", function () {
  it("converts hex + opacity to rgba string", function () {
    expect(alpha("#ff0000", 0.5)).toBe("rgba(255,0,0,0.5)");
    expect(alpha("#00ff00", 1)).toBe("rgba(0,255,0,1)");
    expect(alpha("#000000", 0)).toBe("rgba(0,0,0,0)");
  });

  it("passes through existing rgba strings unchanged", function () {
    var input = "rgba(100,200,50,0.8)";
    expect(alpha(input, 0.3)).toBe(input);
  });
});

describe("theme proxy object", function () {
  it("exposes static shared tokens directly", function () {
    expect(theme.font.mono).toContain("JetBrains Mono");
    expect(theme.fontSize.base).toBe(12);
    expect(theme.space.md).toBe(8);
    expect(theme.radius).toBeDefined();
    expect(theme.z).toBeDefined();
  });

  it("exposes dynamic mode-aware sections", function () {
    expect(theme.bg).toBeDefined();
    expect(theme.text).toBeDefined();
    expect(theme.border).toBeDefined();
    expect(theme.accent).toBeDefined();
    expect(theme.semantic).toBeDefined();
    expect(theme.track).toBeDefined();
  });

  it("reflects the resolved mode", function () {
    setThemePreference("dark");
    setSystemThemePreference("dark");
    expect(theme.mode).toBe("dark");
  });
});

describe("theme preference getters/setters", function () {
  it("normalizes invalid preferences to 'system'", function () {
    setThemePreference("invalid");
    expect(getThemePreference()).toBe("system");
  });

  it("accepts valid preferences", function () {
    setThemePreference("dark");
    expect(getThemePreference()).toBe("dark");

    setThemePreference("light");
    expect(getThemePreference()).toBe("light");

    setThemePreference("system");
    expect(getThemePreference()).toBe("system");
  });

  it("normalizes system theme to dark or light", function () {
    setSystemThemePreference("light");
    expect(getSystemThemePreference()).toBe("light");

    setSystemThemePreference("dark");
    expect(getSystemThemePreference()).toBe("dark");

    setSystemThemePreference("invalid");
    expect(getSystemThemePreference()).toBe("dark");
  });
});

describe("getResolvedThemeMode", function () {
  it("resolves 'system' to the system preference", function () {
    expect(getResolvedThemeMode("system", "light")).toBe("light");
    expect(getResolvedThemeMode("system", "dark")).toBe("dark");
  });

  it("resolves explicit modes directly", function () {
    expect(getResolvedThemeMode("dark", "light")).toBe("dark");
    expect(getResolvedThemeMode("light", "dark")).toBe("light");
  });
});

describe("getThemeTokensForMode", function () {
  it("returns dark tokens for dark mode", function () {
    var tokens = getThemeTokensForMode("dark", "dark");
    expect(tokens.bg).toBeDefined();
    expect(tokens.text).toBeDefined();
    expect(tokens.font).toBeDefined();
  });

  it("returns light tokens for light mode", function () {
    var tokens = getThemeTokensForMode("light", "dark");
    expect(tokens.bg).toBeDefined();
    expect(tokens.text).toBeDefined();
  });

  it("returns different bg colors for light vs dark", function () {
    var dark = getThemeTokensForMode("dark", "dark");
    var light = getThemeTokensForMode("light", "light");
    expect(dark.bg.base).not.toBe(light.bg.base);
  });
});

describe("syncThemeState", function () {
  it("updates preference and system mode, returns tokens", function () {
    var tokens = syncThemeState("dark", "light");
    expect(getThemePreference()).toBe("dark");
    expect(getSystemThemePreference()).toBe("light");
    expect(tokens.bg).toBeDefined();
  });
});

describe("readStoredThemePreference", function () {
  it("returns current preference when no localStorage", function () {
    setThemePreference("dark");
    var result = readStoredThemePreference();
    expect(typeof result).toBe("string");
  });
});

describe("THEME_MODES", function () {
  it("contains system, light, and dark options", function () {
    expect(THEME_MODES).toHaveLength(3);
    var ids = THEME_MODES.map(function (m) { return m.id; });
    expect(ids).toContain("system");
    expect(ids).toContain("light");
    expect(ids).toContain("dark");
  });

  it("each mode has label and icon", function () {
    THEME_MODES.forEach(function (mode) {
      expect(mode.label).toBeTruthy();
      expect(mode.icon).toBeTruthy();
    });
  });
});

describe("TRACK_TYPES", function () {
  it("defines all expected track types", function () {
    expect(TRACK_TYPES.reasoning).toBeDefined();
    expect(TRACK_TYPES.tool_call).toBeDefined();
    expect(TRACK_TYPES.context).toBeDefined();
    expect(TRACK_TYPES.output).toBeDefined();
  });

  it("each track has label, icon, and dynamic color", function () {
    Object.values(TRACK_TYPES).forEach(function (track) {
      expect(track.label).toBeTruthy();
      expect(track.icon).toBeTruthy();
      expect(track.color).toBeTruthy();
    });
  });
});

describe("AGENT_COLORS", function () {
  it("provides colors for known agent types", function () {
    expect(AGENT_COLORS.user).toBeTruthy();
    expect(AGENT_COLORS.assistant).toBeTruthy();
    expect(AGENT_COLORS.system).toBeTruthy();
  });
});
