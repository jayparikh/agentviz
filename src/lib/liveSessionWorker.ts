import { appendLiveSessionText, createLiveSessionParser } from "./liveSessionParser";

let state = createLiveSessionParser("");
self.onmessage = ({ data }) => {
  try {
    if (data.initial !== undefined) state = createLiveSessionParser(data.initial);
    if (data.reset) state = createLiveSessionParser("");
    if (data.text) state = appendLiveSessionText(state, data.text).state;
    self.postMessage({ result: state.result, rawText: state.rawText });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
