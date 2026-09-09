import React, { useState, useMemo, useEffect } from "react";
import {
  getResolvedThemeMode,
  readStoredThemePreference,
  syncThemeState,
  setDensityPreference,
} from "./lib/theme.js";
import usePersistentState from "./hooks/usePersistentState.js";
import { clearChunkReloadFlag } from "./lib/lazyImport.js";
import AppV2 from "./AppV2.jsx";
import ToolbarSelect from "./components/ui/ToolbarSelect.jsx";

export default function App() {
  useEffect(function () { clearChunkReloadFlag(); }, []);
  var [themeModePreference, setThemeModePreference] = usePersistentState("agentviz:theme-mode", readStoredThemePreference);
  var [density, setDensity] = usePersistentState("agentviz:density", "normal");
  setDensityPreference(density);
  var [systemThemeMode, setSystemThemeMode] = useState(function () {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });

  useEffect(function () {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    var mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    function handleChange(event) {
      setSystemThemeMode(event.matches ? "light" : "dark");
    }
    setSystemThemeMode(mediaQuery.matches ? "light" : "dark");
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return function () { mediaQuery.removeEventListener("change", handleChange); };
    }
    mediaQuery.addListener(handleChange);
    return function () { mediaQuery.removeListener(handleChange); };
  }, []);

  var themeTokens = useMemo(function () {
    return syncThemeState(themeModePreference, systemThemeMode);
  }, [themeModePreference, systemThemeMode]);
  var resolvedThemeMode = getResolvedThemeMode(themeModePreference, systemThemeMode);

  useEffect(function () {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.theme = resolvedThemeMode;
    document.documentElement.dataset.themePreference = themeModePreference;
    document.documentElement.style.colorScheme = resolvedThemeMode;
    document.documentElement.style.setProperty("--av-bg-base", themeTokens.bg.base);
    document.documentElement.style.setProperty("--av-bg-surface", themeTokens.bg.surface);
    document.documentElement.style.setProperty("--av-bg-hover", themeTokens.bg.hover);
    document.documentElement.style.setProperty("--av-bg-active", themeTokens.bg.active);
    document.documentElement.style.setProperty("--av-focus", themeTokens.border.focus);
    document.documentElement.style.setProperty("--av-border", themeTokens.border.default);
    document.documentElement.style.setProperty("--av-border-strong", themeTokens.border.strong);
    document.documentElement.style.setProperty("--av-text-primary", themeTokens.text.primary);
    document.documentElement.style.setProperty("--av-text-secondary", themeTokens.text.secondary);
    document.body.style.background = themeTokens.bg.base;
    document.body.style.color = themeTokens.text.primary;
  }, [themeModePreference, systemThemeMode, resolvedThemeMode, themeTokens]);

  return (
    <AppV2
      densityControl={<ToolbarSelect ariaLabel="Reading density" value={density} onChange={setDensity}
        options={[{ id: "normal", label: "Normal density" }, { id: "comfortable", label: "Comfortable density" }]} minWidth={130} />}
      currentThemeMode={themeModePreference}
      onSetThemeMode={setThemeModePreference}
    />
  );
}
