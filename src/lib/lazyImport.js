// Wraps dynamic imports so a stale-chunk error after a redeploy triggers
// exactly one automatic page reload instead of a "Failed to fetch dynamically
// imported module" crash. Uses sessionStorage to avoid an infinite reload loop
// if the chunk is genuinely missing.

var RELOAD_KEY = "agentviz:chunk-reload";

function isStaleChunkError(error) {
  if (!error) return false;
  var message = error.message || String(error);
  return /Failed to fetch dynamically imported module/i.test(message)
    || /Importing a module script failed/i.test(message)
    || /ChunkLoadError/i.test(message);
}

export default function lazyImport(loader) {
  return loader().catch(function (error) {
    if (!isStaleChunkError(error)) throw error;
    if (typeof window === "undefined" || typeof sessionStorage === "undefined") throw error;
    if (window.__AGENTVIZ_STANDALONE__ || window.location.protocol === "file:") throw error;
    if (sessionStorage.getItem(RELOAD_KEY)) throw error;
    sessionStorage.setItem(RELOAD_KEY, "1");
    window.location.reload();
    // Return a never-resolving promise so React keeps the Suspense fallback
    // showing while the page reloads.
    return new Promise(function () {});
  });
}

export function clearChunkReloadFlag() {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(RELOAD_KEY);
}
