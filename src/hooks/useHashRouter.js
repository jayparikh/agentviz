import { useEffect } from "react";

// Hash-based routing: #/ = landing, #/session = session view
// Usage: useHashRouter({ hasSession, onNavigateToLanding })

export default function useHashRouter({ hasSession, onNavigateToLanding }) {
  // Push the right hash whenever hasSession changes
  useEffect(function () {
    var current = window.location.hash;
    if (hasSession) {
      if (current !== "#/session") {
        window.history.pushState(null, "", "#/session");
      }
    } else {
      if (current !== "#/" && current !== "#" && current !== "") {
        window.history.replaceState(null, "", "#/");
      }
    }
  }, [hasSession]);

  // Handle browser back/forward
  useEffect(function () {
    function onPopState() {
      var hash = window.location.hash;
      if (hash === "#/" || hash === "#" || hash === "") {
        onNavigateToLanding();
      }
    }
    window.addEventListener("popstate", onPopState);
    return function () { window.removeEventListener("popstate", onPopState); };
  }, [onNavigateToLanding]);
}
