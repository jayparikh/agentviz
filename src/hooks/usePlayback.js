import { useState, useEffect, useRef, useCallback } from "react";
import usePersistentState from "./usePersistentState.js";
import { clampTime } from "../lib/playbackUtils.js";

// Pure tick function -- exported for testing.
// Returns { nextTime, stop } where stop=true means playback should halt (non-live only).
export function tickPlayback(prev, total, speed, isLive) {
  if (prev >= total) {
    return { nextTime: total, stop: !isLive };
  }
  return { nextTime: prev + 0.1 * speed, stop: false };
}

export default function usePlayback(total, isLive) {
  var [time, setTime] = useState(0);
  var [playing, setPlaying] = useState(false);
  var [speed, setSpeed] = usePersistentState("agentviz:playback-speed", 1);
  var intervalRef = useRef(null);

  useEffect(function () {
    if (!playing) {
      clearInterval(intervalRef.current);
      return;
    }

    intervalRef.current = setInterval(function () {
      setTime(function (prev) {
        var result = tickPlayback(prev, total, speed, isLive);
        // In live mode keep the interval alive so playback resumes
        // automatically when total grows with new streaming events.
        if (result.stop) setPlaying(false);
        return result.nextTime;
      });
    }, 100);

    return function () {
      clearInterval(intervalRef.current);
    };
  }, [playing, speed, total, isLive]);

  var seek = useCallback(function (nextTime) {
    setTime(clampTime(nextTime, total));
  }, [total]);

  var playPause = useCallback(function () {
    setTime(function (prev) {
      if (prev >= total) return 0;
      return prev;
    });
    setPlaying(function (prev) { return !prev; });
  }, [total]);

  var resetPlayback = useCallback(function (nextTime) {
    setTime(nextTime || 0);
    setPlaying(false);
  }, []);

  return {
    time: time,
    playing: playing,
    speed: speed,
    setSpeed: setSpeed,
    seek: seek,
    playPause: playPause,
    resetPlayback: resetPlayback,
  };
}
