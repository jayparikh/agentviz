import usePersistentState from "./usePersistentState.js";

/**
 * Feature flag backed by localStorage.
 *
 * Usage:
 *   var qa = useFeatureFlag("qa", false);
 *   if (qa.enabled) { ... }
 *   qa.setEnabled(true);
 *
 * Storage key: "agentviz:flag:<name>"
 */
export default function useFeatureFlag(name, defaultValue) {
  var [enabled, setEnabled] = usePersistentState("agentviz:flag:" + name, defaultValue);
  return { enabled: enabled, setEnabled: setEnabled };
}
