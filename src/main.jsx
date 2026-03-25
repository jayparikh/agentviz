import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: "", resetKey: 0 };
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error: error };
  }

  componentDidCatch(error, info) {
    var componentStack = info && info.componentStack ? info.componentStack : "";
    if (typeof window !== "undefined") {
      window.__AGENTVIZ_LAST_CRASH__ = {
        message: error && error.message ? error.message : String(error),
        stack: error && error.stack ? error.stack : "",
        componentStack: componentStack,
        timestamp: new Date().toISOString(),
      };
    }
    console.error("[AgentViz crash]", error, info && info.componentStack);
    this.setState({ componentStack: componentStack });
  }

  handleReset() {
    this.setState(function (prev) {
      return { hasError: false, error: null, componentStack: "", resetKey: (prev.resetKey || 0) + 1 };
    });
  }

  render() {
    if (this.state.hasError) {
      var msg = this.state.error && this.state.error.message ? this.state.error.message : String(this.state.error);
      return React.createElement("div", {
        style: {
          height: "100vh", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 16,
          background: "#0d1117", color: "#e6edf3", fontFamily: "'JetBrains Mono', monospace", padding: 32,
        }
      },
        React.createElement("div", { style: { fontSize: 18, color: "#ff6b6b" } }, "AgentViz crashed"),
        React.createElement("pre", {
          style: {
            background: "#161b22", border: "1px solid #30363d", borderRadius: 8,
            padding: "12px 16px", fontSize: 13, color: "#e6edf3", maxWidth: 680,
            overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
          }
        }, msg),
        !!(this.state.error && this.state.error.stack) && React.createElement("pre", {
          style: {
            background: "#0f141a", border: "1px solid #30363d", borderRadius: 8,
            padding: "12px 16px", fontSize: 12, color: "#8b949e", maxWidth: 680,
            overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
            margin: 0,
          }
        }, this.state.error.stack),
        !!this.state.componentStack && React.createElement("pre", {
          style: {
            background: "#0f141a", border: "1px solid #30363d", borderRadius: 8,
            padding: "12px 16px", fontSize: 12, color: "#8b949e", maxWidth: 680,
            overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
            margin: 0,
          }
        }, this.state.componentStack),
        React.createElement("button", {
          onClick: this.handleReset,
          style: {
            padding: "8px 18px", background: "#21262d", border: "1px solid #30363d",
            borderRadius: 6, color: "#c9d1d9", cursor: "pointer", fontFamily: "inherit", fontSize: 14,
          }
        }, "Try again")
      );
    }
    // key forces full App remount on reset, clearing any stale state that caused the crash
    return React.createElement(React.StrictMode, { key: this.state.resetKey },
      React.createElement(App)
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement(RootErrorBoundary)
)
