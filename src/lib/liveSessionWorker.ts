import { appendLiveSessionText, createLiveSessionParser } from "./liveSessionParser";

let state = createLiveSessionParser("", { snapshot: false });
self.onmessage = ({ data }) => {
  try {
    if (data.initial !== undefined) state = createLiveSessionParser(data.initial, { snapshot: false });
    if (data.reset) state = createLiveSessionParser("", { snapshot: false });
    if (data.text) state = appendLiveSessionText(state, data.text).state;
    self.postMessage({ result: state.result, rawText: state.rawText, normalizationWork: state.normalizationWork });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
