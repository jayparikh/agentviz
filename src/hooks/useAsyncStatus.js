import { useCallback, useEffect, useRef, useState } from "react";

export default function useAsyncStatus(options) {
  var successResetMs = options && options.successResetMs ? options.successResetMs : 2000;
  var errorResetMs = options && options.errorResetMs ? options.errorResetMs : 4000;
  var [state, setState] = useState("idle");
  var [error, setError] = useState(null);
  var timerRef = useRef(null);

  var clearTimer = useCallback(function () {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(function () {
    return function () {
      clearTimer();
    };
  }, [clearTimer]);

  var run = useCallback(function (task) {
    if (state === "loading") return Promise.resolve(null);

    clearTimer();
    setState("loading");
    setError(null);

    return Promise.resolve()
      .then(task)
      .then(function (value) {
        setState("done");
        timerRef.current = setTimeout(function () {
          setState("idle");
        }, successResetMs);
        return value;
      })
      .catch(function (err) {
        setState("error");
        setError(err && err.message ? err.message : "Unknown error");
        timerRef.current = setTimeout(function () {
          setState("idle");
          setError(null);
        }, errorResetMs);
        return null;
      });
  }, [clearTimer, errorResetMs, state, successResetMs]);

  return {
    state: state,
    error: error,
    run: run,
  };
}
