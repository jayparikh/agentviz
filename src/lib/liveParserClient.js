// Only one normalization is in flight. New stream batches coalesce while the
// worker is busy; resets discard queued history without racing older results.
export function createLiveParserClient(worker, initial, onResult, onError) {
  var busy = false;
  var pending = null;
  var disposed = false;
  function pump() {
    if (disposed || busy || !pending) return;
    var message = pending;
    pending = null;
    busy = true;
    worker.postMessage(message);
  }
  worker.onmessage = function ({ data }) {
    busy = false;
    if (disposed) return;
    if (!pending?.reset) {
      if (data.error) onError(data.error);
      else onResult(data);
    }
    pump();
  };
  worker.onerror = function (event) {
    if (!disposed) onError(event.message || "Live parsing failed. Reopen the session to retry.");
  };
  pending = { initial };
  pump();
  return {
    append(text, reset) {
      if (reset) pending = { text, reset: true };
      else if (pending) pending.text = (pending.text ? pending.text + "\n" : "") + text;
      else pending = { text };
      pump();
    },
    dispose() { disposed = true; pending = null; worker.terminate(); },
  };
}
