import { useState, useEffect, useRef } from "react";

var PERSIST_DEBOUNCE_MS = 300;

function resolveInitialValue(initialValue) {
  return typeof initialValue === "function" ? initialValue() : initialValue;
}

export default function usePersistentState(storageKey, initialValue) {
  var [state, setState] = useState(function () {
    var fallback = resolveInitialValue(initialValue);
    if (!storageKey || typeof window === "undefined") return fallback;

    try {
      var raw = window.localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      console.warn("Could not read persisted UI state for", storageKey, error);
      return fallback;
    }
  });

  var timerRef = useRef(null);
  var latestStateRef = useRef(state);
  latestStateRef.current = state;

  useEffect(function () {
    if (!storageKey || typeof window === "undefined") return;

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(function () {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(state));
      } catch (error) {
        console.warn("Could not persist UI state for", storageKey, error);
      }
    }, PERSIST_DEBOUNCE_MS);

    return function () {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [storageKey, state]);

  useEffect(function () {
    if (!storageKey || typeof window === "undefined") return;

    return function () {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      try {
        window.localStorage.setItem(storageKey, JSON.stringify(latestStateRef.current));
      } catch (error) {
        console.warn("Could not persist UI state for", storageKey, error);
      }
    };
  }, [storageKey]);

  return [state, setState];
}
