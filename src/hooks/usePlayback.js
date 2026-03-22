import { useState, useEffect, useRef, useCallback } from "react";
import usePersistentState from "./usePersistentState.js";
import { clampTime } from "../lib/playbackUtils.js";

export default function usePlayback(total) {
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
        if (prev >= total) {
          setPlaying(false);
          return total;
        }
        return prev + 0.1 * speed;
      });
    }, 100);

    return function () {
      clearInterval(intervalRef.current);
    };
  }, [playing, speed, total]);

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
